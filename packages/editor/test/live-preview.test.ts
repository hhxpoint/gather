import { describe, expect, it } from 'vitest';
import {
  isHttpUrl,
  parseImageSyntax,
  parseLinkSyntax,
} from '../src/live-preview';

describe('Markdown image syntax', () => {
  it('parses plain, titled and angle-bracket destinations', () => {
    expect(parseImageSyntax('![像素](assets/x.png)')).toEqual({
      alt: '像素',
      src: 'assets/x.png',
      title: undefined,
    });
    expect(parseImageSyntax('![cover](<assets/a b.png> "标题")')).toEqual({
      alt: 'cover',
      src: 'assets/a b.png',
      title: '标题',
    });
  });

  it('accepts escaped brackets in the alt text', () => {
    expect(parseImageSyntax('![a\\]b](x.png)')?.alt).toBe('a]b');
  });

  it('rejects non-image syntax', () => {
    expect(parseImageSyntax('[link](x.png)')).toBeNull();
    expect(parseImageSyntax('![missing]( )')).toBeNull();
  });
});

describe('Markdown link syntax', () => {
  it('parses a link destination and title', () => {
    expect(parseLinkSyntax('[Gather](https://example.com/docs "文档")')).toEqual({
      text: 'Gather',
      href: 'https://example.com/docs',
      title: '文档',
    });
  });

  it('rejects malformed links', () => {
    expect(parseLinkSyntax('![image](x.png)')).toBeNull();
    expect(parseLinkSyntax('[x]()')).toBeNull();
  });

  it('only treats http and https as openable web links', () => {
    expect(isHttpUrl('https://example.com')).toBe(true);
    expect(isHttpUrl('http://example.com/path')).toBe(true);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('file:///C:/secret.txt')).toBe(false);
    expect(isHttpUrl('relative/path')).toBe(false);
    expect(isHttpUrl('not a url')).toBe(false);
  });
});
