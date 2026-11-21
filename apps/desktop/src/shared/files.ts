import type { TextFormat } from '@gather/core/text-format';

export interface FileVersion {
  /** Modification time reported by the filesystem when the file was read. */
  mtimeMs: number;
  /** Byte length at the same point in time. */
  size: number;
  /** SHA-256 of the exact bytes on disk. */
  digest: string;
}

export interface OpenedFile extends FileVersion {
  path: string;
  name: string;
  /** Editor text with LF line endings and no BOM. */
  content: string;
  format: TextFormat;
}

export interface SavedFile extends FileVersion {
  path: string;
  name: string;
  format: TextFormat;
}

export interface SaveRequest extends FileVersion {
  path: string;
  content: string;
  format: TextFormat;
}

export interface SaveAsRequest {
  content: string;
  format: TextFormat;
}

export type SaveOutcome =
  | { ok: true; file: SavedFile }
  | {
      ok: false;
      reason: 'conflict';
      message: string;
    };
