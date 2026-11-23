import { readFile, unlink } from 'node:fs/promises';
import { replaceFileAtomically, replaceFileAtomicallySync } from './atomic-write';

const SESSION_VERSION = 1;
const MAX_PATH_LENGTH = 4096;
const MAX_WINDOW_DIMENSION = 10000;

export const MIN_WINDOW_WIDTH = 760;
export const MIN_WINDOW_HEIGHT = 520;

export interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SavedWindowState extends WindowRect {
  maximized: boolean;
}

export interface WorkspaceSession {
  root: string;
  /** POSIX-style path relative to root, or null for the workspace only. */
  relativePath: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validPath(value: unknown, allowNull: boolean): string | null | undefined {
  if (value === null && allowNull) return null;
  if (typeof value !== 'string' || !value || value.length > MAX_PATH_LENGTH || value.includes('\0')) {
    return undefined;
  }
  return value;
}

function validRelativePath(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string' || !value || value.length > MAX_PATH_LENGTH || value.includes('\0')) {
    return undefined;
  }
  if (value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:/.test(value)) return undefined;
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) return undefined;
  return value;
}

function parseWindowRecord(value: unknown): SavedWindowState | null {
  if (!isRecord(value) || value.version !== SESSION_VERSION) return null;
  if (
    !finiteNumber(value.x)
    || !finiteNumber(value.y)
    || !finiteNumber(value.width)
    || !finiteNumber(value.height)
    || value.width <= 0
    || value.height <= 0
    || value.width > MAX_WINDOW_DIMENSION
    || value.height > MAX_WINDOW_DIMENSION
    || typeof value.maximized !== 'boolean'
  ) {
    return null;
  }
  return {
    x: Math.round(value.x),
    y: Math.round(value.y),
    width: Math.round(value.width),
    height: Math.round(value.height),
    maximized: value.maximized,
  };
}

function parseWorkspaceRecord(value: unknown): WorkspaceSession | null {
  if (!isRecord(value) || value.version !== SESSION_VERSION) return null;
  const root = validPath(value.root, false);
  const relativePath = validRelativePath(value.relativePath);
  if (typeof root !== 'string' || relativePath === undefined) return null;
  return { root, relativePath };
}

export interface WindowArea extends WindowRect {
  id?: number;
}

/**
 * Keep a saved window on an existing display and above the minimum size.
 * Unknown monitors (or a completely off-screen rectangle) fall back to a
 * centered window on the primary work area.
 */
export function normalizeWindowState(
  state: SavedWindowState,
  areas: WindowArea[],
  primary: WindowArea,
): SavedWindowState {
  let best: WindowArea | null = null;
  let bestArea = 0;
  for (const area of areas) {
    const left = Math.max(state.x, area.x);
    const top = Math.max(state.y, area.y);
    const right = Math.min(state.x + state.width, area.x + area.width);
    const bottom = Math.min(state.y + state.height, area.y + area.height);
    const overlap = Math.max(0, right - left) * Math.max(0, bottom - top);
    if (overlap > bestArea) {
      bestArea = overlap;
      best = area;
    }
  }

  if (!best || bestArea < 80 * 80) {
    const width = Math.min(Math.max(state.width, MIN_WINDOW_WIDTH), primary.width);
    const height = Math.min(Math.max(state.height, MIN_WINDOW_HEIGHT), primary.height);
    return {
      x: primary.x + Math.max(0, Math.round((primary.width - width) / 2)),
      y: primary.y + Math.max(0, Math.round((primary.height - height) / 2)),
      width,
      height,
      maximized: state.maximized,
    };
  }

  const width = Math.min(Math.max(state.width, MIN_WINDOW_WIDTH), best.width);
  const height = Math.min(Math.max(state.height, MIN_WINDOW_HEIGHT), best.height);
  return {
    x: Math.min(Math.max(state.x, best.x), best.x + best.width - width),
    y: Math.min(Math.max(state.y, best.y), best.y + best.height - height),
    width,
    height,
    maximized: state.maximized,
  };
}

export class WindowStateStore {
  constructor(private readonly filePath: string) {}

  async read(): Promise<SavedWindowState | null> {
    try {
      return parseWindowRecord(JSON.parse(await readFile(this.filePath, 'utf8')));
    } catch {
      return null;
    }
  }

  async write(state: SavedWindowState): Promise<void> {
    await replaceFileAtomically(
      this.filePath,
      `${JSON.stringify({ version: SESSION_VERSION, ...state }, null, 2)}\n`,
    );
  }

  writeSync(state: SavedWindowState): void {
    replaceFileAtomicallySync(
      this.filePath,
      `${JSON.stringify({ version: SESSION_VERSION, ...state }, null, 2)}\n`,
    );
  }

  async clear(): Promise<void> {
    await unlink(this.filePath).catch(() => undefined);
  }
}

export class WorkspaceSessionStore {
  constructor(private readonly filePath: string) {}

  async read(): Promise<WorkspaceSession | null> {
    try {
      return parseWorkspaceRecord(JSON.parse(await readFile(this.filePath, 'utf8')));
    } catch {
      return null;
    }
  }

  async write(session: WorkspaceSession): Promise<void> {
    const root = validPath(session.root, false);
    const relativePath = validRelativePath(session.relativePath);
    if (typeof root !== 'string' || relativePath === undefined) {
      throw new Error('工作区会话无效。');
    }
    await replaceFileAtomically(
      this.filePath,
      `${JSON.stringify({ version: SESSION_VERSION, root, relativePath }, null, 2)}\n`,
    );
  }

  async clear(): Promise<void> {
    await unlink(this.filePath).catch(() => undefined);
  }
}
