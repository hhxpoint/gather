import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileVersion } from '../src/main/file-io';
import { ActiveFileWatcher } from '../src/main/file-watcher';
import type { ExternalChange } from '../src/shared/files';

let root = '';
let path = '';
let watcher: ActiveFileWatcher;
let changes: ExternalChange[];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'gather-watcher-'));
  path = join(root, 'note.md');
  await writeFile(path, '# one\n', 'utf8');
  watcher = new ActiveFileWatcher({ nativeWatch: false, pollIntervalMs: 0 });
  changes = [];
});

afterEach(async () => {
  watcher.stop();
  await rm(root, { recursive: true, force: true });
});

async function start(): Promise<void> {
  const version = await readFileVersion(path);
  if (!version) throw new Error('missing fixture');
  watcher.watch(path, version, change => changes.push(change));
}

describe('active file watcher', () => {
  it('reports an external content change once', async () => {
    await start();
    await writeFile(path, '# two\n', 'utf8');

    const change = await watcher.checkNow();
    expect(change).toMatchObject({ type: 'changed', path });
    expect(changes).toHaveLength(1);

    expect(await watcher.checkNow()).toBeNull();
    expect(changes).toHaveLength(1);
  });

  it('does not report our own save after updateVersion', async () => {
    await start();
    await writeFile(path, '# ours\n', 'utf8');
    const saved = await readFileVersion(path);
    if (!saved) throw new Error('missing saved fixture');
    watcher.updateVersion(saved);

    expect(await watcher.checkNow()).toBeNull();
    expect(changes).toEqual([]);
  });

  it('reports deletion once and can continue after recreation', async () => {
    await start();
    await unlink(path);

    expect(await watcher.checkNow()).toMatchObject({ type: 'removed', path });
    expect(await watcher.checkNow()).toBeNull();
    expect(changes).toHaveLength(1);

    await writeFile(path, '# back\n', 'utf8');
    expect(await watcher.checkNow()).toMatchObject({ type: 'changed', path });
    expect(changes).toHaveLength(2);
  });

  it('skips unchanged stat checks in polling mode but can force a hash', async () => {
    await start();
    expect(await watcher.checkNow(false)).toBeNull();
    await writeFile(path, '# changed\n', 'utf8');
    expect(await watcher.checkNow(false)).toMatchObject({ type: 'changed', path });
  });
});
