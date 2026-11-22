import { describe, expect, it } from 'vitest';
import { ExternalLinkError, safeExternalUrl } from '../src/shared/external-links';

describe('external link boundary', () => {
  it('normalizes ordinary web links', () => {
    expect(safeExternalUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(safeExternalUrl('http://example.com')).toBe('http://example.com/');
  });

  it.each([
    'javascript:alert(1)',
    'file:///C:/secret.txt',
    'data:text/html,<script>alert(1)</script>',
    'mailto:someone@example.com',
    'ftp://example.com/file',
    'relative/path',
    'not a url',
  ])('rejects %s', value => {
    expect(() => safeExternalUrl(value)).toThrow(ExternalLinkError);
  });

  it('rejects credentials in the authority', () => {
    expect(() => safeExternalUrl('https://user:pass@example.com/')).toThrow(/账号或密码/);
  });

  it('rejects empty and non-string values', () => {
    expect(() => safeExternalUrl('')).toThrow(/为空/);
    expect(() => safeExternalUrl(null)).toThrow(/为空/);
  });
});
