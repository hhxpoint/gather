import { createHash, randomUUID } from 'node:crypto';
import { isUtf8 } from 'node:buffer';
import { readFile, stat, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import {
  decodeText,
  encodeText,
  normalizeTextFormat,
  type TextFormat,
} from '@gather/core/text-format';
import type {
  FileVersion,
  OpenedFile,
  SaveOutcome,
  SavedFile,
} from '../shared/files';
import { renameTemporaryFile, writeTemporaryFile } from './atomic-write';

export const MAX_BYTES = 20 * 1024 * 1024;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;

function isErrno(error: unknown, code: string): boolean {
  return Boolean(
    error
      && typeof error === 'object'
      && 'code' in error
      && (error as NodeJS.ErrnoException).code === code,
  );
}

function digestBytes(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function assertPath(path: unknown): string {
  if (typeof path !== 'string' || !path) throw new Error('缺少文件路径。');
  return path;
}

function assertEditorText(content: unknown): string {
  if (typeof content !== 'string') throw new Error('Expected a text value.');
  if (content.includes('\u0000')) throw new Error('文稿包含 NUL 字符，已拒绝写入。');
  if (Buffer.byteLength(content, 'utf8') > MAX_BYTES) {
    throw new Error('文件超过 20 MiB，暂不支持在 Gather 中保存。');
  }
  return content;
}

function assertExpectedVersion(value: FileVersion | undefined): FileVersion | null {
  if (value === undefined) return null;
  if (
    !value
    || !Number.isFinite(value.mtimeMs)
    || !Number.isInteger(value.size)
    || value.size < 0
    || typeof value.digest !== 'string'
    || !DIGEST_PATTERN.test(value.digest)
  ) {
    throw new Error('文件版本信息无效，请重新打开文稿后再保存。');
  }
  return value;
}

/** Reject binary/UTF-16 input instead of silently replacing bytes with U+FFFD. */
function decodeUtf8(buffer: Buffer): string {
  if (
    buffer.length >= 2
    && ((buffer[0] === 0xff && buffer[1] === 0xfe) || (buffer[0] === 0xfe && buffer[1] === 0xff))
  ) {
    throw new Error('文件不是 UTF-8 文本（检测到 UTF-16 BOM）。请先转换为 UTF-8。');
  }
  if (!isUtf8(buffer)) {
    throw new Error('文件不是有效的 UTF-8 文本，Gather 未执行任何写入。');
  }
  const text = buffer.toString('utf8');
  if (text.includes('\u0000')) {
    throw new Error('文件包含 NUL 字符，可能不是纯文本。Gather 未执行任何写入。');
  }
  return text;
}

export async function readMarkdownFile(path: string): Promise<OpenedFile> {
  const target = assertPath(path);
  const info = await stat(target);
  if (!info.isFile()) throw new Error('请选择一个 Markdown 文件。');
  if (info.size > MAX_BYTES) throw new Error('文件超过 20 MiB，暂不支持在 Gather 中打开。');

  const buffer = await readFile(target);
  if (buffer.length > MAX_BYTES) {
    throw new Error('文件超过 20 MiB，暂不支持在 Gather 中打开。');
  }
  const decoded = decodeText(decodeUtf8(buffer));

  return {
    path: target,
    name: basename(target),
    content: decoded.text,
    format: decoded.format,
    mtimeMs: info.mtimeMs,
    size: buffer.length,
    digest: digestBytes(buffer),
  };
}

/**
 * Cheap version probe for the active-file watcher. A missing path returns null;
 * files above the editor limit get a sentinel digest so callers can still
 * notice that the destination changed without reading an unbounded file.
 */
export async function readFileVersion(path: string): Promise<FileVersion | null> {
  const target = assertPath(path);
  let info;
  try {
    info = await stat(target);
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return null;
    throw error;
  }
  if (!info.isFile()) return null;
  if (info.size > MAX_BYTES) {
    return { mtimeMs: info.mtimeMs, size: info.size, digest: 'too-large' };
  }
  const buffer = await readFile(target);
  return {
    mtimeMs: info.mtimeMs,
    size: buffer.length,
    digest: digestBytes(buffer),
  };
}

interface Conflict {
  ok: false;
  reason: 'conflict';
  message: string;
}

async function checkExternalChange(path: string, expected: FileVersion): Promise<Conflict | null> {
  let current;
  try {
    current = await stat(path);
  } catch (error) {
    if (isErrno(error, 'ENOENT')) {
      return {
        ok: false,
        reason: 'conflict',
        message: '文件已被移动或删除，Gather 未覆盖任何内容。请重新打开或另存为。',
      };
    }
    throw error;
  }

  if (!current.isFile()) {
    return {
      ok: false,
      reason: 'conflict',
      message: '原路径已不是普通文件，Gather 未执行保存。',
    };
  }
  if (current.size > MAX_BYTES) {
    return {
      ok: false,
      reason: 'conflict',
      message: '文件在外部已超过 20 MiB，Gather 未执行保存。',
    };
  }

  const buffer = await readFile(path);
  if (buffer.length !== expected.size || digestBytes(buffer) !== expected.digest) {
    return {
      ok: false,
      reason: 'conflict',
      message: '文件已在其他程序中修改，Gather 拒绝覆盖。请重新打开或另存为。',
    };
  }
  return null;
}

export interface WriteOptions {
  format: TextFormat;
  /** Omit only for Save As, where the user already confirmed replacement. */
  expected?: FileVersion;
}

export async function writeMarkdownFile(
  path: string,
  content: string,
  options: WriteOptions,
): Promise<SaveOutcome> {
  const target = assertPath(path);
  const text = assertEditorText(content);
  const format = normalizeTextFormat(options.format);
  const expected = assertExpectedVersion(options.expected);
  const encoded = Buffer.from(encodeText(text, format), 'utf8');

  if (encoded.length > MAX_BYTES) {
    throw new Error('文件按原行尾编码后超过 20 MiB，Gather 未执行保存。');
  }

  if (expected) {
    const conflict = await checkExternalChange(target, expected);
    if (conflict) return conflict;
  }

  // Write the temporary file first, then re-check the destination before an
  // atomic rename. This narrows the window where another process can slip in
  // between the conflict check and the replacement.
  const temporary = join(dirname(target), `.${basename(target)}.gather-${randomUUID()}.tmp`);
  try {
    await writeTemporaryFile(temporary, encoded);

    if (expected) {
      const conflict = await checkExternalChange(target, expected);
      if (conflict) {
        await unlink(temporary).catch(() => undefined);
        return conflict;
      }
    }
    await renameTemporaryFile(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }

  let savedInfo;
  try {
    savedInfo = await stat(target);
  } catch {
    savedInfo = null;
  }
  const file: SavedFile = {
    path: target,
    name: basename(target),
    format,
    mtimeMs: savedInfo?.mtimeMs ?? Date.now(),
    size: encoded.length,
    digest: digestBytes(encoded),
  };
  return { ok: true, file };
}
