import { app, BrowserWindow, dialog, ipcMain, Menu, screen, session, shell } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { isAbsolute, join, relative, sep } from 'node:path';
import { normalizeTextFormat } from '@gather/core/text-format';
import { readFileVersion, readMarkdownFile, writeMarkdownFile } from './file-io';
import { ActiveFileWatcher } from './file-watcher';
import { toUserFacingFileError } from './file-errors';
import { RecoveryStore } from './recovery';
import { exportDocument } from './document-export';
import { resolvePreviewImage } from './image-preview';
import { listWorkspace, resolveWorkspaceFile } from './workspace';
import { cancelWorkspaceSearch, runWorkspaceSearch } from './workspace-search-service';
import {
  normalizeWindowState,
  WindowStateStore,
  WorkspaceSessionStore,
  type SavedWindowState,
} from './session';
import { safeExternalUrl } from '../shared/external-links';
import type {
  DocumentExportRequest,
  ExternalChange,
  FileVersion,
  RecoveryPayload,
  SaveAsRequest,
  SaveRequest,
  WorkspaceRestoreResult,
  WorkspaceSearchOptions,
} from '../shared/files';

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
const fileWatcher = new ActiveFileWatcher();
let activeFilePath: string | null = null;
let workspaceRoot: string | null = null;
let mainWindow: BrowserWindow | null = null;

// Keep recovery snapshots under %APPDATA%/Gather, not the workspace package
// name (@gather/desktop).
app.setName('Gather');

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('请求格式无效。');
  }
  return value as Record<string, unknown>;
}

function parseFileVersion(value: unknown, field: string): FileVersion {
  const record = asRecord(value);
  if (
    typeof record.mtimeMs !== 'number'
    || !Number.isFinite(record.mtimeMs)
    || typeof record.size !== 'number'
    || !Number.isInteger(record.size)
    || record.size < 0
    || typeof record.digest !== 'string'
    || !/^[a-f0-9]{64}$/.test(record.digest)
  ) {
    throw new Error(`${field}无效。`);
  }
  return {
    mtimeMs: record.mtimeMs,
    size: record.size,
    digest: record.digest,
  };
}

function parseSaveRequest(payload: unknown): SaveRequest {
  const record = asRecord(payload);
  if (typeof record.path !== 'string' || !record.path) throw new Error('缺少保存路径。');
  if (typeof record.content !== 'string') throw new Error('缺少文稿内容。');
  const version = parseFileVersion(record, '文件版本信息');
  return {
    path: record.path,
    content: record.content,
    format: normalizeTextFormat(record.format),
    ...version,
  };
}

function parseSaveAsRequest(payload: unknown): SaveAsRequest {
  const record = asRecord(payload);
  if (typeof record.content !== 'string') throw new Error('缺少文稿内容。');
  if (
    record.previousPath !== undefined
    && record.previousPath !== null
    && typeof record.previousPath !== 'string'
  ) {
    throw new Error('原文件路径无效。');
  }
  if (record.recoveryId !== undefined && record.recoveryId !== null && typeof record.recoveryId !== 'string') {
    throw new Error('恢复快照 ID 无效。');
  }
  return {
    content: record.content,
    format: normalizeTextFormat(record.format),
    previousPath: record.previousPath === null || record.previousPath === undefined
      ? null
      : record.previousPath,
    recoveryId: record.recoveryId === null || record.recoveryId === undefined
      ? null
      : record.recoveryId,
  };
}

function parseDocumentExportRequest(payload: unknown): DocumentExportRequest {
  const record = asRecord(payload);
  if (record.format !== 'pdf' && record.format !== 'html') {
    throw new Error('导出格式无效。');
  }
  if (typeof record.markdown !== 'string') throw new Error('缺少待导出的文稿内容。');
  if (Buffer.byteLength(record.markdown, 'utf8') > 20 * 1024 * 1024) {
    throw new Error('文稿超过 20 MiB，暂不支持导出。');
  }
  if (typeof record.suggestedName !== 'string' || !record.suggestedName.trim()) {
    throw new Error('缺少导出文件名。');
  }
  return {
    format: record.format,
    markdown: record.markdown,
    suggestedName: record.suggestedName.slice(0, 200),
  };
}

function parseWorkspaceSearchOptions(payload: unknown): WorkspaceSearchOptions {
  const record = asRecord(payload);
  if (typeof record.query !== 'string') throw new Error('搜索关键词无效。');
  if (!record.query.trim()) throw new Error('请输入搜索关键词。');
  return {
    query: record.query,
    caseSensitive: record.caseSensitive === true,
    regex: record.regex === true,
  };
}

function parseRecoveryPayload(payload: unknown): RecoveryPayload {
  const record = asRecord(payload);
  if (record.path !== null && (typeof record.path !== 'string' || !record.path)) {
    throw new Error('恢复快照路径无效。');
  }
  if (typeof record.name !== 'string' || !record.name) throw new Error('恢复快照名称无效。');
  if (typeof record.content !== 'string') throw new Error('恢复快照内容无效。');
  if (record.recoveryId !== undefined && typeof record.recoveryId !== 'string') {
    throw new Error('恢复快照 ID 无效。');
  }
  return {
    path: record.path as string | null,
    name: record.name,
    content: record.content,
    format: normalizeTextFormat(record.format),
    baseVersion: record.baseVersion === null || record.baseVersion === undefined
      ? null
      : parseFileVersion(record.baseVersion, '恢复快照的文件版本'),
    recoveryId: record.recoveryId,
  };
}

function sendExternalChange(change: ExternalChange) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('file:external-change', change);
}

function watchActiveFile(file: { path: string; mtimeMs: number; size: number; digest: string }) {
  activeFilePath = file.path;
  fileWatcher.watch(
    file.path,
    { mtimeMs: file.mtimeMs, size: file.size, digest: file.digest },
    sendExternalChange,
  );
}

function stopActiveFileWatcher() {
  fileWatcher.stop();
  activeFilePath = null;
}

function relativeWorkspacePath(root: string, filePath: string): string | null {
  const relativePath = relative(root, filePath);
  if (
    !relativePath
    || relativePath === '..'
    || relativePath.startsWith(`..${sep}`)
    || isAbsolute(relativePath)
  ) {
    return null;
  }
  return relativePath.split(sep).join('/');
}

async function loadWindowState(store: WindowStateStore): Promise<SavedWindowState | null> {
  const saved = await store.read().catch(() => null);
  if (!saved) return null;
  return normalizeWindowState(
    saved,
    screen.getAllDisplays().map(display => display.workArea),
    screen.getPrimaryDisplay().workArea,
  );
}

function registerIpc(recoveryStore: RecoveryStore, workspaceSessions: WorkspaceSessionStore) {
  const rememberActiveFile = (filePath: string) => {
    if (!workspaceRoot) {
      void workspaceSessions.clear().catch(() => undefined);
      return;
    }
    const relativePath = relativeWorkspacePath(workspaceRoot, filePath);
    void workspaceSessions.write({ root: workspaceRoot, relativePath }).catch(error => {
      console.error('Gather workspace session unavailable:', error);
    });
  };

  const handleIpc = (
    channel: string,
    listener: (event: IpcMainInvokeEvent, payload: unknown) => Promise<unknown>,
  ) => {
    ipcMain.handle(channel, async (event, payload: unknown) => {
      try {
        return await listener(event, payload);
      } catch (error) {
        throw toUserFacingFileError(error);
      }
    });
  };

  handleIpc('file:open', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '打开 Markdown 文稿',
      properties: ['openFile'],
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const file = await readMarkdownFile(result.filePaths[0]);
    rememberActiveFile(file.path);
    watchActiveFile(file);
    return file;
  });

  handleIpc('workspace:restore', async (): Promise<WorkspaceRestoreResult> => {
    if (workspaceRoot) return { status: 'none' };
    const saved = await workspaceSessions.read();
    if (!saved) return { status: 'none' };
    try {
      const workspace = await listWorkspace(saved.root);
      workspaceRoot = workspace.root;
      const relativePath = saved.relativePath
        && workspace.files.some(file => file.relativePath === saved.relativePath)
        ? saved.relativePath
        : null;
      const fileMissing = Boolean(saved.relativePath && !relativePath);
      if (fileMissing) {
        await workspaceSessions.write({
          root: workspace.root,
          relativePath: null,
        }).catch(() => undefined);
      }
      return { status: 'restored', workspace, relativePath, fileMissing };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        await workspaceSessions.clear().catch(() => undefined);
        return { status: 'unavailable', message: '上次工作区已不存在，记录已清除。' };
      }
      return {
        status: 'unavailable',
        message: '上次工作区暂时无法打开，记录已保留，下次启动会再试。',
      };
    }
  });

  handleIpc('workspace:open', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) throw new Error('主窗口不可用。');
    cancelWorkspaceSearch();
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '打开 Markdown 工作区',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const workspace = await listWorkspace(result.filePaths[0]);
    workspaceRoot = workspace.root;
    if (activeFilePath) {
      rememberActiveFile(activeFilePath);
    } else {
      await workspaceSessions.write({
        root: workspace.root,
        relativePath: null,
      }).catch(error => {
        console.error('Gather workspace session unavailable:', error);
      });
    }
    return workspace;
  });

  handleIpc('workspace:refresh', async () => {
    if (!workspaceRoot) throw new Error('当前没有打开的工作区。');
    return listWorkspace(workspaceRoot);
  });

  handleIpc('workspace:search', async (_event, payload: unknown) => {
    if (!workspaceRoot) throw new Error('当前没有打开的工作区。');
    return runWorkspaceSearch(workspaceRoot, parseWorkspaceSearchOptions(payload));
  });

  handleIpc('workspace:openFile', async (_event, payload: unknown) => {
    if (!workspaceRoot) throw new Error('当前没有打开的工作区。');
    if (typeof payload !== 'string') throw new Error('工作区文件路径无效。');
    const path = await resolveWorkspaceFile(workspaceRoot, payload);
    const file = await readMarkdownFile(path);
    rememberActiveFile(path);
    watchActiveFile(file);
    return file;
  });

  handleIpc('workspace:close', async () => {
    cancelWorkspaceSearch();
    workspaceRoot = null;
    await workspaceSessions.clear().catch(() => undefined);
    return true;
  });

  handleIpc('file:save', async (_event, payload: unknown) => {
    const request = parseSaveRequest(payload);
    const outcome = await writeMarkdownFile(request.path, request.content, {
      format: request.format,
      expected: {
        mtimeMs: request.mtimeMs,
        size: request.size,
        digest: request.digest,
      },
    });
    if (outcome.ok) {
      watchActiveFile(outcome.file);
      await recoveryStore.discardPath(outcome.file.path).catch(() => undefined);
    }
    return outcome;
  });

  handleIpc('file:saveAs', async (_event, payload: unknown) => {
    const request = parseSaveAsRequest(payload);
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: '保存 Markdown 文稿',
      defaultPath: 'untitled.md',
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
    });
    if (result.canceled || !result.filePath) return null;
    const outcome = await writeMarkdownFile(result.filePath, request.content, {
      format: request.format,
    });
    if (outcome.ok) {
      if (request.previousPath) {
        await recoveryStore.discardPath(request.previousPath).catch(() => undefined);
      }
      if (request.recoveryId) {
        await recoveryStore.discard(request.recoveryId).catch(() => undefined);
      }
      await recoveryStore.discardPath(outcome.file.path).catch(() => undefined);
      rememberActiveFile(outcome.file.path);
      watchActiveFile(outcome.file);
    }
    return outcome;
  });

  handleIpc('file:reloadActive', async () => {
    if (!activeFilePath) throw new Error('当前没有可重新载入的文件。');
    const file = await readMarkdownFile(activeFilePath);
    watchActiveFile(file);
    await recoveryStore.discardPath(file.path).catch(() => undefined);
    return file;
  });

  handleIpc('document:export', async (_event, payload: unknown) => {
    const request = parseDocumentExportRequest(payload);
    if (!mainWindow || mainWindow.isDestroyed()) throw new Error('主窗口不可用，无法导出。');
    return exportDocument(mainWindow, request, activeFilePath);
  });

  handleIpc('image:resolve', async (_event, payload: unknown) => {
    if (typeof payload !== 'string') return null;
    return resolvePreviewImage(payload, activeFilePath);
  });

  handleIpc('shell:openExternal', async (_event, payload: unknown) => {
    await shell.openExternal(safeExternalUrl(payload));
    return true;
  });

  handleIpc('recovery:list', async () => recoveryStore.list());

  handleIpc('recovery:read', async (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('恢复快照 ID 无效。');
    return recoveryStore.read(id);
  });

  handleIpc('recovery:activate', async (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('恢复快照 ID 无效。');
    const snapshot = await recoveryStore.read(id);
    if (!snapshot) return false;
    if (!snapshot.path) {
      stopActiveFileWatcher();
      return false;
    }
    const version = snapshot.baseVersion ?? await readFileVersion(snapshot.path);
    if (!version) {
      activeFilePath = snapshot.path;
      fileWatcher.stop();
      return false;
    }
    watchActiveFile({ path: snapshot.path, ...version });
    // The file may have changed while Gather was closed. Confirm once now
    // instead of waiting for the next fs event or poll tick.
    void fileWatcher.checkNow(true);
    return true;
  });

  handleIpc('recovery:write', async (_event, payload: unknown) => {
    return recoveryStore.write(parseRecoveryPayload(payload));
  });

  handleIpc('recovery:discard', async (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('恢复快照 ID 无效。');
    await recoveryStore.discard(id);
  });
}

function sendMenu(action: string) {
  mainWindow?.webContents.send('menu-action', action);
}

function createMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: '文件',
      submenu: [
        { label: '打开…', accelerator: 'CmdOrCtrl+O', click: () => sendMenu('open') },
        { label: '打开文件夹…', accelerator: 'CmdOrCtrl+Shift+O', click: () => sendMenu('openFolder') },
        { label: '保存', accelerator: 'CmdOrCtrl+S', click: () => sendMenu('save') },
        { label: '另存为…', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendMenu('saveAs') },
        { type: 'separator' },
        { label: '导出 PDF…', accelerator: 'CmdOrCtrl+Shift+E', click: () => sendMenu('exportPdf') },
        { label: '导出 HTML…', click: () => sendMenu('exportHtml') },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { label: '查找与替换…', accelerator: 'CmdOrCtrl+F', click: () => sendMenu('find') },
        { label: '替换…', accelerator: 'CmdOrCtrl+H', click: () => sendMenu('replace') },
        { label: '在工作区中查找…', accelerator: 'CmdOrCtrl+Shift+F', click: () => sendMenu('workspaceSearch') },
        { type: 'separator' },
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '切换实时预览', accelerator: 'CmdOrCtrl+Shift+P', click: () => sendMenu('togglePreview') },
        { label: '阅读模式', accelerator: 'CmdOrCtrl+Shift+R', click: () => sendMenu('readingMode') },
        { label: '专注模式', accelerator: 'CmdOrCtrl+Shift+Enter', click: () => sendMenu('focusMode') },
        { type: 'separator' },
        { role: 'reload', label: '重新载入' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: 'Gather Phase 1 · 文件恢复与外部变更', enabled: false },
        { label: '项目主页', click: () => sendMenu('home') },
      ],
    },
  ]));
}

function openExternalLink(url: string) {
  try {
    void shell.openExternal(safeExternalUrl(url));
  } catch {
    // Invalid or non-web URLs stay blocked.
  }
}

function isInternalNavigation(currentUrl: string, nextUrl: string): boolean {
  try {
    const current = new URL(currentUrl);
    const next = new URL(nextUrl);
    if (current.protocol !== next.protocol) return false;
    if (current.protocol === 'file:') return current.pathname === next.pathname;
    return current.origin === next.origin;
  } catch {
    return false;
  }
}

function hardenWindow(window: BrowserWindow) {
  const contents = window.webContents;
  contents.setWindowOpenHandler(({ url }) => {
    openExternalLink(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (isInternalNavigation(contents.getURL(), url)) return;
    event.preventDefault();
    openExternalLink(url);
  });
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
}

function applyProductionCsp() {
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: ['file://*/*'] },
    (details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
              + "img-src 'self' data:; font-src 'self'; connect-src 'self'; "
              + "object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
          ],
        },
      });
    },
  );
}

function createWindow(savedState: SavedWindowState | null, windowStateStore: WindowStateStore) {
  const bounds = savedState
    ? {
        x: savedState.x,
        y: savedState.y,
        width: savedState.width,
        height: savedState.height,
      }
    : { width: 1200, height: 820 };
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../../build/icon.png');
  mainWindow = new BrowserWindow({
    ...bounds,
    icon: iconPath,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: '#fbfaf5',
    title: 'Gather',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  hardenWindow(mainWindow);

  let windowSaveTimer: NodeJS.Timeout | undefined;
  const captureWindowState = (): SavedWindowState | null => {
    if (!mainWindow || mainWindow.isDestroyed()) return null;
    const current = mainWindow.getNormalBounds();
    return {
      x: current.x,
      y: current.y,
      width: current.width,
      height: current.height,
      maximized: mainWindow.isMaximized(),
    };
  };
  const scheduleWindowSave = () => {
    const state = captureWindowState();
    if (!state) return;
    if (windowSaveTimer) clearTimeout(windowSaveTimer);
    windowSaveTimer = setTimeout(() => {
      windowSaveTimer = undefined;
      void windowStateStore.write(state).catch(error => {
        console.error('Gather window state unavailable:', error);
      });
    }, 300);
  };
  const flushWindowState = () => {
    if (windowSaveTimer) {
      clearTimeout(windowSaveTimer);
      windowSaveTimer = undefined;
    }
    const state = captureWindowState();
    if (!state) return;
    try {
      windowStateStore.writeSync(state);
    } catch (error) {
      console.error('Gather window state unavailable:', error);
    }
  };

  mainWindow.on('resize', scheduleWindowSave);
  mainWindow.on('move', scheduleWindowSave);
  mainWindow.on('maximize', scheduleWindowSave);
  mainWindow.on('unmaximize', scheduleWindowSave);
  mainWindow.once('ready-to-show', () => {
    if (savedState?.maximized) mainWindow?.maximize();
    mainWindow?.show();
  });
  mainWindow.on('close', flushWindowState);
  mainWindow.on('closed', () => {
    if (windowSaveTimer) clearTimeout(windowSaveTimer);
    stopActiveFileWatcher();
    cancelWorkspaceSearch();
    mainWindow = null;
  });
  if (isDev) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL!);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

const lock = app.requestSingleInstanceLock();
if (!lock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(async () => {
    if (!isDev) applyProductionCsp();
    const userData = app.getPath('userData');
    const recoveryStore = new RecoveryStore(join(userData, 'recovery'));
    const workspaceSessionStore = new WorkspaceSessionStore(join(userData, 'workspace-session.json'));
    const windowStateStore = new WindowStateStore(join(userData, 'window-state.json'));
    await recoveryStore.init().catch(error => {
      console.error('Gather recovery store unavailable:', error);
    });
    registerIpc(recoveryStore, workspaceSessionStore);
    createMenu();
    createWindow(await loadWindowState(windowStateStore), windowStateStore);
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void loadWindowState(windowStateStore).then(state => {
          if (BrowserWindow.getAllWindows().length === 0) createWindow(state, windowStateStore);
        });
      }
    });
  });
  app.on('before-quit', () => {
    stopActiveFileWatcher();
    cancelWorkspaceSearch();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
