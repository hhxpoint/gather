import { describe, expect, it } from 'vitest';
import {
  cleanHeadingText,
  extractHeadings,
  nearestHeadingLine,
} from '../src/renderer/src/reading-utils';

describe('reading outline', () => {
  it('extracts ATX headings with 1-based lines and skips fenced code', () => {
    const markdown = [
      '# 一级',
      '',
      '```bash',
      '# shell comment',
      'echo hi',
      '```',
      '',
      '## 二级',
      '正文',
      '### 三级 ###',
    ].join('\n');
    expect(extractHeadings(markdown)).toEqual([
      { level: 1, text: '一级', line: 1 },
      { level: 2, text: '二级', line: 8 },
      { level: 3, text: '三级', line: 10 },
    ]);
  });

  it('supports Setext headings and skips list separators', () => {
    const markdown = [
      '标题一',
      '===',
      '',
      '标题二',
      '---',
      '',
      '- 列表项',
      '---',
    ].join('\n');
    const headings = extractHeadings(markdown);
    expect(headings.map(heading => [heading.level, heading.text, heading.line])).toEqual([
      [1, '标题一', 1],
      [2, '标题二', 4],
    ]);
  });

  it('cleans links, images, emphasis, inline code and entities', () => {
    expect(cleanHeadingText('**粗体** [链接](https://x) ![图](a.png) `code` &amp; 尾 ##'))
      .toBe('粗体 链接 图 code & 尾');
  });

  it('finds the nearest heading at or above a source line', () => {
    const headings = [{ line: 1 }, { line: 8 }, { line: 20 }];
    expect(nearestHeadingLine(headings, 1)).toBe(1);
    expect(nearestHeadingLine(headings, 12)).toBe(8);
    expect(nearestHeadingLine(headings, 30)).toBe(20);
    expect(nearestHeadingLine(headings, 0)).toBeNull();
  });

  it('does not turn horizontal rules or blockquotes into headings', () => {
    const markdown = ['---', '', '> 引用', '---', '', '正文'].join('\n');
    expect(extractHeadings(markdown)).toEqual([]);
  });
});
