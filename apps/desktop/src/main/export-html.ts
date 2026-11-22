import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { renderDocumentHtml } from '@gather/core';

/** Per-image and per-document limits for self-contained HTML/PDF exports. */
export const MAX_EXPORT_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_EXPORT_EMBEDDED_BYTES = 24 * 1024 * 1024;

const IMAGE_MIME_TYPES: Record<string, string> = {
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

const IMG_TAG = /<img\b[^>]*>/gi;
const SRC_ATTRIBUTE = /\bsrc="([^"]*)"/i;

function decodeHtmlAttribute(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function isLocalReference(src: string): boolean {
  if (!src || src.startsWith('//') || src.startsWith('#')) return false;
  // Windows drive letters look like URI schemes but are absolute local paths.
  if (/^[a-z]:[\\/]/i.test(src)) return true;
  return !/^[a-z][a-z0-9+.-]*:/i.test(src);
}

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

export interface LocalImageData {
  dataUri: string;
  bytes: number;
}

export type LocalImageResult = LocalImageData | { warning: string };

/**
 * Resolve a relative raster image under an already-realpath'ed document root.
 * Shared by export embedding and the live preview IPC so both enforce the same
 * directory, extension and size boundaries.
 */
export async function readLocalImageDataUri(
  src: string,
  root: string,
  maxBytes = MAX_EXPORT_IMAGE_BYTES,
): Promise<LocalImageResult> {
  const mime = IMAGE_MIME_TYPES[extname(src).toLowerCase()];
  if (!mime) {
    return { warning: `图片 ${src} 不是可嵌入的位图格式，已保留原引用。` };
  }

  const candidate = resolve(root, src);
  if (!isWithin(root, candidate)) {
    return { warning: `图片 ${src} 指向文稿目录之外，已跳过。` };
  }

  let realCandidate: string;
  let size: number;
  try {
    realCandidate = await realpath(candidate);
    if (!isWithin(root, realCandidate)) {
      return { warning: `图片 ${src} 通过链接指向文稿目录之外，已跳过。` };
    }
    const info = await stat(realCandidate);
    if (!info.isFile()) {
      return { warning: `图片 ${src} 不是普通文件，已跳过。` };
    }
    size = info.size;
  } catch {
    return { warning: `本地图片 ${src} 未找到，已保留原引用。` };
  }

  if (size > maxBytes) {
    return { warning: `图片 ${src} 超过 ${Math.round(maxBytes / (1024 * 1024))} MiB，未读取。` };
  }

  try {
    const bytes = await readFile(realCandidate);
    if (bytes.length > maxBytes) {
      return { warning: `图片 ${src} 在读取期间变得过大，未读取。` };
    }
    return { dataUri: `data:${mime};base64,${bytes.toString('base64')}`, bytes: bytes.length };
  } catch {
    return { warning: `图片 ${src} 读取失败，已保留原引用。` };
  }
}

async function embedImage(
  src: string,
  root: string,
  budget: { remaining: number },
): Promise<{ value?: string; warning?: string }> {
  const result = await readLocalImageDataUri(src, root, MAX_EXPORT_IMAGE_BYTES);
  if ('warning' in result) return { warning: result.warning };
  if (result.bytes > budget.remaining) {
    return { warning: `图片 ${src} 超出 24 MiB 的嵌入预算，未嵌入导出文件。` };
  }
  budget.remaining -= result.bytes;
  return { value: result.dataUri };
}

/**
 * Turn relative image references into data URIs so an exported HTML file (and
 * the PDF printed from it) is self-contained. Remote URLs and data URIs are
 * left for Chromium to load; links outside the document directory are rejected.
 */
export async function inlineLocalImages(
  html: string,
  baseDirectory: string | null,
): Promise<{ html: string; warnings: string[] }> {
  if (!baseDirectory) return { html, warnings: [] };

  let root: string;
  try {
    root = await realpath(baseDirectory);
  } catch {
    return { html, warnings: ['文稿目录不可用，本地图片未嵌入导出文件。'] };
  }

  const rawSources = new Set<string>();
  for (const match of html.matchAll(IMG_TAG)) {
    const src = match[0].match(SRC_ATTRIBUTE)?.[1];
    if (src) rawSources.add(src);
  }

  const warnings: string[] = [];
  const replacements = new Map<string, string>();
  const budget = { remaining: MAX_EXPORT_EMBEDDED_BYTES };
  for (const rawSource of rawSources) {
    const decoded = decodeHtmlAttribute(rawSource);
    if (!isLocalReference(decoded)) continue;
    const pathPart = decoded.split(/[?#]/, 1)[0];
    if (!pathPart || pathPart.includes('\u0000')) continue;
    let relativePath: string;
    try {
      relativePath = decodeURIComponent(pathPart);
    } catch {
      warnings.push(`图片 ${pathPart} 的路径编码无效，已保留原引用。`);
      continue;
    }
    if (isAbsolute(relativePath) || relativePath.startsWith('\\')) {
      warnings.push(`图片 ${pathPart} 是绝对路径，已跳过。`);
      continue;
    }
    const embedded = await embedImage(relativePath, root, budget);
    if (embedded.value) {
      replacements.set(`src="${rawSource}"`, `src="${embedded.value}"`);
    }
    if (embedded.warning) warnings.push(embedded.warning);
  }

  let output = html;
  for (const [from, to] of replacements) output = output.replaceAll(from, to);
  return { html: output, warnings };
}

export async function buildExportDocument(
  markdown: string,
  title: string,
  baseDirectory: string | null,
): Promise<{ html: string; warnings: string[] }> {
  const rendered = renderDocumentHtml(markdown, title);
  return inlineLocalImages(rendered, baseDirectory);
}

/** Produce a portable filename stem on Windows, macOS and Linux. */
export function sanitizeExportStem(value: string): string {
  let stem = value.trim().replace(/\.(?:md|markdown|mdown|mkd|txt)$/i, '');
  stem = stem
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/[. ]+$/g, '')
    .slice(0, 96)
    .trim();
  if (!stem) stem = '未命名文稿';
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) stem = `${stem}-文稿`;
  return stem;
}
