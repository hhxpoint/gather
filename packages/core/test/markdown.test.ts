import { describe, expect, it } from 'vitest';
import { countText, escapeHtml, renderDocumentHtml, renderMarkdown } from '../src';

describe('markdown rendering', () => {
  it('renders GFM headings and escapes raw HTML', () => {
    const html = renderMarkdown('# 标题\n\n<script>alert(1)</script>\n\n**粗体**');
    expect(html).toContain('<h1>标题</h1>');
    expect(html).toContain('<strong>粗体</strong>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('alert(1)');
  });

  it('sanitizes links and images', () => {
    const html = renderMarkdown('[bad](javascript:alert(1)) ![x](https://example.com/x.png)');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('https://example.com/x.png');
    expect(html).toContain('rel="noreferrer noopener"');
  });

  it('renders GFM tables and task lists', () => {
    const html = renderMarkdown('| A | B |\n| - | - |\n| 1 | 2 |\n\n- [x] done');
    expect(html).toContain('<table>');
    expect(html).toContain('type="checkbox"');
  });

  it('builds a complete printable document', () => {
    const html = renderDocumentHtml('# Hello', 'A & B');
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<title>A &amp; B</title>');
    expect(html).toContain('<h1>Hello</h1>');
  });

  it('escapes standalone values', () => {
    expect(escapeHtml('<&"\'')).toBe('&lt;&amp;&quot;&#39;');
  });
});

describe('text counts', () => {
  it('counts Latin words and CJK characters', () => {
    const result = countText('Hello world\n你好世界');
    expect(result.words).toBe(6);
    expect(result.lines).toBe(2);
  });
});
