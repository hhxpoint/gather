import { randomUUID } from 'node:crypto';
import { open, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

export interface AtomicFileHandle {
  writeFile(data: Uint8Array | string): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface AtomicWriterOps {
  open: (path: string, flags: 'wx', mode: number) => Promise<AtomicFileHandle>;
  rename: (from: string, to: string) => Promise<void>;
  unlink: (path: string) => Promise<void>;
}

export const nodeAtomicWriterOps: AtomicWriterOps = {
  open: (path, flags, mode) => open(path, flags, mode),
  rename,
  unlink,
};

/**
 * Write an exclusive temporary file, fsync it, and close it. On any failure the
 * temp file is removed; the destination is never touched here.
 */
export async function writeTemporaryFile(
  temporary: string,
  data: Uint8Array | string,
  ops: AtomicWriterOps = nodeAtomicWriterOps,
): Promise<void> {
  let handle: AtomicFileHandle | undefined;
  try {
    handle = await ops.open(temporary, 'wx', 0o600);
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = undefined;
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await ops.unlink(temporary).catch(() => undefined);
    throw error;
  }
}

/** Rename the prepared temp file, removing it if replacement fails. */
export async function renameTemporaryFile(
  temporary: string,
  target: string,
  ops: AtomicWriterOps = nodeAtomicWriterOps,
): Promise<void> {
  try {
    await ops.rename(temporary, target);
  } catch (error) {
    await ops.unlink(temporary).catch(() => undefined);
    throw error;
  }
}

/** Convenience for callers that do not need a pre-rename check. */
export async function replaceFileAtomically(
  target: string,
  data: Uint8Array | string,
  ops: AtomicWriterOps = nodeAtomicWriterOps,
): Promise<void> {
  const temporary = join(dirname(target), `.${basename(target)}.gather-${randomUUID()}.tmp`);
  await writeTemporaryFile(temporary, data, ops);
  await renameTemporaryFile(temporary, target, ops);
}
