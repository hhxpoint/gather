import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  normalizeWindowState,
  WindowStateStore,
  WorkspaceSessionStore,
} from '../src/main/session';

let root = '';

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'gather-session-')));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const primary = { x: 0, y: 0, width: 1920, height: 1080 };
const second = { x: 1920, y: 0, width: 1920, height: 1080 };

describe('window state normalization', () => {
  it('keeps a visible window unchanged', () => {
    const state = normalizeWindowState(
      { x: 100, y: 80, width: 1200, height: 820, maximized: false },
      [primary],
      primary,
    );
    expect(state).toEqual({ x: 100, y: 80, width: 1200, height: 820, maximized: false });
  });

  it('centers an off-screen window on the primary display', () => {
    const state = normalizeWindowState(
      { x: 9000, y: 9000, width: 1200, height: 820, maximized: true },
      [primary, second],
      primary,
    );
    expect(state).toEqual({ x: 360, y: 130, width: 1200, height: 820, maximized: true });
  });

  it('clamps a partially visible window into its display', () => {
    const state = normalizeWindowState(
      { x: 1500, y: 900, width: 1200, height: 820, maximized: false },
      [primary],
      primary,
    );
    expect(state).toEqual({ x: 720, y: 260, width: 1200, height: 820, maximized: false });
  });

  it('enforces the minimum window size', () => {
    const state = normalizeWindowState(
      { x: 20, y: 20, width: 100, height: 100, maximized: false },
      [primary],
      primary,
    );
    expect(state.width).toBe(MIN_WINDOW_WIDTH);
    expect(state.height).toBe(MIN_WINDOW_HEIGHT);
  });

  it('chooses the display with the largest overlap', () => {
    const state = normalizeWindowState(
      { x: 1850, y: 100, width: 1200, height: 820, maximized: false },
      [primary, second],
      primary,
    );
    // The window is mostly on the second display and must stay there.
    expect(state.x).toBeGreaterThanOrEqual(second.x);
  });
});

describe('window state store', () => {
  it('round-trips through async and sync writes', async () => {
    const store = new WindowStateStore(join(root, 'window.json'));
    const state = { x: 10, y: 20, width: 1000, height: 700, maximized: false };
    await store.write(state);
    expect(await store.read()).toEqual(state);

    store.writeSync({ ...state, maximized: true, width: 1100 });
    expect(await store.read()).toEqual({ ...state, maximized: true, width: 1100 });
    const raw = await readFile(join(root, 'window.json'), 'utf8');
    expect(raw).toContain('"version": 1');
  });

  it('returns null for corrupt or unsupported state', async () => {
    const file = join(root, 'window.json');
    const store = new WindowStateStore(file);
    await writeFile(file, '{broken');
    expect(await store.read()).toBeNull();

    await writeFile(file, JSON.stringify({ version: 99, x: 0, y: 0, width: 1000, height: 700, maximized: false }));
    expect(await store.read()).toBeNull();
  });
});

describe('workspace session store', () => {
  it('round-trips a root and relative file', async () => {
    const store = new WorkspaceSessionStore(join(root, 'workspace.json'));
    await store.write({ root: 'C:\\Notes', relativePath: 'nested/note.md' });
    expect(await store.read()).toEqual({ root: 'C:\\Notes', relativePath: 'nested/note.md' });

    await store.write({ root: '/home/writer/notes', relativePath: null });
    expect(await store.read()).toEqual({ root: '/home/writer/notes', relativePath: null });
  });

  it('rejects invalid stored paths and versions', async () => {
    const file = join(root, 'workspace.json');
    const store = new WorkspaceSessionStore(file);
    await writeFile(file, JSON.stringify({ version: 1, root: '', relativePath: null }));
    expect(await store.read()).toBeNull();

    await writeFile(file, JSON.stringify({ version: 1, root: '/notes', relativePath: '../secret.md' }));
    expect(await store.read()).toBeNull();

    await writeFile(file, JSON.stringify({ version: 2, root: '/notes', relativePath: null }));
    expect(await store.read()).toBeNull();
  });

  it('refuses to write an invalid session and can clear the file', async () => {
    const file = join(root, 'workspace.json');
    const store = new WorkspaceSessionStore(file);
    await expect(store.write({ root: '', relativePath: null })).rejects.toThrow(/会话/);
    await store.clear();
    expect(await store.read()).toBeNull();
  });
});
