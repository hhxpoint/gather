import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearPreviewImageCache, resolvePreviewImage } from '../src/main/image-preview';

const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

let root = '';
let outside = '';
let activeFile = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'gather-preview-image-'));
  outside = await mkdtemp(join(tmpdir(), 'gather-preview-outside-'));
  activeFile = join(root, 'note.md');
  await writeFile(activeFile, '# note');
  await mkdir(join(root, 'assets'), { recursive: true });
  await writeFile(join(root, 'assets', 'pixel.png'), PIXEL);
  await writeFile(join(root, 'assets', 'pixel copy.png'), PIXEL);
  await writeFile(join(root, 'assets', 'vector.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  await writeFile(join(outside, 'secret.png'), PIXEL);
  clearPreviewImageCache();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe('live preview image resolver', () => {
  it('resolves a document-relative raster image to a data URI', async () => {
    const value = await resolvePreviewImage('assets/pixel.png', activeFile);
    expect(value?.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('decodes URL-encoded filenames', async () => {
    const value = await resolvePreviewImage('assets/pixel%20copy.png', activeFile);
    expect(value?.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('rejects traversal, absolute, remote and unsupported references', async () => {
    expect(await resolvePreviewImage('../secret.png', activeFile)).toBeNull();
    expect(await resolvePreviewImage('%2e%2e/secret.png', activeFile)).toBeNull();
    expect(await resolvePreviewImage('C:/Windows/win.ini', activeFile)).toBeNull();
    expect(await resolvePreviewImage('https://example.com/x.png', activeFile)).toBeNull();
    expect(await resolvePreviewImage('assets/missing.png', activeFile)).toBeNull();
    expect(await resolvePreviewImage('assets/vector.svg', activeFile)).toBeNull();
  });

  it('returns null without an active file path', async () => {
    expect(await resolvePreviewImage('assets/pixel.png', null)).toBeNull();
  });

  it('keeps the resolved payload stable across the short cache window', async () => {
    const first = await resolvePreviewImage('assets/pixel.png', activeFile);
    const second = await resolvePreviewImage('assets/pixel.png', activeFile);
    expect(first).toBe(second);
    expect(await readFile(join(root, 'assets', 'pixel.png'))).toEqual(PIXEL);
  });
});
