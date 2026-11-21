import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEXT_FORMAT,
  decodeText,
  describeTextFormat,
  encodeText,
  normalizeTextFormat,
} from '../src/text-format';

describe('text format detection', () => {
  it('keeps LF files as LF without a BOM', () => {
    const decoded = decodeText('# 标题\n\n正文\n');
    expect(decoded.text).toBe('# 标题\n\n正文\n');
    expect(decoded.format).toEqual({ bom: false, eol: 'lf' });
  });

  it('normalizes CRLF for the editor and remembers the original format', () => {
    const raw = '\uFEFF# 标题\r\n\r\n正文\r\n';
    const decoded = decodeText(raw);
    expect(decoded.text).toBe('# 标题\n\n正文\n');
    expect(decoded.format).toEqual({ bom: true, eol: 'crlf' });
  });

  it('marks mixed and lone-CR files as mixed', () => {
    expect(decodeText('a\r\nb\nc').format.eol).toBe('mixed');
    expect(decodeText('a\rb').format.eol).toBe('mixed');
    expect(decodeText('a\r\nb\r\n').format.eol).toBe('crlf');
    expect(decodeText('a\nb\n').format.eol).toBe('lf');
  });

  it('treats an empty file as LF and preserves it', () => {
    const decoded = decodeText('');
    expect(decoded.text).toBe('');
    expect(decoded.format).toEqual({ bom: false, eol: 'lf' });
    expect(encodeText(decoded.text, decoded.format)).toBe('');
  });
});

describe('text format encoding', () => {
  it('round-trips BOM + CRLF byte-for-byte', () => {
    const raw = '\uFEFF# 标题\r\n\r\n正文\r\n';
    const decoded = decodeText(raw);
    expect(encodeText(decoded.text, decoded.format)).toBe(raw);
  });

  it('round-trips LF without adding a final newline', () => {
    const raw = '# 标题\n\n没有结尾换行';
    const decoded = decodeText(raw);
    expect(encodeText(decoded.text, decoded.format)).toBe(raw);
  });

  it('normalizes mixed line endings to LF on save', () => {
    const decoded = decodeText('a\r\nb\nc\r');
    expect(decoded.format.eol).toBe('mixed');
    expect(encodeText(decoded.text, decoded.format)).toBe('a\nb\nc\n');
    expect(describeTextFormat(decoded.format)).toBe('UTF-8 · 混合行尾');
  });

  it('normalizes editor text before encoding', () => {
    expect(encodeText('a\r\nb', { bom: false, eol: 'crlf' })).toBe('a\r\nb');
    expect(encodeText('a\r\nb', { bom: true, eol: 'lf' })).toBe('\uFEFFa\nb');
  });
});

describe('text format validation', () => {
  it('falls back to a safe default for invalid IPC data', () => {
    expect(normalizeTextFormat(null)).toEqual(DEFAULT_TEXT_FORMAT);
    expect(normalizeTextFormat({ bom: 'yes', eol: 'crlf ' })).toEqual({ bom: false, eol: 'lf' });
    expect(normalizeTextFormat({ bom: true, eol: 'crlf' })).toEqual({ bom: true, eol: 'crlf' });
  });

  it('describes BOM and pure line endings', () => {
    expect(describeTextFormat({ bom: true, eol: 'crlf' })).toBe('UTF-8 BOM · CRLF');
    expect(describeTextFormat({ bom: false, eol: 'lf' })).toBe('UTF-8 · LF');
  });
});
