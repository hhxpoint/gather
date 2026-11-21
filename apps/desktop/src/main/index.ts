import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell } from 'electron';
import { join } from 'node:path';
import { normalizeTextFormat } from '@gather/core/text-format';
import { readMarkdownFile, writeMarkdownFile } from './file-io';
import type { SaveAsRequest, SaveRequest } from '../shared/files';

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
let mainWindow: BrowserWindow | null = null;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('保存请求格式无效。');
  }
  return value as Record<string, unknown>;
}

function parseSaveRequest(payload: unknown): SaveRequest {
  const record = asRecord(payload);
  if (typeof record.path !== 'string' || !record.path) throw new Error('缺少保存路径。');
  if (typeof record.content !== 'string') throw new Error('缺少文稿内容。');
  if (
    typeof record.mtimeMs !== 'number'
    || !Number.isFinite(record.mtimeMs)
    || typeof record.size !== 'number'
    || !Number.isInteger(record.size)
    || typeof record.digest !== 'string'
  ) {
    throw new Error('缺少文件版本信息，请重新打开文稿后再保存。');
  }
  return {
    path: record.path,
    content: record.content,
    format: normalizeTextFormat(record.format),
    mtimeMs: record.mtimeMs,
    size: record.size,
    digest: record.digest,
  };
}

function parseSaveAsRequest(payload: unknown): SaveAsRequest {
  const record = asRecord(payload);
  if (typeof record.content !== 'string') throw new Error('缺少文稿内容。');
  return {
    content: record.content,
    format: normalizeTextFormat(record.format),
  };
}

function registerIpc() {
  ipcMain.handle('file:open', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '打开 Markdown 文稿',
      properties: ['openFile'],
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return readMarkdownFile(result.filePaths[0]);
  });

  ipcMain.handle('file:save', async (_event, payload: unknown) => {
    const request = parseSaveRequest(payload);
    return writeMarkdownFile(request.path, request.content, {
      format: request.format,
      expected: {
        mtimeMs: request.mtimeMs,
        size: request.size,
        digest: request.digest,
      },
    });
  });

  ipcMain.handle('file:saveAs', async (_event, payload: unknown) => {
    const request = parseSaveAsRequest(payload);
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: '保存 Markdown 文稿',
      defaultPath: 'untitled.md',
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
    });
    if (result.canceled || !result.filePath) return null;
    return writeMarkdownFile(result.filePath, request.content, { format: request.format });
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
        { label: '保存', accelerator: 'CmdOrCtrl+S', click: () => sendMenu('save') },
        { label: '另存为…', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendMenu('saveAs') },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '切换实时预览', accelerator: 'CmdOrCtrl+Shift+P', click: () => sendMenu('togglePreview') },
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
        { label: 'Gather Phase 1 · 文件可靠性', enabled: false },
        { label: '项目主页', click: () => sendMenu('home') },
      ],
    },
  ]));
}

function openExternalLink(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      void shell.openExternal(parsed.toString());
    }
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
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
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => { mainWindow = null; });
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
  app.whenReady().then(() => {
    if (!isDev) applyProductionCsp();
    registerIpc();
    createMenu();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
