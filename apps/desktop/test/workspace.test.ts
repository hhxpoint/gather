import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listWorkspace, resolveWorkspaceFile } from '../src/main/workspace';

let root = '';
let outside = '';

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'gather-workspace-')));
  outside = await realpath(await mkdtemp(join(tmpdir(), 'gather-workspace-outside-')));
  await mkdir(join(root, 'nested', 'deep'), { recursive: true });
  await mkdir(join(root, '.hidden'), { recursive: true });
  await mkdir(join(root, 'node_modules'), { recursive: true });
  await mkdir(join(root, 'out'), { recursive: true });
  await writeFile(join(root, 'a.md'), '# a');
  await writeFile(join(root, 'z.txt'), 'z');
  await writeFile(join(root, 'image.png'), 'not markdown');
  await writeFile(join(root, 'nested', 'b.markdown'), '# b');
  await writeFile(join(root, 'nested', 'deep', 'c.mdown'), '# c');
  await writeFile(join(root, '.hidden', 'secret.md'), '# secret');
  await writeFile(join(root, 'node_modules', 'dependency.md'), '# dependency');
  await writeFile(join(root, 'out', 'built.md'), '# built');
  await writeFile(join(outside, 'secret.md'), '# outside');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe('workspace listing', () => {
  it('lists Markdown-like files recursively and skips hidden/build folders', async () => {
    const workspace = await listWorkspace(root);
    expect(workspace.root).toBe(root);
    expect(workspace.name).toBe(root.split(/[\\/]/).pop());
    expect(workspace.truncated).toBe(false);
    expect(workspace.files.map(file => file.relativePath)).toEqual([
      'a.md',
      'nested/b.markdown',
      'nested/deep/c.mdown',
      'z.txt',
    ]);
    expect(workspace.files[0].path).toBe(join(root, 'a.md'));
    expect(workspace.files[0].name).toBe('a.md');
  });

  it('rejects a file that is not a directory', async () => {
    await expect(listWorkspace(join(root, 'a.md'))).rejects.toThrow(/文件夹/);
  });
});

describe('workspace file boundary', () => {
  it('resolves a listed relative path to a real file', async () => {
    const resolved = await resolveWorkspaceFile(root, 'nested/b.markdown');
    expect(resolved).toBe(join(root, 'nested', 'b.markdown'));
  });

  it('rejects traversal, absolute, missing and directory paths', async () => {
    await expect(resolveWorkspaceFile(root, '../outside/secret.md')).rejects.toThrow(/之外/);
    await expect(resolveWorkspaceFile(root, join(outside, 'secret.md'))).rejects.toThrow(/相对路径/);
    await expect(resolveWorkspaceFile(root, '/etc/passwd')).rejects.toThrow(/相对路径/);
    await expect(resolveWorkspaceFile(root, 'missing.md')).rejects.toThrow(/不存在/);
    await expect(resolveWorkspaceFile(root, 'nested')).rejects.toThrow(/普通文件/);
  });

  it('rejects NUL and empty relative paths', async () => {
    await expect(resolveWorkspaceFile(root, '')).rejects.toThrow(/无效/);
    await expect(resolveWorkspaceFile(root, 'a\0.md')).rejects.toThrow(/无效/);
  });
});
