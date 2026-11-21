import { watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { basename, dirname } from 'node:path';
import { readFileVersion } from './file-io';
import type { ExternalChange, FileVersion } from '../shared/files';

export interface FileWatcherOptions {
  /** Native directory watch; tests can disable it and call checkNow. */
  nativeWatch?: boolean;
  /** Backup stat poll for platforms/editors where fs.watch misses events. */
  pollIntervalMs?: number;
  debounceMs?: number;
}

/**
 * Watches one active document. fs.watch is only a hint; every notification is
 * confirmed against the file's SHA-256 before it reaches the renderer.
 */
export class ActiveFileWatcher {
  private watcher: FSWatcher | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private path: string | null = null;
  private expected: FileVersion | null = null;
  private listener: ((change: ExternalChange) => void) | null = null;
  private checking = false;
  private removed = false;
  private generation = 0;

  constructor(private readonly options: FileWatcherOptions = {}) {}

  watch(path: string, version: FileVersion, listener: (change: ExternalChange) => void): void {
    this.stop();
    this.generation += 1;
    this.path = path;
    this.expected = { ...version };
    this.listener = listener;
    this.removed = false;

    if (this.options.nativeWatch !== false) {
      try {
        this.watcher = watch(dirname(path), { persistent: false }, (_event, filename) => {
          if (!filename || filename.toString() === basename(path)) this.schedule();
        });
        this.watcher.on('error', () => undefined);
      } catch {
        // The stat poll below remains active.
        this.watcher = null;
      }
    }

    const pollIntervalMs = this.options.pollIntervalMs ?? 2000;
    if (pollIntervalMs > 0) {
      this.pollTimer = setInterval(() => {
        void this.checkNow(false);
      }, pollIntervalMs);
    }
  }

  /** Called after our own save/reload so the new bytes are not reported. */
  updateVersion(version: FileVersion): void {
    this.generation += 1;
    this.expected = { ...version };
    this.removed = false;
  }

  stop(): void {
    this.generation += 1;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.debounceTimer = null;
    this.pollTimer = null;
    this.watcher?.close();
    this.watcher = null;
    this.path = null;
    this.expected = null;
    this.listener = null;
    this.checking = false;
    this.removed = false;
  }

  private schedule(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    const debounceMs = this.options.debounceMs ?? 250;
    this.debounceTimer = setTimeout(() => {
      void this.checkNow(true);
    }, debounceMs);
  }

  /** Public for deterministic tests and for the polling fallback. */
  async checkNow(force = true): Promise<ExternalChange | null> {
    if (this.checking || !this.path || !this.listener) return null;
    this.checking = true;
    const generation = this.generation;
    const currentPath = this.path;

    try {
      const current = await readFileVersion(currentPath);
      if (generation !== this.generation || !this.listener) return null;

      if (!current) {
        if (this.removed) return null;
        this.removed = true;
        const change: ExternalChange = { type: 'removed', path: currentPath };
        this.listener(change);
        return change;
      }

      this.removed = false;
      if (
        !force
        && this.expected
        && current.size === this.expected.size
        && current.mtimeMs === this.expected.mtimeMs
      ) {
        return null;
      }
      if (this.expected && current.digest === this.expected.digest) return null;

      this.expected = current;
      const change: ExternalChange = {
        type: 'changed',
        path: currentPath,
        version: current,
      };
      this.listener(change);
      return change;
    } catch {
      return null;
    } finally {
      this.checking = false;
    }
  }
}
