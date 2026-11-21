import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeTextFormat } from '@gather/core/text-format';
import type {
  FileVersion,
  RecoveryPayload,
  RecoverySnapshot,
  RestoredRecovery,
} from '../shared/files';

const SNAPSHOT_VERSION = 1;
const MAX_SNAPSHOT_FILES = 20;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const UNTITLED_ID_PATTERN = /^untitled-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const MAX_RECOVERY_BYTES = 20 * 1024 * 1024;

interface StoredSnapshot {
  version: number;
  id: string;
  path: string | null;
  name: string;
  content: string;
  format: RecoverySnapshot['format'];
  baseVersion: FileVersion | null;
  savedAt: string;
}

function assertId(value: unknown): string {
  if (typeof value !== 'string' || (!DIGEST_PATTERN.test(value) && !UNTITLED_ID_PATTERN.test(value))) {
    throw new Error('恢复快照 ID 无效。');
  }
  return value;
}

export function recoveryIdForPath(path: string): string {
  const normalized = process.platform === 'win32'
    ? path.replace(/\\/g, '/').toLowerCase()
    : path;
  return createHash('sha256').update(normalized).digest('hex');
}

function normalizeVersion(value: unknown): FileVersion | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('恢复快照的文件版本无效。');
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.mtimeMs !== 'number'
    || !Number.isFinite(record.mtimeMs)
    || typeof record.size !== 'number'
    || !Number.isInteger(record.size)
    || record.size < 0
    || typeof record.digest !== 'string'
    || !DIGEST_PATTERN.test(record.digest)
  ) {
    throw new Error('恢复快照的文件版本无效。');
  }
  return {
    mtimeMs: record.mtimeMs,
    size: record.size,
    digest: record.digest,
  };
}

function parseSnapshot(raw: string): StoredSnapshot {
  const value = JSON.parse(raw) as Record<string, unknown>;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('恢复快照格式无效。');
  }
  if (value.version !== SNAPSHOT_VERSION) {
    throw new Error('恢复快照版本不受支持。');
  }
  const id = assertId(value.id);
  const path = value.path === null ? null : value.path;
  if (path !== null && (typeof path !== 'string' || !path)) {
    throw new Error('恢复快照路径无效。');
  }
  if (typeof value.name !== 'string' || !value.name) {
    throw new Error('恢复快照名称无效。');
  }
  if (typeof value.content !== 'string' || value.content.includes('\u0000')) {
    throw new Error('恢复快照内容无效。');
  }
  if (Buffer.byteLength(value.content, 'utf8') > MAX_RECOVERY_BYTES) {
    throw new Error('恢复快照超过 20 MiB。');
  }
  if (typeof value.savedAt !== 'string' || Number.isNaN(Date.parse(value.savedAt))) {
    throw new Error('恢复快照时间无效。');
  }
  return {
    version: SNAPSHOT_VERSION,
    id,
    path,
    name: value.name,
    content: value.content.replace(/\r\n?/g, '\n'),
    format: normalizeTextFormat(value.format),
    baseVersion: normalizeVersion(value.baseVersion),
    savedAt: value.savedAt,
  };
}

function toMetadata(snapshot: StoredSnapshot): RecoverySnapshot {
  return {
    id: snapshot.id,
    path: snapshot.path,
    name: snapshot.name,
    format: snapshot.format,
    baseVersion: snapshot.baseVersion,
    bytes: Buffer.byteLength(snapshot.content, 'utf8'),
    savedAt: snapshot.savedAt,
  };
}

function validatePayload(payload: RecoveryPayload): RecoveryPayload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('恢复快照请求格式无效。');
  }
  const path = payload.path;
  if (path !== null && (typeof path !== 'string' || !path)) {
    throw new Error('恢复快照路径无效。');
  }
  if (typeof payload.name !== 'string' || !payload.name || payload.name.length > 512) {
    throw new Error('恢复快照名称无效。');
  }
  if (typeof payload.content !== 'string') {
    throw new Error('恢复快照内容无效。');
  }
  if (payload.content.includes('\u0000')) {
    throw new Error('恢复快照包含 NUL 字符。');
  }
  if (Buffer.byteLength(payload.content, 'utf8') > MAX_RECOVERY_BYTES) {
    throw new Error('恢复快照超过 20 MiB。');
  }
  if (payload.recoveryId !== undefined) assertId(payload.recoveryId);
  return {
    path,
    name: payload.name,
    content: payload.content.replace(/\r\n?/g, '\n'),
    format: normalizeTextFormat(payload.format),
    baseVersion: normalizeVersion(payload.baseVersion),
    recoveryId: payload.recoveryId,
  };
}

export class RecoveryStore {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly directory: string) {}

  async init(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
  }

  /**
   * Serialize writes and deletes. A successful file save queues its snapshot
   * cleanup after any in-flight autosave, so a late autosave cannot resurrect
   * a recovery that was just made obsolete.
   */
  private runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  private fileFor(id: string): string {
    return join(this.directory, `${assertId(id)}.json`);
  }

  private async writeFileAtomic(target: string, content: string): Promise<void> {
    const temporary = `${target}.tmp-${randomUUID()}`;
    let handle: FileHandle | undefined;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(content, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporary, target);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  async write(payload: RecoveryPayload): Promise<RecoverySnapshot> {
    const safe = validatePayload(payload);
    const id = safe.path
      ? recoveryIdForPath(safe.path)
      : safe.recoveryId ?? `untitled-${randomUUID()}`;
    const stored: StoredSnapshot = {
      version: SNAPSHOT_VERSION,
      id,
      path: safe.path,
      name: safe.name,
      content: safe.content,
      format: safe.format,
      baseVersion: safe.baseVersion,
      savedAt: new Date().toISOString(),
    };
    return this.runExclusive(async () => {
      await this.writeFileAtomic(this.fileFor(id), JSON.stringify(stored));
      await this.pruneUnlocked();
      return toMetadata(stored);
    });
  }

  async list(): Promise<RecoverySnapshot[]> {
    let entries;
    try {
      entries = await readdir(this.directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }

    const snapshots: StoredSnapshot[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      try {
        const raw = await readFile(join(this.directory, entry.name), 'utf8');
        const snapshot = parseSnapshot(raw);
        if (entry.name !== `${snapshot.id}.json`) continue;
        snapshots.push(snapshot);
      } catch {
        // A corrupt or partially written snapshot must not block recovery of
        // other files. It stays on disk for manual inspection.
      }
    }
    snapshots.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    return snapshots.map(toMetadata);
  }

  async read(id: string): Promise<RestoredRecovery | null> {
    let raw: string;
    try {
      raw = await readFile(this.fileFor(id), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    const snapshot = parseSnapshot(raw);
    if (snapshot.id !== id) throw new Error('恢复快照 ID 不匹配。');
    return {
      ...toMetadata(snapshot),
      content: snapshot.content,
    };
  }

  async discard(id: string): Promise<void> {
    const target = this.fileFor(id);
    await this.runExclusive(async () => {
      await this.discardFile(target);
    });
  }

  async discardPath(path: string): Promise<void> {
    await this.discard(recoveryIdForPath(path));
  }

  private async discardFile(target: string): Promise<void> {
    try {
      await unlink(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private async pruneUnlocked(): Promise<void> {
    const snapshots = await this.list();
    if (snapshots.length <= MAX_SNAPSHOT_FILES) return;
    for (const snapshot of snapshots.slice(MAX_SNAPSHOT_FILES)) {
      await this.discardFile(this.fileFor(snapshot.id)).catch(() => undefined);
    }
  }
}
