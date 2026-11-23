import { readFile, stat } from 'node:fs/promises';
import type {
  WorkspaceFile,
  WorkspaceSearchHit,
  WorkspaceSearchOptions,
  WorkspaceSearchResult,
} from '../shared/files';
import { resolveWorkspaceFile } from './workspace';

export const SEARCH_MAX_QUERY_LENGTH = 200;
export const SEARCH_MAX_RESULTS = 200;
export const SEARCH_MAX_FILE_BYTES = 2 * 1024 * 1024;
export const SEARCH_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
export const SEARCH_MAX_HITS_PER_LINE = 3;
export const SEARCH_MAX_PREVIEW = 220;
const BINARY_SCAN_BYTES = 8192;

export interface SearchLimits {
  maxResults: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxHitsPerLine: number;
  maxPreviewLength: number;
}

export const DEFAULT_SEARCH_LIMITS: SearchLimits = {
  maxResults: SEARCH_MAX_RESULTS,
  maxFileBytes: SEARCH_MAX_FILE_BYTES,
  maxTotalBytes: SEARCH_MAX_TOTAL_BYTES,
  maxHitsPerLine: SEARCH_MAX_HITS_PER_LINE,
  maxPreviewLength: SEARCH_MAX_PREVIEW,
};

interface LineMatch {
  index: number;
  length: number;
  text: string;
}

interface Matcher {
  find: (line: string) => { hits: LineMatch[]; capped: boolean };
}

export interface PreparedSearch {
  matcher?: Matcher;
  error?: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Compile the query once. Literal text is escaped and uses the same engine as
 * regex, so case folding and Unicode offsets stay consistent.
 */
export function prepareSearch(
  options: WorkspaceSearchOptions,
  limits: SearchLimits = DEFAULT_SEARCH_LIMITS,
): PreparedSearch {
  if (!options.query.trim()) return { error: '请输入搜索关键词。' };
  if (options.query.length > SEARCH_MAX_QUERY_LENGTH) {
    return { error: `关键词不能超过 ${SEARCH_MAX_QUERY_LENGTH} 个字符。` };
  }

  const pattern = options.regex ? options.query : escapeRegExp(options.query);
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, options.caseSensitive ? 'gu' : 'giu');
  } catch (error) {
    return { error: `正则表达式无效：${messageOf(error)}` };
  }

  return {
    matcher: {
      find(line: string) {
        const hits: LineMatch[] = [];
        let capped = false;
        regex.lastIndex = 0;
        for (;;) {
          const match = regex.exec(line);
          if (!match) break;
          if (match[0].length === 0) {
            // A zero-length match would otherwise spin forever.
            regex.lastIndex += 1;
            continue;
          }
          hits.push({ index: match.index, length: match[0].length, text: match[0] });
          if (hits.length > limits.maxHitsPerLine) {
            capped = true;
            break;
          }
        }
        if (hits.length > limits.maxHitsPerLine) hits.length = limits.maxHitsPerLine;
        return { hits, capped };
      },
    },
  };
}

function buildPreview(
  line: string,
  matchIndex: number,
  matchLength: number,
  maxLength: number,
): { preview: string; previewMatchStart: number } {
  // Replace tabs one-for-one so offsets stay valid for highlighting.
  const normalized = line.replace(/\t/g, ' ');
  let start = 0;
  if (matchIndex > 40) start = Math.max(0, matchIndex - 30);
  let end = Math.min(normalized.length, start + maxLength);
  // Never cut through the matched text, even when the query is long.
  end = Math.min(normalized.length, Math.max(end, matchIndex + matchLength));
  const prefix = start > 0 ? '…' : '';
  const suffix = end < normalized.length ? '…' : '';
  return {
    preview: `${prefix}${normalized.slice(start, end)}${suffix}`,
    previewMatchStart: prefix.length + (matchIndex - start),
  };
}

function looksBinary(buffer: Buffer): boolean {
  const end = Math.min(buffer.length, BINARY_SCAN_BYTES);
  for (let index = 0; index < end; index += 1) {
    if (buffer[index] === 0) return true;
  }
  return false;
}

/**
 * Search workspace files with a total byte budget, per-file cap and result
 * cap. Every file is re-resolved through the workspace boundary before it is
 * read, so a symlink swapped in after listing is rejected.
 */
export async function searchWorkspaceFiles(
  root: string,
  files: WorkspaceFile[],
  options: WorkspaceSearchOptions,
  limits: SearchLimits = DEFAULT_SEARCH_LIMITS,
): Promise<WorkspaceSearchResult> {
  const startedAt = Date.now();
  const result: WorkspaceSearchResult = {
    matches: [],
    filesScanned: 0,
    filesSkipped: 0,
    truncated: false,
    timedOut: false,
    durationMs: 0,
  };

  const prepared = prepareSearch(options, limits);
  if (!prepared.matcher) {
    result.durationMs = Date.now() - startedAt;
    result.error = prepared.error;
    return result;
  }
  const matcher = prepared.matcher;

  let totalBytes = 0;
  let stop = false;

  for (const file of files) {
    if (result.matches.length >= limits.maxResults || totalBytes >= limits.maxTotalBytes) {
      result.truncated = true;
      break;
    }

    let path: string;
    try {
      path = await resolveWorkspaceFile(root, file.relativePath);
    } catch {
      result.filesSkipped += 1;
      continue;
    }

    let info;
    try {
      info = await stat(path);
    } catch {
      result.filesSkipped += 1;
      continue;
    }
    if (!info.isFile() || info.size > limits.maxFileBytes) {
      result.filesSkipped += 1;
      continue;
    }

    let buffer: Buffer;
    try {
      buffer = await readFile(path);
    } catch {
      result.filesSkipped += 1;
      continue;
    }
    totalBytes += buffer.length;
    result.filesScanned += 1;

    if (looksBinary(buffer)) {
      result.filesSkipped += 1;
      continue;
    }

    let text = buffer.toString('utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const lines = text.split(/\r\n|\n|\r/);

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      if (!line) continue;
      const found = matcher.find(line);
      if (found.capped) result.truncated = true;
      for (const match of found.hits) {
        if (result.matches.length >= limits.maxResults) {
          result.truncated = true;
          stop = true;
          break;
        }
        const preview = buildPreview(
          line,
          match.index,
          match.length,
          limits.maxPreviewLength,
        );
        const hit: WorkspaceSearchHit = {
          relativePath: file.relativePath,
          name: file.name,
          line: lineIndex + 1,
          column: match.index + 1,
          preview: preview.preview,
          previewMatchStart: preview.previewMatchStart,
          matchLength: match.length,
          matchText: match.text,
        };
        result.matches.push(hit);
      }
      if (stop) break;
    }

    if (stop) break;
  }

  result.durationMs = Date.now() - startedAt;
  return result;
}
