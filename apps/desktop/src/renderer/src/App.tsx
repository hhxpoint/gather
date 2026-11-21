import { useEffect, useRef, useState } from 'react';
import {
  Bold,
  Code2,
  Download,
  Eye,
  EyeOff,
  FileDown,
  FileText,
  Heading2,
  Italic,
  Link2,
  List,
  Quote,
  Save,
  SquarePen,
} from 'lucide-react';
import { MarkdownEditor, countText, type MarkdownEditorHandle } from '@gather/editor';

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

Phase 0：编辑器内核、桌面壳与 CLI 的地基。
`;

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
  save: () => Promise<void>;
  saveAs: () => Promise<void>;
  togglePreview: () => void;
}

export default function App() {
  const [doc, setDoc] = useState(sample);
  const [path, setPath] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [livePreview, setLivePreview] = useState(true);
  const [status, setStatus] = useState('Phase 0 · 本地文件');
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const actionsRef = useRef<Actions | null>(null);
  const docRef = useRef(doc);
  docRef.current = doc;
  const pathRef = useRef(path);
  pathRef.current = path;

  const title = path ? path.split(/[\\/]/).pop() ?? '未命名' : '未命名文稿';
  const counts = countText(doc);

  async function open() {
    try {
      if (!window.gather) { setStatus('请在 Electron 桌面端打开文件'); return; }
      const file = await window.gather.openFile();
      if (!file) return;
      setDoc(file.content);
      setPath(file.path);
      setDirty(false);
      setStatus(`已打开 ${file.name}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '打开失败');
    }
  }

  async function save() {
    try {
      if (!window.gather) { setStatus('请在 Electron 桌面端保存文件'); return; }
      const text = editorRef.current?.getText() ?? docRef.current;
      if (!pathRef.current) { await saveAs(); return; }
      const result = await window.gather.saveFile(pathRef.current, text);
      if (result) {
        setPath(result.path);
        setDirty(false);
        setStatus(`已保存 ${result.name}`);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '保存失败');
    }
  }

  async function saveAs() {
    try {
      if (!window.gather) { setStatus('请在 Electron 桌面端另存文件'); return; }
      const text = editorRef.current?.getText() ?? docRef.current;
      const result = await window.gather.saveFileAs(text);
      if (result) {
        setPath(result.path);
        setDirty(false);
        setStatus(`已保存 ${result.name}`);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '另存失败');
    }
  }

  function togglePreview() {
    setLivePreview(value => !value);
  }

  actionsRef.current = { open, save, saveAs, togglePreview };

  useEffect(() => {
    return window.gather?.onMenuAction(action => {
      const actions = actionsRef.current;
      if (!actions) return;
      if (action === 'open') void actions.open();
      if (action === 'save') void actions.save();
      if (action === 'saveAs') void actions.saveAs();
      if (action === 'togglePreview') actions.togglePreview();
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
        void actionsRef.current?.open();
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
        <span className="toolbar-rule" />
        <button onClick={() => editorRef.current?.insert('\n```\n\n```\n')} title="代码块" aria-label="代码块"><SquarePen size={15} /></button>
        <span className="toolbar-rule" />
        <button onClick={() => void saveAs()} title="另存为" aria-label="另存为"><Download size={15} /></button>
        <div className="toolbar-note">Markdown · UTF-8</div>
      </div>

      <main className="editor-surface">
        <MarkdownEditor
          ref={editorRef}
          value={doc}
          onChange={updateDoc}
          livePreview={livePreview}
          placeholder="从一句话开始。"
        />
      </main>

      <footer className="app-footer">
        <span className={dirty ? 'state-dot unsaved' : 'state-dot'} />
        <span>{status}</span>
        <span className="footer-spacer" />
        <span>{counts.words} 字</span>
        <span>{counts.lines} 行</span>
        <span>本地文件</span>
        <span className="phase-tag">PHASE 0</span>
      </footer>
    </div>
  );
}
