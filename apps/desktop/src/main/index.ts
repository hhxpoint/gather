import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import { randomUUID } from 'node:crypto';
import { readFile, rename, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const MAX_BYTES = 20 * 1024 * 1024;
const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
let mainWindow: BrowserWindow | null = null;

function assertText(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected a text value.');
  if (Buffer.byteLength(value, 'utf8') > MAX_BYTES) throw new Error('文件超过 20 MiB，暂不支持在 Gather 中打开。');
  return value;
}

async function readMarkdown(path: string) {
  const info = await stat(path);
  if (!info.isFile()) throw new Error('请选择一个 Markdown 文件。');
  if (info.size > MAX_BYTES) throw new Error('文件超过 20 MiB，暂不支持在 Gather 中打开。');
  const content = await readFile(path, 'utf8');
  return { path, content, name: basename(path) };
}

async function writeMarkdown(path: string, content: string) {
  const text = assertText(content);
  const temporary = `${path}.gather-${randomUUID()}.tmp`;
  await writeFile(temporary, text, 'utf8');
  await rename(temporary, path);
  return { path, name: basename(path) };
}

function registerIpc() {
  ipcMain.handle('file:open', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '打开 Markdown 文稿',
      properties: ['openFile'],
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return readMarkdown(result.filePaths[0]);
  });

  ipcMain.handle('file:save', async (_event, payload: { path: string; content: string }) => {
    if (!payload || typeof payload.path !== 'string' || !payload.path) throw new Error('缺少保存路径。');
    return writeMarkdown(payload.path, payload.content);
  });

  ipcMain.handle('file:saveAs', async (_event, payload: { content: string }) => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: '保存 Markdown 文稿',
      defaultPath: 'untitled.md',
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
    });
    if (result.canceled || !result.filePath) return null;
    return writeMarkdown(result.filePath, payload.content);
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
        { label: 'Gather Phase 0', enabled: false },
        { label: '项目主页', click: () => sendMenu('home') },
      ],
    },
  ]));
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
