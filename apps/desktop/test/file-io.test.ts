import { chmod, mkdir, mkdtemp, readFile, readdir, rm, truncate, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_BYTES, readMarkdownFile, writeMarkdownFile } from '../src/main/file-io';

let directory = '';

function notePath(name = 'note.md'): string {
  return join(directory, name);
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'gather-file-io-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('desktop file reading', () => {
  it('decodes BOM + CRLF into editor text and metadata', async () => {
    const path = notePath();
    await writeFile(path, '\uFEFF# 标题\r\n\r\n正文\r\n', 'utf8');

    const opened = await readMarkdownFile(path);

    expect(opened.content).toBe('# 标题\n\n正文\n');
    expect(opened.format).toEqual({ bom: true, eol: 'crlf' });
    expect(opened.size).toBeGreaterThan(0);
    expect(opened.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects UTF-16 and NUL-containing input without writing', async () => {
    const utf16 = notePath('utf16.md');
    const nul = notePath('nul.md');
    await writeFile(utf16, Buffer.from([0xff, 0xfe, 0x61, 0x00]));
    await writeFile(nul, Buffer.from([0x61, 0x00, 0x62]));

    await expect(readMarkdownFile(utf16)).rejects.toThrow(/UTF-16/);
    await expect(readMarkdownFile(nul)).rejects.toThrow(/NUL/);
  });
});

describe('desktop file saving', () => {
  it('round-trips BOM + CRLF byte-for-byte', async () => {
    const path = notePath();
    const original = '\uFEFF# 标题\r\n\r\n正文\r\n';
    await writeFile(path, original, 'utf8');
    const opened = await readMarkdownFile(path);

    const result = await writeMarkdownFile(path, opened.content, {
      format: opened.format,
      expected: opened,
    });

    expect(result.ok).toBe(true);
    expect(await readFile(path, 'utf8')).toBe(original);
    if (result.ok) expect(result.file.digest).toBe(opened.digest);
  });

  it('refuses to overwrite a file changed by another program', async () => {
    const path = notePath();
    await writeFile(path, 'original\n', 'utf8');
    const opened = await readMarkdownFile(path);
    await writeFile(path, 'external change\n', 'utf8');

    const result = await writeMarkdownFile(path, 'mine\n', {
      format: opened.format,
      expected: opened,
    });

    expect(result).toMatchObject({ ok: false, reason: 'conflict' });
    expect(await readFile(path, 'utf8')).toBe('external change\n');
    expect(await readdir(directory)).toEqual(['note.md']);
  });

  it('refuses to save when the original file disappeared', async () => {
    const path = notePath();
    await writeFile(path, 'original\n', 'utf8');
    const opened = await readMarkdownFile(path);
    await unlink(path);

    const result = await writeMarkdownFile(path, 'mine\n', {
      format: opened.format,
      expected: opened,
    });

    expect(result).toMatchObject({ ok: false, reason: 'conflict' });
    expect(await readdir(directory)).toEqual([]);
  });

  it('allows Save As to replace an existing destination without a version', async () => {
    const path = notePath('save-as.md');
    await writeFile(path, 'old\n', 'utf8');

    const result = await writeMarkdownFile(path, 'new\n', {
      format: { bom: false, eol: 'lf' },
    });

    expect(result.ok).toBe(true);
    expect(await readFile(path, 'utf8')).toBe('new\n');
  });

  it('normalizes mixed line endings to LF on an explicit save', async () => {
    const path = notePath('mixed.md');
    await writeFile(path, 'a\r\nb\nc\r', 'utf8');
    const opened = await readMarkdownFile(path);
    expect(opened.format.eol).toBe('mixed');

    const result = await writeMarkdownFile(path, opened.content, {
      format: opened.format,
      expected: opened,
    });

    expect(result.ok).toBe(true);
    expect(await readFile(path, 'utf8')).toBe('a\nb\nc\n');
  });
});

describe('file limits and failures', () => {
  it('rejects files over 20 MiB before reading them', async () => {
    const path = notePath('too-big.md');
    await writeFile(path, '');
    await truncate(path, MAX_BYTES + 1);

    await expect(readMarkdownFile(path)).rejects.toThrow(/20 MiB/);
  });

  it('rejects encoded output that expands over 20 MiB', async () => {
    const path = notePath('expand.md');
    const text = 'a\n'.repeat(Math.ceil(MAX_BYTES * 0.4));
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThan(MAX_BYTES);

    await expect(writeMarkdownFile(path, text, {
      format: { bom: false, eol: 'crlf' },
    })).rejects.toThrow(/编码后超过 20 MiB/);
  });

  it('rejects directories and missing parent directories', async () => {
    await writeFile(notePath('keep.md'), 'keep\n');
    await expect(readMarkdownFile(directory)).rejects.toThrow(/Markdown 文件/);

    const missing = join(directory, 'missing', 'note.md');
    await expect(writeMarkdownFile(missing, 'new\n', {
      format: { bom: false, eol: 'lf' },
    })).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readdir(directory)).toContain('keep.md');
  });

  it.skipIf(process.platform === 'win32')(
    'reports a real EACCES from a read-only directory without touching files',
    async () => {
      const blocked = join(directory, 'blocked');
      const existing = join(blocked, 'keep.md');
      await mkdir(blocked);
      await writeFile(existing, 'keep\n', 'utf8');
      try {
        await chmod(blocked, 0o500);
        await expect(writeMarkdownFile(join(blocked, 'new.md'), 'new\n', {
          format: { bom: false, eol: 'lf' },
        })).rejects.toMatchObject({ code: 'EACCES' });
        expect(await readFile(existing, 'utf8')).toBe('keep\n');
      } finally {
        await chmod(blocked, 0o700);
      }
    },
  );
});
