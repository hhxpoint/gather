import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RecoveryStore, recoveryIdForPath } from '../src/main/recovery';
import type { FileVersion, RecoveryPayload } from '../src/shared/files';

let root = '';
let store: RecoveryStore;

const version: FileVersion = {
  mtimeMs: 1_700_000_000_000,
  size: 12,
  digest: 'a'.repeat(64),
};

function payload(overrides: Partial<RecoveryPayload> = {}): RecoveryPayload {
  return {
    path: join(root, 'notes', 'draft.md'),
    name: 'draft.md',
    content: '# 草稿\n\n未保存的内容\n',
    format: { bom: false, eol: 'lf' },
    baseVersion: version,
    ...overrides,
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'gather-recovery-'));
  store = new RecoveryStore(join(root, 'recovery'));
  await store.init();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('recovery snapshots', () => {
  it('writes, lists and reads a path snapshot without losing format', async () => {
    const written = await store.write(payload({
      content: '# 草稿\r\n内容\r\n',
      format: { bom: true, eol: 'crlf' },
    }));

    expect(written.id).toBe(recoveryIdForPath(join(root, 'notes', 'draft.md')));
    expect(written.id).toMatch(/^[a-f0-9]{64}$/);
    expect(written.bytes).toBeGreaterThan(0);

    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'draft.md', path: written.path });
    expect('content' in list[0]).toBe(false);

    const restored = await store.read(written.id);
    expect(restored?.content).toBe('# 草稿\n内容\n');
    expect(restored?.format).toEqual({ bom: true, eol: 'crlf' });
    expect(restored?.baseVersion).toEqual(version);
  });

  it('replaces the previous snapshot for the same file', async () => {
    const first = await store.write(payload({ content: 'one\n' }));
    const second = await store.write(payload({ content: 'two\n' }));
    expect(second.id).toBe(first.id);
    expect(await store.list()).toHaveLength(1);
    expect((await store.read(second.id))?.content).toBe('two\n');
    expect(await readdir(join(root, 'recovery'))).toHaveLength(1);
  });

  it('supports untitled documents with a caller-supplied id', async () => {
    const recoveryId = `untitled-${randomUUID()}`;
    const written = await store.write(payload({
      path: null,
      name: '未命名文稿',
      baseVersion: null,
      recoveryId,
    }));
    expect(written.id).toBe(recoveryId);
    expect(written.path).toBeNull();
    expect(written.baseVersion).toBeNull();
  });

  it('discards by id and by path', async () => {
    const one = await store.write(payload({ content: 'one\n' }));
    const two = await store.write(payload({
      path: join(root, 'notes', 'other.md'),
      name: 'other.md',
      content: 'two\n',
    }));

    await store.discard(one.id);
    await store.discardPath(String(two.path));
    expect(await store.list()).toEqual([]);
    expect(await store.read(one.id)).toBeNull();
  });

  it('serializes a discard after an in-flight write', async () => {
    const p = payload({ content: 'late autosave\n' });
    const write = store.write(p);
    const discard = store.discardPath(String(p.path));
    await Promise.all([write, discard]);
    expect(await store.list()).toEqual([]);
  });

  it('rejects malformed ids and survives a corrupt snapshot file', async () => {
    const good = await store.write(payload());
    await writeFile(join(root, 'recovery', 'broken.json'), '{not json', 'utf8');

    expect(await store.list()).toHaveLength(1);
    expect((await store.list())[0].id).toBe(good.id);
    await expect(store.read('../escape')).rejects.toThrow(/ID/);
    await expect(store.discard('not-an-id')).rejects.toThrow(/ID/);
  });

  it('normalizes Windows path ids case-insensitively', () => {
    const a = recoveryIdForPath('C:\\Notes\\Draft.md');
    const b = recoveryIdForPath('c:/notes/draft.md');
    if (process.platform === 'win32') {
      expect(a).toBe(b);
    } else {
      expect(a).not.toBe(b);
    }
  });
});
