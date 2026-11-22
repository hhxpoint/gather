import { useEffect, useRef, useState } from 'react';
import {
  Bold,
  Code2,
  Download,
  Eye,
  EyeOff,
  FileCode2,
  FileDown,
  FileText,
  FolderOpen,
  Heading2,
  Italic,
  Link2,
  List,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Printer,
  Quote,
  RefreshCw,
  Save,
  Search,
  SquarePen,
  X,
} from 'lucide-react';
import { describeTextFormat } from '@gather/core/text-format';
import { MarkdownEditor, countText, type MarkdownEditorHandle } from '@gather/editor';
import { errorMessage } from '../../shared/errors';
import type {
  ExportFormat,
  ExternalChange,
  FileVersion,
  OpenedFile,
  RecoverySnapshot,
  SavedFile,
  Workspace,
  WorkspaceFile,
} from '../../shared/files';

const sample = `# 把想法，慢慢写清楚。

Gather 是一个本地优先的 Markdown 写作工作台。文件留在你的设备里，AI 只在你审阅之后提出修改。

## 今天的提纲

- 先写下真正想说的话
- 用标题和段落建立节奏
- 把重要的判断留给证据

> 写作者保留最后决定权。

\`\`\`ts
const gather = "a quiet place to think";
\`\`\`

---

Phase 1：把“不丢稿”变成可验证的承诺。
`;

type TextFormat = OpenedFile['format'];

const DEFAULT_FORMAT: TextFormat = { bom: false, eol: 'lf' };

function GatherMark() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true">
      <path d="M7 11C14 10 18 13 20 16C22 13 27 10 33 11V31C27 30 23 31 20 34C17 31 13 30 7 31Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M20 16V34M20 11C20 6 25 3 30 4C30 9 26 13 20 11Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

interface Actions {
  open: () => Promise<void>;
  openFolder: () => Promise<void>;
  save: () => Promise<void>;
  saveAs: () => Promise<void>;
  togglePreview: () => void;
  find: () => void;
  replace: () => void;
  exportPdf: () => Promise<void>;
  exportHtml: () => Promise<void>;
}

const EXPORT_LABELS: Record<ExportFormat, string> = { pdf: 'PDF', html: 'HTML' };

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function savedStatus(file: SavedFile): string {
  return `已保存 ${file.name} · ${describeTextFormat(file.format)}`;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未知时间';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function versionOf(file: FileVersion): FileVersion {
  return { mtimeMs: file.mtimeMs, size: file.size, digest: file.digest };
}

export default function App() {
  const [doc, setDoc] = useState(sample);
  const [path, setPath] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [livePreview, setLivePreview] = useState(true);
  const [status, setStatus] = useState('Phase 1 · 本地文件');
  const [format, setFormat] = useState<TextFormat>(DEFAULT_FORMAT);
  const [documentVersion, setDocumentVersion] = useState(0);
  const [conflict, setConflict] = useState<string | null>(null);
  const [externalChange, setExternalChange] = useState<ExternalChange | null>(null);
  const [recoveries, setRecoveries] = useState<RecoverySnapshot[]>([]);
  const [snapshotAt, setSnapshotAt] = useState<string | null>(null);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const actionsRef = useRef<Actions | null>(null);
  const docRef = useRef(doc);
  docRef.current = doc;
  const pathRef = useRef(path);
  pathRef.current = path;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const formatRef = useRef(format);
  formatRef.current = format;
  const versionRef = useRef<FileVersion | null>(null);
  const workspaceRef = useRef<Workspace | null>(workspace);
  workspaceRef.current = workspace;
  const recoveryIdRef = useRef<string | null>(null);
  const snapshotInFlightRef = useRef(false);
  const savingRef = useRef(false);
  const saveEpochRef = useRef(0);
  const exportInFlightRef = useRef(false);

  const title = path ? path.split(/[\\/]/).pop() ?? '未命名' : '未命名文稿';
  const counts = countText(doc);

  function applySavedFile(file: SavedFile) {
    versionRef.current = versionOf(file);
    recoveryIdRef.current = null;
    saveEpochRef.current += 1;
    setFormat(file.format);
    setPath(file.path);
    setDirty(false);
    setConflict(null);
    setExternalChange(null);
    setSnapshotAt(null);
    setStatus(savedStatus(file));
  }

  async function writeRecoverySnapshot() {
    if (
      !window.gather
      || savingRef.current
      || snapshotInFlightRef.current
      || !dirtyRef.current
    ) {
      return;
    }
    const epoch = saveEpochRef.current;
    const filePath = pathRef.current;
    if (!filePath && !recoveryIdRef.current) {
      recoveryIdRef.current = `untitled-${crypto.randomUUID()}`;
    }
    snapshotInFlightRef.current = true;
    try {
      const snapshot = await window.gather.writeRecovery({
        path: filePath,
        name: filePath ? filePath.split(/[\\/]/).pop() ?? '未命名文稿' : '未命名文稿',
        content: docRef.current,
        format: formatRef.current,
        baseVersion: versionRef.current,
        recoveryId: filePath ? undefined : recoveryIdRef.current ?? undefined,
      });
      if (epoch !== saveEpochRef.current) {
        await window.gather.discardRecovery(snapshot.id).catch(() => undefined);
        return;
      }
      if (filePath !== pathRef.current) return;
      if (!filePath) recoveryIdRef.current = snapshot.id;
      setSnapshotAt(snapshot.savedAt);
    } catch (error) {
      setSnapshotAt(null);
      setStatus(`恢复快照失败：${errorMessage(error, '未知错误')}`);
    } finally {
      snapshotInFlightRef.current = false;
    }
  }

  function applyOpenedFile(file: OpenedFile) {
    versionRef.current = versionOf(file);
    recoveryIdRef.current = null;
    setDoc(file.content);
    setFormat(file.format);
    setPath(file.path);
    setDirty(false);
    setConflict(null);
    setExternalChange(null);
    setSnapshotAt(null);
    setDocumentVersion(value => value + 1);
    const note = file.format.eol === 'mixed' ? ' · 保存时会统一为 LF' : '';
    setStatus(`已打开 ${file.name} · ${describeTextFormat(file.format)}${note}`);
    void window.gather?.listRecoveries().then(setRecoveries).catch(() => undefined);
  }

  async function open() {
    try {
      if (!window.gather) { setStatus('请在 Electron 桌面端打开文件'); return; }
      if (dirtyRef.current && !window.confirm('当前文稿有未保存修改。仍要打开其他文件吗？')) {
        return;
      }
      const file = await window.gather.openFile();
      if (file) {
        await discardCurrentRecovery();
        applyOpenedFile(file);
      }
    } catch (error) {
      setStatus(errorMessage(error, '打开失败'));
    }
  }

  async function openFolder() {
    if (!window.gather) { setStatus('请在 Electron 桌面端打开文件夹'); return; }
    setWorkspaceBusy(true);
    try {
      const next = await window.gather.openWorkspace();
      if (!next) return;
      setWorkspace(next);
      setSidebarVisible(true);
      setStatus(`已打开工作区 ${next.name} · ${next.files.length} 个文稿${next.truncated ? '（列表已截断）' : ''}`);
    } catch (error) {
      setStatus(errorMessage(error, '打开文件夹失败'));
    } finally {
      setWorkspaceBusy(false);
    }
  }

  async function refreshWorkspaceSilently() {
    if (!window.gather || !workspaceRef.current) return;
    try {
      const next = await window.gather.refreshWorkspace();
      setWorkspace(next);
    } catch {
      // The active file errors already surface through the save/open paths.
    }
  }

  async function refreshWorkspace() {
    if (!window.gather || !workspaceRef.current) return;
    setWorkspaceBusy(true);
    try {
      const next = await window.gather.refreshWorkspace();
      setWorkspace(next);
      setStatus(`工作区已刷新 · ${next.files.length} 个文稿${next.truncated ? '（列表已截断）' : ''}`);
    } catch (error) {
      setStatus(errorMessage(error, '刷新工作区失败'));
    } finally {
      setWorkspaceBusy(false);
    }
  }

  async function closeWorkspace() {
    if (!window.gather) return;
    setWorkspace(null);
    setStatus('已关闭工作区，当前文稿仍保持打开');
    await window.gather.closeWorkspace().catch(() => undefined);
  }

  async function discardCurrentRecovery() {
    if (!window.gather) return;
    // Invalidate an in-flight snapshot for the document being replaced.
    saveEpochRef.current += 1;
    const currentPath = pathRef.current;
    const currentRecoveryId = recoveryIdRef.current;
    try {
      if (currentPath) {
        const items = await window.gather.listRecoveries();
        const matches = items.filter(item => item.path === currentPath);
        await Promise.all(matches.map(item => window.gather!.discardRecovery(item.id)));
        setRecoveries(list => list.filter(item => item.path !== currentPath));
      } else if (currentRecoveryId) {
        await window.gather.discardRecovery(currentRecoveryId);
        setRecoveries(list => list.filter(item => item.id !== currentRecoveryId));
      }
    } catch {
      // Recovery cleanup is best effort; it must not block opening a valid file.
    } finally {
      recoveryIdRef.current = null;
      setSnapshotAt(null);
    }
  }

  async function openWorkspaceFile(file: WorkspaceFile) {
    if (!window.gather) return;
    if (file.path === pathRef.current) {
      editorRef.current?.focus();
      return;
    }
    if (dirtyRef.current && !window.confirm('当前文稿有未保存修改。仍要打开工作区里的其他文件吗？')) {
      return;
    }
    setStatus(`正在打开 ${file.relativePath}…`);
    try {
      const opened = await window.gather.openWorkspaceFile(file.relativePath);
      await discardCurrentRecovery();
      applyOpenedFile(opened);
    } catch (error) {
      setStatus(errorMessage(error, '打开工作区文件失败'));
    }
  }

  async function save() {
    if (!window.gather) { setStatus('请在 Electron 桌面端保存文件'); return; }
    if (!pathRef.current || !versionRef.current) { await saveAs(); return; }
    const text = editorRef.current?.getText() ?? docRef.current;
    const version = versionRef.current;
    savingRef.current = true;
    try {
      const result = await window.gather.saveFile({
        path: pathRef.current,
        content: text,
        format: formatRef.current,
        mtimeMs: version.mtimeMs,
        size: version.size,
        digest: version.digest,
      });
      if (!result.ok) {
        setConflict(result.message);
        setExternalChange(null);
        setStatus('保存被拒绝：文件已在外部修改');
        return;
      }
      const stillCurrent = (editorRef.current?.getText() ?? docRef.current) === text;
      applySavedFile(result.file);
      setRecoveries(list => list.filter(item => item.path !== result.file.path));
      void refreshWorkspaceSilently();
      if (!stillCurrent) {
        setDirty(true);
        setStatus(`已保存 ${result.file.name} 的旧版本，仍有新修改未保存`);
      }
    } catch (error) {
      setStatus(errorMessage(error, '保存失败'));
    } finally {
      savingRef.current = false;
      if (dirtyRef.current) {
        window.setTimeout(() => { void writeRecoverySnapshot(); }, 500);
      }
    }
  }

  async function saveAs() {
    if (!window.gather) { setStatus('请在 Electron 桌面端另存文件'); return; }
    const previousPath = pathRef.current;
    const previousRecoveryId = recoveryIdRef.current;
    const text = editorRef.current?.getText() ?? docRef.current;
    savingRef.current = true;
    try {
      const result = await window.gather.saveFileAs({
        content: text,
        format: formatRef.current,
        previousPath,
        recoveryId: previousRecoveryId,
      });
      if (!result) return;
      if (!result.ok) {
        setConflict(result.message);
        setExternalChange(null);
        setStatus('另存失败：目标文件正在被其他程序修改');
        return;
      }
      const stillCurrent = (editorRef.current?.getText() ?? docRef.current) === text;
      applySavedFile(result.file);
      setRecoveries(list => list.filter(item => (
        item.path !== result.file.path
        && (previousPath ? item.path !== previousPath : item.id !== previousRecoveryId)
      )));
      void refreshWorkspaceSilently();
      if (!stillCurrent) {
        setDirty(true);
        setStatus(`已保存 ${result.file.name} 的旧版本，仍有新修改未保存`);
      }
    } catch (error) {
      setStatus(errorMessage(error, '另存失败'));
    } finally {
      savingRef.current = false;
      if (dirtyRef.current) {
        window.setTimeout(() => { void writeRecoverySnapshot(); }, 500);
      }
    }
  }

  async function reloadFromDisk() {
    if (!window.gather) return;
    if (dirtyRef.current && !window.confirm('载入磁盘版本会丢弃当前未保存修改。继续吗？')) {
      return;
    }
    try {
      const file = await window.gather.reloadActiveFile();
      await discardCurrentRecovery();
      saveEpochRef.current += 1;
      versionRef.current = versionOf(file);
      recoveryIdRef.current = null;
      setDoc(file.content);
      setFormat(file.format);
      setPath(file.path);
      setDirty(false);
      setConflict(null);
      setExternalChange(null);
      setSnapshotAt(null);
      setDocumentVersion(value => value + 1);
      setRecoveries(list => list.filter(item => item.path !== file.path));
      setStatus(`已载入磁盘版本 ${file.name} · ${describeTextFormat(file.format)}`);
    } catch (error) {
      setStatus(errorMessage(error, '重新载入失败'));
    }
  }

  async function restoreRecovery(snapshot: RecoverySnapshot) {
    if (!window.gather) return;
    try {
      const restored = await window.gather.readRecovery(snapshot.id);
      if (!restored) {
        setRecoveries(list => list.filter(item => item.id !== snapshot.id));
        setStatus('恢复快照已不存在');
        return;
      }
      if (dirtyRef.current && !window.confirm('载入恢复快照会替换当前未保存内容。继续吗？')) {
        return;
      }
      saveEpochRef.current += 1;
      versionRef.current = restored.baseVersion ? versionOf(restored.baseVersion) : null;
      recoveryIdRef.current = restored.path ? null : restored.id;
      setDoc(restored.content);
      setFormat(restored.format);
      setPath(restored.path);
      setDirty(true);
      setConflict(null);
      setExternalChange(null);
      setSnapshotAt(restored.savedAt);
      setDocumentVersion(value => value + 1);
      setRecoveries(list => list.filter(item => item.id !== restored.id));
      void window.gather.activateRecovery(restored.id).catch(() => undefined);
      setStatus(`已恢复 ${restored.name} · 尚未保存`);
    } catch (error) {
      setStatus(errorMessage(error, '恢复失败'));
    }
  }

  async function discardRecoverySnapshot(snapshot: RecoverySnapshot) {
    if (!window.gather) return;
    try {
      await window.gather.discardRecovery(snapshot.id);
      if (recoveryIdRef.current === snapshot.id) recoveryIdRef.current = null;
      if (snapshot.path && snapshot.path === pathRef.current) setSnapshotAt(null);
      setRecoveries(list => list.filter(item => item.id !== snapshot.id));
      setStatus(`已丢弃 ${snapshot.name} 的恢复快照`);
    } catch (error) {
      setStatus(errorMessage(error, '丢弃恢复快照失败'));
    }
  }

  async function exportAs(format: ExportFormat) {
    if (!window.gather) { setStatus('请在 Electron 桌面端导出文稿'); return; }
    if (exportInFlightRef.current) return;
    exportInFlightRef.current = true;
    setExporting(format);
    setStatus(`正在生成 ${EXPORT_LABELS[format]}…`);
    try {
      const result = await window.gather.exportDocument({
        format,
        markdown: editorRef.current?.getText() ?? docRef.current,
        suggestedName: title,
      });
      if (result.canceled) {
        setStatus('已取消导出');
        return;
      }
      const name = result.path?.split(/[\\/]/).pop() ?? `${title}.${format}`;
      const imageNote = result.warnings.length
        ? ` · ${result.warnings.length} 条图片提示（${result.warnings[0]}）`
        : '';
      setStatus(`已导出 ${name} · ${formatBytes(result.bytes ?? 0)}${imageNote}`);
    } catch (error) {
      setStatus(errorMessage(error, `导出 ${EXPORT_LABELS[format]} 失败`));
    } finally {
      exportInFlightRef.current = false;
      setExporting(null);
    }
  }

  function openLink(href: string) {
    if (!window.gather) {
      setStatus('桌面端才能打开外部链接');
      return;
    }
    void window.gather.openExternalLink(href).then(() => {
      setStatus('已在系统浏览器中打开链接');
    }).catch(error => {
      setStatus(errorMessage(error, '链接被拒绝'));
    });
  }

  function resolvePreviewImageSrc(src: string): Promise<string | null> {
    return window.gather?.resolveDocumentImage(src) ?? Promise.resolve(null);
  }

  function togglePreview() {
    setLivePreview(value => !value);
  }

  function find() {
    editorRef.current?.openSearch();
  }

  function replace() {
    editorRef.current?.openReplace();
  }

  actionsRef.current = {
    open,
    openFolder,
    save,
    saveAs,
    togglePreview,
    find,
    replace,
    exportPdf: () => exportAs('pdf'),
    exportHtml: () => exportAs('html'),
  };

  useEffect(() => {
    if (!window.gather) return;
    let cancelled = false;
    window.gather.listRecoveries().then(items => {
      if (!cancelled) setRecoveries(items);
    }).catch(error => {
      if (!cancelled) setStatus(errorMessage(error, '读取恢复快照失败'));
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    return window.gather?.onExternalChange(change => {
      if (change.path !== pathRef.current) return;
      if (
        change.type === 'changed'
        && versionRef.current
        && change.version.digest === versionRef.current.digest
      ) {
        return;
      }
      setExternalChange(change);
      setStatus(change.type === 'removed' ? '磁盘文件已被移动或删除' : '磁盘文件已在外部修改');
    });
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => { void writeRecoverySnapshot(); }, 2200);
    return () => window.clearTimeout(timer);
    // writeRecoverySnapshot reads refs; doc/path/format changes are the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, dirty, path, format]);

  useEffect(() => {
    const timer = window.setInterval(() => { void writeRecoverySnapshot(); }, 15000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return window.gather?.onMenuAction(action => {
      const actions = actionsRef.current;
      if (!actions) return;
      if (action === 'open') void actions.open();
      if (action === 'openFolder') void actions.openFolder();
      if (action === 'save') void actions.save();
      if (action === 'saveAs') void actions.saveAs();
      if (action === 'togglePreview') actions.togglePreview();
      if (action === 'find') actions.find();
      if (action === 'replace') actions.replace();
      if (action === 'exportPdf') void actions.exportPdf();
      if (action === 'exportHtml') void actions.exportHtml();
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;
      if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        void (event.shiftKey ? actionsRef.current?.saveAs() : actionsRef.current?.save());
      }
      if (event.key.toLowerCase() === 'o') {
        event.preventDefault();
        if (event.shiftKey) void actionsRef.current?.openFolder();
        else void actionsRef.current?.open();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    document.title = `${dirty ? '• ' : ''}${title} · Gather`;
  }, [dirty, title]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);

  function updateDoc(value: string) {
    setDoc(value);
    setDirty(true);
    setStatus('未保存');
  }

  return (
    <div className="app-frame">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark"><GatherMark /></span>
          <div><strong>Gather</strong><small>LOCAL-FIRST WRITING WORKSPACE</small></div>
        </div>
        <div className="file-identity">
          <FileText size={14} />
          <span>{title}</span>
          {dirty && <i aria-label="未保存">未保存</i>}
        </div>
        <div className="header-actions">
          <button className="quiet-button" onClick={() => void open()} title="打开 (Ctrl/Cmd+O)"><FileDown size={16} />打开</button>
          <button className="quiet-button icon-only" onClick={() => void openFolder()} title="打开文件夹 (Ctrl/Cmd+Shift+O)" aria-label="打开文件夹" disabled={workspaceBusy}>
            {workspaceBusy ? <LoaderCircle className="spin" size={16} /> : <FolderOpen size={16} />}
          </button>
          {workspace && (
            <button
              className="quiet-button icon-only"
              onClick={() => setSidebarVisible(value => !value)}
              title={sidebarVisible ? '收起工作区侧栏' : '展开工作区侧栏'}
              aria-label={sidebarVisible ? '收起工作区侧栏' : '展开工作区侧栏'}
            >
              {sidebarVisible ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
            </button>
          )}
          <button className="quiet-button" onClick={() => void save()} title="保存 (Ctrl/Cmd+S)"><Save size={16} />保存</button>
          <button className="quiet-button" onClick={togglePreview} title="切换实时预览 (Ctrl/Cmd+Shift+P)">
            {livePreview ? <EyeOff size={16} /> : <Eye size={16} />}{livePreview ? '源码' : '预览'}
          </button>
        </div>
      </header>

      <div className="editor-toolbar" role="toolbar" aria-label="Markdown 格式工具">
        <button onClick={() => editorRef.current?.wrap('**')} title="粗体" aria-label="粗体"><Bold size={15} /></button>
        <button onClick={() => editorRef.current?.wrap('*')} title="斜体" aria-label="斜体"><Italic size={15} /></button>
        <button onClick={() => editorRef.current?.prefix('## ')} title="二级标题" aria-label="二级标题"><Heading2 size={15} /></button>
        <span className="toolbar-rule" />
        <button onClick={() => editorRef.current?.prefix('> ')} title="引用" aria-label="引用"><Quote size={15} /></button>
        <button onClick={() => editorRef.current?.prefix('- ')} title="列表" aria-label="列表"><List size={15} /></button>
        <button onClick={() => editorRef.current?.wrap('`')} title="行内代码" aria-label="行内代码"><Code2 size={15} /></button>
        <button onClick={() => editorRef.current?.wrap('[', '](https://)')} title="链接" aria-label="链接"><Link2 size={15} /></button>
        <button onClick={() => editorRef.current?.openSearch()} title="查找与替换 (Ctrl/Cmd+F)" aria-label="查找与替换"><Search size={15} /></button>
        <span className="toolbar-rule" />
        <button onClick={() => editorRef.current?.insert('\n```\n\n```\n')} title="代码块" aria-label="代码块"><SquarePen size={15} /></button>
        <span className="toolbar-rule" />
        <button onClick={() => void saveAs()} title="另存为" aria-label="另存为"><Download size={15} /></button>
        <span className="toolbar-rule" />
        <button
          onClick={() => void exportAs('pdf')}
          title="导出 PDF (Ctrl/Cmd+Shift+E)"
          aria-label="导出 PDF"
          disabled={exporting !== null}
        >
          {exporting === 'pdf' ? <LoaderCircle className="spin" size={15} /> : <Printer size={15} />}
        </button>
        <button
          onClick={() => void exportAs('html')}
          title="导出 HTML"
          aria-label="导出 HTML"
          disabled={exporting !== null}
        >
          {exporting === 'html' ? <LoaderCircle className="spin" size={15} /> : <FileCode2 size={15} />}
        </button>
        <div className="toolbar-note">Markdown · UTF-8 · PDF/HTML 导出</div>
      </div>

      {recoveries.length > 0 && (
        <section className="recovery-banner" aria-label="未保存的恢复快照">
          <div className="recovery-heading">
            <strong>发现 {recoveries.length} 个未保存的恢复快照</strong>
            <span>来自上次异常退出或关闭前；恢复后仍需主动保存。</span>
          </div>
          <ul className="recovery-list">
            {recoveries.map(snapshot => (
              <li className="recovery-item" key={snapshot.id}>
                <div className="recovery-meta">
                  <strong>{snapshot.name}</strong>
                  <small title={snapshot.path ?? '未命名文稿'}>
                    {formatTime(snapshot.savedAt)} · {describeTextFormat(snapshot.format)} · {snapshot.path ?? '未命名文稿'}
                  </small>
                </div>
                <div className="recovery-actions">
                  <button onClick={() => void restoreRecovery(snapshot)}>恢复</button>
                  <button onClick={() => void discardRecoverySnapshot(snapshot)}>丢弃</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {conflict && (
        <div className="conflict-banner" role="alert">
          <span><strong>未覆盖原文件。</strong> {conflict}</span>
          <div className="conflict-actions">
            <button onClick={() => void reloadFromDisk()}>载入磁盘版本</button>
            <button onClick={() => void saveAs()}>另存为…</button>
            <button className="conflict-dismiss" onClick={() => setConflict(null)} title="关闭提示" aria-label="关闭提示">
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {externalChange && !conflict && (
        <div className="external-banner" role="alert">
          <span>
            <strong>{externalChange.type === 'removed' ? '磁盘文件已被移动或删除。' : '磁盘文件已在外部修改。'}</strong>
            {' '}
            {externalChange.type === 'removed'
              ? '当前编辑内容仍保留在编辑器中，请另存为。'
              : '当前编辑内容尚未覆盖磁盘，可载入磁盘版本或另存为。'}
          </span>
          <div className="conflict-actions">
            {externalChange.type === 'changed' && (
              <button onClick={() => void reloadFromDisk()}>载入磁盘版本</button>
            )}
            <button onClick={() => void saveAs()}>另存为…</button>
            <button className="conflict-dismiss" onClick={() => setExternalChange(null)} title="稍后处理" aria-label="稍后处理">
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      <div className="workspace-shell">
        {workspace && sidebarVisible && (
          <aside className="workspace-sidebar" aria-label="工作区文稿">
            <div className="workspace-heading">
              <span className="workspace-title">
                <FolderOpen size={15} />
                <strong title={workspace.root}>{workspace.name}</strong>
              </span>
              <div className="workspace-heading-actions">
                <button onClick={() => void refreshWorkspace()} title="刷新工作区" aria-label="刷新工作区" disabled={workspaceBusy}>
                  <RefreshCw size={13} className={workspaceBusy ? 'spin' : undefined} />
                </button>
                <button onClick={() => void closeWorkspace()} title="关闭工作区（当前文稿保留）" aria-label="关闭工作区">
                  <X size={14} />
                </button>
              </div>
            </div>
            <div className="workspace-meta">
              {workspace.files.length} 个文稿
              {workspace.truncated ? ' · 列表已截断' : ''}
            </div>
            <div className="workspace-list">
              {workspace.files.length === 0 && (
                <p className="workspace-empty">这个文件夹里还没有 Markdown 文稿。</p>
              )}
              {workspace.files.map(file => {
                const active = file.path === path;
                return (
                  <button
                    key={file.path}
                    className={`workspace-file${active ? ' active' : ''}`}
                    onClick={() => void openWorkspaceFile(file)}
                    title={file.relativePath}
                  >
                    <FileText size={14} />
                    <span className="workspace-file-copy">
                      <strong>{file.name}</strong>
                      {file.relativePath !== file.name && <small>{file.relativePath}</small>}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="workspace-root" title={workspace.root}>{workspace.root}</div>
          </aside>
        )}
        <main className="editor-surface">
          <MarkdownEditor
            ref={editorRef}
            value={doc}
            onChange={updateDoc}
            livePreview={livePreview}
            documentVersion={documentVersion}
            previewContext={path ?? 'untitled'}
            onOpenLink={openLink}
            resolveImage={resolvePreviewImageSrc}
            placeholder="从一句话开始。"
          />
        </main>
      </div>

      <footer className="app-footer">
        <span className={dirty ? 'state-dot unsaved' : 'state-dot'} />
        <span>{status}</span>
        <span className="footer-spacer" />
        {snapshotAt && <span title={`恢复快照 ${formatTime(snapshotAt)}`}>快照 {formatTime(snapshotAt)}</span>}
        <span>{counts.words} 字</span>
        <span>{counts.lines} 行</span>
        <span>{describeTextFormat(format)}</span>
        <span className="phase-tag">PHASE 1</span>
      </footer>
    </div>
  );
}
