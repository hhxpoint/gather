import { describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  renameTemporaryFile,
  replaceFileAtomically,
  writeTemporaryFile,
  type AtomicWriterOps,
} from '../src/main/atomic-write';

function errno(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

interface FailureFlags {
  open?: string;
  write?: string;
  sync?: string;
  close?: string;
  rename?: string;
}

function fakeOps(flags: FailureFlags = {}) {
  const calls: string[] = [];
  const unlinked: string[] = [];
  const ops: AtomicWriterOps = {
    open: async (path) => {
      calls.push('open');
      if (flags.open) throw errno(flags.open);
      return {
        writeFile: async () => {
          calls.push(`write:${path}`);
          if (flags.write) throw errno(flags.write);
        },
        sync: async () => {
          calls.push('sync');
          if (flags.sync) throw errno(flags.sync);
        },
        close: async () => {
          calls.push('close');
          if (flags.close) throw errno(flags.close);
        },
      };
    },
    rename: async (from, to) => {
      calls.push(`rename:${from}->${to}`);
      if (flags.rename) throw errno(flags.rename);
    },
    unlink: async (path) => {
      calls.push(`unlink:${path}`);
      unlinked.push(path);
    },
  };
  return { ops, calls, unlinked };
}

describe('temporary file writes', () => {
  it('writes, fsyncs, closes and leaves the temp file for rename', async () => {
    const fake = fakeOps();
    await writeTemporaryFile('draft.tmp', Buffer.from('hello'), fake.ops);

    expect(fake.calls).toEqual(['open', 'write:draft.tmp', 'sync', 'close']);
    expect(fake.unlinked).toEqual([]);
  });

  it.each([
    ['write', 'ENOSPC'],
    ['sync', 'EIO'],
    ['close', 'EIO'],
  ] as const)('cleans up when %s fails', async (stage, code) => {
    const fake = fakeOps({ [stage]: code });

    await expect(writeTemporaryFile('draft.tmp', Buffer.from('hello'), fake.ops))
      .rejects.toMatchObject({ code });

    expect(fake.unlinked).toContain('draft.tmp');
    expect(fake.calls.some(call => call.startsWith('rename'))).toBe(false);
  });

  it('cleans up when open fails with a full disk', async () => {
    const fake = fakeOps({ open: 'ENOSPC' });
    await expect(writeTemporaryFile('draft.tmp', 'hello', fake.ops)).rejects.toMatchObject({ code: 'ENOSPC' });
    expect(fake.unlinked).toContain('draft.tmp');
  });
});

describe('temporary file renames', () => {
  it('renames the prepared file on success', async () => {
    const fake = fakeOps();
    await renameTemporaryFile('draft.tmp', 'draft.md', fake.ops);
    expect(fake.calls).toEqual(['rename:draft.tmp->draft.md']);
    expect(fake.unlinked).toEqual([]);
  });

  it('removes the temp file when rename is denied', async () => {
    const fake = fakeOps({ rename: 'EACCES' });
    await expect(renameTemporaryFile('draft.tmp', 'draft.md', fake.ops))
      .rejects.toMatchObject({ code: 'EACCES' });
    expect(fake.unlinked).toContain('draft.tmp');
  });
});

describe('atomic replacement', () => {
  it('uses a hidden unique temp file in the destination directory', async () => {
    const fake = fakeOps();
    const target = join(tmpdir(), 'gather-atomic-test', 'draft.md');
    await replaceFileAtomically(target, 'new content', fake.ops);

    const writeCall = fake.calls.find(call => call.startsWith('write:'))!;
    const tempPath = writeCall.slice('write:'.length);
    expect(tempPath.startsWith(join(dirname(target), '.draft.md.gather-'))).toBe(true);
    expect(tempPath.endsWith('.tmp')).toBe(true);
    expect(fake.calls.at(-1)).toBe(`rename:${tempPath}->${target}`);
  });

  it('cleans up and does not rename when the write fails', async () => {
    const fake = fakeOps({ write: 'ENOSPC' });
    const target = join(tmpdir(), 'gather-atomic-test', 'draft.md');
    await expect(replaceFileAtomically(target, 'new content', fake.ops))
      .rejects.toMatchObject({ code: 'ENOSPC' });
    expect(fake.calls.some(call => call.startsWith('rename'))).toBe(false);
    expect(fake.unlinked).toHaveLength(1);
  });
});
