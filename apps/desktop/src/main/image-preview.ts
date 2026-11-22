import { realpath } from 'node:fs/promises';
import { dirname } from 'node:path';
import { readLocalImageDataUri } from './export-html';

const CACHE_TTL_MS = 5_000;
const CACHE_LIMIT = 40;

interface CacheEntry {
  at: number;
  dataUri: string | null;
}

const cache = new Map<string, CacheEntry>();

export function clearPreviewImageCache(): void {
  cache.clear();
}

/**
 * Resolve a Markdown-relative image for the renderer. The active file's
 * directory is the only allowed root; absolute/file:/remote URLs return null.
 * A short cache avoids repeatedly reading the same image while the decoration
 * layer is rebuilt on selection changes.
 */
export async function resolvePreviewImage(
  src: string,
  activeFilePath: string | null,
): Promise<string | null> {
  if (!activeFilePath) return null;
  if (!src || src.length > 4096 || src.includes('\u0000')) return null;
  if (src.startsWith('//') || src.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(src)) {
    return null;
  }

  const pathPart = src.split(/[?#]/, 1)[0];
  if (!pathPart) return null;
  let relativePath: string;
  try {
    relativePath = decodeURIComponent(pathPart);
  } catch {
    return null;
  }
  if (relativePath.startsWith('/') || relativePath.startsWith('\\')) return null;

  let root: string;
  try {
    root = await realpath(dirname(activeFilePath));
  } catch {
    return null;
  }

  const key = `${root}\0${relativePath}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.dataUri;

  const result = await readLocalImageDataUri(relativePath, root);
  const dataUri = 'dataUri' in result ? result.dataUri : null;
  cache.set(key, { at: now, dataUri });
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (!oldest) break;
    cache.delete(oldest);
  }
  return dataUri;
}
