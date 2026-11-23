import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WorkspaceFile } from '../src/shared/files';
import { listWorkspace } from '../src/main/workspace';
import {
  DEFAULT_SEARCH_LIMITS,
  searchWorkspaceFiles,
  type SearchLimits,
} from '../src/main/workspace-search';

let root = '';
let outside = '';

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'gather-search-')));
  outside = await realpath(await mkdtemp(join(tmpdir(), 'gather-search-outside-')));
  await mkdir(join(root, 'notes'), { recursive: true });
  await writeFile(
    join(root, 'notes', 'a.md'),
    'Gather 保留原文。\n第二段：gather 小写，Gather 大写。\n- Gather 列表项\n',
  );
  await writeFile(
    join(root, 'notes', 'b.md'),
    '\uFEFF第一行\r\nGather 在这里\r\n最后一行\r\n',
  );
  await writeFile(join(root, 'binary.txt'), Buffer.from([0, 1, 2, 71, 97, 116, 104, 101, 114]));
  await writeFile(join(root, 'outside.md'), '# outside Gather');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

function limits(overrides: Partial<SearchLimits> = {}): SearchLimits {
  return { ...DEFAULT_SEARCH_LIMITS, ...overrides };
}

async function workspaceFiles() {
  const workspace = await listWorkspace(root);
  return workspace.files;
}

describe('workspace search matching', () => {
  it('finds literal text case-insensitively with line, column and preview spans', async () => {
    const result = await searchWorkspaceFiles(root, await workspaceFiles(), {
      query: 'gather',
      caseSensitive: false,
      regex: false,
    });

    expect(result.error).toBeUndefined();
    expect(result.timedOut).toBe(false);
    expect(result.filesScanned).toBe(4);

    const fromA = result.matches.filter(match => match.relativePath === 'notes/a.md');
    expect(fromA.map(match => match.line)).toEqual([1, 2, 2, 3]);
    expect(fromA[0]).toMatchObject({ column: 1, matchText: 'Gather' });
    expect(fromA[1].matchText).toBe('gather');
    expect(fromA[2].matchText).toBe('Gather');
    expect(fromA[3]).toMatchObject({ column: 3, matchText: 'Gather' });
    for (const match of result.matches) {
      expect(match.preview.slice(match.previewMatchStart, match.previewMatchStart + match.matchLength))
        .toBe(match.matchText);
    }
  });

  it('honours case sensitivity', async () => {
    const upper = await searchWorkspaceFiles(root, await workspaceFiles(), {
      query: 'Gather',
      caseSensitive: true,
      regex: false,
    });
    const lower = await searchWorkspaceFiles(root, await workspaceFiles(), {
      query: 'gather',
      caseSensitive: true,
      regex: false,
    });

    expect(upper.matches.length).toBeGreaterThan(0);
    expect(lower.matches.length).toBe(1);
    expect(lower.matches[0].line).toBe(2);
    expect(upper.matches.every(match => match.matchText === 'Gather')).toBe(true);
  });

  it('supports regular expressions and reports invalid patterns', async () => {
    const result = await searchWorkspaceFiles(root, await workspaceFiles(), {
      query: '[Gg]ather',
      caseSensitive: true,
      regex: true,
    });
    const texts = result.matches.map(match => match.matchText);
    expect(texts).toContain('Gather');
    expect(texts).toContain('gather');

    const invalid = await searchWorkspaceFiles(root, await workspaceFiles(), {
      query: '(未闭合',
      caseSensitive: false,
      regex: true,
    });
    expect(invalid.matches).toEqual([]);
    expect(invalid.error).toMatch(/正则表达式无效/);
  });

  it('reports the real line in BOM + CRLF documents', async () => {
    const result = await searchWorkspaceFiles(root, await workspaceFiles(), {
      query: 'Gather 在这里',
      caseSensitive: true,
      regex: false,
    });
    const match = result.matches.find(item => item.relativePath === 'notes/b.md');
    expect(match).toMatchObject({ line: 2, column: 1, matchText: 'Gather 在这里' });
    expect(match?.preview).toBe('Gather 在这里');
  });

  it('rejects an empty query without scanning', async () => {
    const result = await searchWorkspaceFiles(root, await workspaceFiles(), {
      query: '   ',
      caseSensitive: false,
      regex: false,
    });
    expect(result.matches).toEqual([]);
    expect(result.filesScanned).toBe(0);
    expect(result.error).toMatch(/关键词/);
  });
});

describe('workspace search limits', () => {
  it('caps matches per line and marks the result truncated', async () => {
    await writeFile(join(root, 'many.md'), `${'Gather '.repeat(6)}\n`);
    const result = await searchWorkspaceFiles(root, await workspaceFiles(), {
      query: 'Gather',
      caseSensitive: true,
      regex: false,
    }, limits({ maxHitsPerLine: 2 }));

    const fromMany = result.matches.filter(match => match.relativePath === 'many.md');
    expect(fromMany).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it('caps the total number of matches', async () => {
    const result = await searchWorkspaceFiles(root, await workspaceFiles(), {
      query: 'Gather',
      caseSensitive: true,
      regex: false,
    }, limits({ maxResults: 2 }));

    expect(result.matches).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it('skips binary files', async () => {
    const result = await searchWorkspaceFiles(root, await workspaceFiles(), {
      query: 'Gather',
      caseSensitive: true,
      regex: false,
    });

    expect(result.matches.some(match => match.relativePath === 'binary.txt')).toBe(false);
    expect(result.filesSkipped).toBeGreaterThanOrEqual(1);
  });

  it('skips files above the per-file limit', async () => {
    await writeFile(join(root, 'too-big.md'), 'Gather is hidden in a large file');
    const result = await searchWorkspaceFiles(root, await workspaceFiles(), {
      query: 'Gather',
      caseSensitive: true,
      regex: false,
    }, limits({ maxFileBytes: 20 }));

    expect(result.matches.every(match => match.relativePath !== 'too-big.md')).toBe(true);
    expect(result.filesSkipped).toBeGreaterThanOrEqual(1);
  });

  it('skips a forged relative path instead of reading outside the workspace', async () => {
    await writeFile(join(outside, 'secret.md'), 'Gather outside');
    const files: WorkspaceFile[] = [
      {
        path: join(outside, 'secret.md'),
        relativePath: '../outside/secret.md',
        name: 'secret.md',
      },
    ];
    const result = await searchWorkspaceFiles(root, files, {
      query: 'Gather',
      caseSensitive: true,
      regex: false,
    });

    expect(result.matches).toEqual([]);
    expect(result.filesSkipped).toBe(1);
  });
});
