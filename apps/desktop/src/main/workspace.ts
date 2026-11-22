import { readdir, realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import type { Workspace, WorkspaceFile } from '../shared/files';

export const MAX_WORKSPACE_FILES = 2000;
const MAX_WORKSPACE_DEPTH = 8;
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.txt']);
const SKIP_DIRECTORIES = new Set(['node_modules', 'out', 'dist', 'release', 'coverage']);

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

function isMarkdownFile(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot > 0 && MARKDOWN_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

/**
 * Recursively list Markdown-like files without following symlinks. Hidden
 * entries and common build/dependency folders are skipped so opening a repo
 * root does not enumerate thousands of irrelevant files.
 */
export async function listWorkspace(folderPath: string): Promise<Workspace> {
  const root = await realpath(folderPath);
  const info = await stat(root);
  if (!info.isDirectory()) throw new Error('请选择一个文件夹。');

  const files: WorkspaceFile[] = [];
  let truncated = false;

  async function walk(directory: string, parts: string[], depth: number): Promise<void> {
    if (truncated || depth > MAX_WORKSPACE_DEPTH) {
      if (depth > MAX_WORKSPACE_DEPTH) truncated = true;
      return;
    }
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
    for (const entry of entries) {
      if (truncated) return;
      if (entry.name.startsWith('.')) continue;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) continue;
        await walk(join(directory, entry.name), [...parts, entry.name], depth + 1);
        continue;
      }
      if (!entry.isFile() || !isMarkdownFile(entry.name)) continue;
      if (files.length >= MAX_WORKSPACE_FILES) {
        truncated = true;
        return;
      }
      const path = join(directory, entry.name);
      files.push({
        path,
        relativePath: [...parts, entry.name].join('/'),
        name: entry.name,
      });
    }
  }

  await walk(root, [], 0);
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'zh-CN', { numeric: true }));

  return {
    root,
    name: basename(root) || root,
    files,
    truncated,
  };
}

/**
 * Resolve a workspace-relative file, rejecting absolute paths, traversal,
 * symlink escapes and non-files. The root must already be a realpath.
 */
export async function resolveWorkspaceFile(root: string, relativePath: string): Promise<string> {
  if (!relativePath || relativePath.length > 4096 || relativePath.includes('\u0000')) {
    throw new Error('工作区文件路径无效。');
  }
  if (isAbsolute(relativePath) || relativePath.startsWith('/') || relativePath.startsWith('\\')) {
    throw new Error('工作区文件路径必须是相对路径。');
  }
  const candidate = resolve(root, relativePath);
  if (!isWithin(root, candidate)) {
    throw new Error('工作区文件位于当前文件夹之外，已拒绝。');
  }
  let realCandidate: string;
  try {
    realCandidate = await realpath(candidate);
  } catch {
    throw new Error('工作区文件不存在或已被移动。');
  }
  if (!isWithin(root, realCandidate)) {
    throw new Error('工作区文件通过链接指向文件夹之外，已拒绝。');
  }
  const info = await stat(realCandidate);
  if (!info.isFile()) throw new Error('工作区路径不是普通文件。');
  return realCandidate;
}
