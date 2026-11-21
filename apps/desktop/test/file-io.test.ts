import { mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readMarkdownFile, writeMarkdownFile } from '../src/main/file-io';

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
