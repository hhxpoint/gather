import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildExportDocument,
  inlineLocalImages,
  sanitizeExportStem,
} from '../src/main/export-html';

// 1x1 transparent PNG.
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

let root = '';
let outside = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'gather-export-html-'));
  outside = await mkdtemp(join(tmpdir(), 'gather-export-outside-'));
  await mkdir(join(root, 'assets'), { recursive: true });
  await writeFile(join(root, 'assets', 'pixel.png'), PIXEL);
  await writeFile(join(root, 'assets', 'pixel copy.png'), PIXEL);
  await writeFile(join(root, 'assets', 'mark.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  await writeFile(join(outside, 'secret.png'), PIXEL);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe('self-contained export HTML', () => {
  it('embeds a relative raster image as a data URI', async () => {
    const document = await buildExportDocument('# 图片\n\n![像素](assets/pixel.png)', '文稿', root);
    expect(document.warnings).toEqual([]);
    expect(document.html).toContain('src="data:image/png;base64,');
    expect(document.html).not.toContain('src="assets/pixel.png"');
    expect(document.html).toContain('alt="像素"');
  });

  it('decodes URL-encoded local filenames', async () => {
    const document = await buildExportDocument('![space](assets/pixel%20copy.png)', '文稿', root);
    expect(document.warnings).toEqual([]);
    expect(document.html).toContain('data:image/png;base64,');
  });

  it('rejects paths outside the document directory', async () => {
    const document = await inlineLocalImages(
      `<p><img src="${outside.replaceAll('\\', '/')}/secret.png" alt="secret"></p>`,
      root,
    );
    expect(document.warnings[0]).toContain('绝对路径');
    expect(document.html).not.toContain('data:image/png');
  });

  it('warns for unsupported and missing images without failing the export', async () => {
    const document = await buildExportDocument(
      '![svg](assets/mark.svg)\n\n![missing](assets/missing.png)',
      '文稿',
      root,
    );
    expect(document.warnings).toHaveLength(2);
    expect(document.warnings.join('\n')).toContain('位图');
    expect(document.warnings.join('\n')).toContain('未找到');
    expect(document.html).toContain('src="assets/missing.png"');
  });

  it('leaves image syntax inside code untouched', async () => {
    const document = await buildExportDocument('```md\n![x](assets/pixel.png)\n```', '文稿', root);
    expect(document.html).toContain('![x](assets/pixel.png)');
    expect(document.html).not.toContain('data:image/png');
  });

  it('does not touch remote or data image references', async () => {
    const html = '<p><img src="https://example.com/a.png" alt="a"><img src="data:image/png;base64,AA==" alt="b"></p>';
    const document = await inlineLocalImages(html, root);
    expect(document.html).toBe(html);
    expect(document.warnings).toEqual([]);
  });

  it('returns the rendered HTML unchanged without a base directory', async () => {
    const document = await buildExportDocument('![pixel](assets/pixel.png)', '文稿', null);
    expect(document.html).toContain('src="assets/pixel.png"');
    expect(document.warnings).toEqual([]);
  });

  it('warns instead of failing when the document directory disappears', async () => {
    const missing = join(root, 'deleted-directory');
    const document = await buildExportDocument('![pixel](pixel.png)', '文稿', missing);
    expect(document.warnings).toEqual(['文稿目录不可用，本地图片未嵌入导出文件。']);
    expect(document.html).toContain('src="pixel.png"');
  });
});

describe('export filename stems', () => {
  it('removes Markdown extensions and unsafe filename characters', () => {
    expect(sanitizeExportStem('notes.md')).toBe('notes');
    expect(sanitizeExportStem('a/b:c*?.markdown')).toBe('a-b-c--');
    expect(sanitizeExportStem('  ..  ')).toBe('未命名文稿');
    expect(sanitizeExportStem('CON')).toBe('CON-文稿');
  });
});
