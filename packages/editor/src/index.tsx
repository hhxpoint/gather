import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, drawSelection, dropCursor, highlightActiveLine, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { bracketMatching, defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, openSearchPanel, search, searchKeymap } from '@codemirror/search';
import { toggleLinePrefix, toggleWrap } from './text-commands';
import { createLivePreviewExtensions } from './live-preview';
import { gatherTheme } from './theme';

export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  livePreview?: boolean;
  placeholder?: string;
  /** Increment when a different document is loaded to reset undo history. */
  documentVersion?: number;
  /** Desktop validates and opens http/https URLs. */
  onOpenLink?: (href: string) => void;
  /** Resolve a document-relative image to a data URI, or null when unavailable. */
  resolveImage?: (src: string) => Promise<string | null>;
  /** Changes when the document location changes and image previews must refresh. */
  previewContext?: string;
}

export interface MarkdownEditorHandle {
  focus: () => void;
  wrap: (before: string, after?: string) => void;
  prefix: (prefix: string) => void;
  insert: (text: string) => void;
  openSearch: () => void;
  openReplace: () => void;
  /** Move the caret to a 1-based line/column, scroll it into view and focus. */
  revealLine: (line: number, column?: number) => void;
  getText: () => string;
}

function openReplacePanel(view: EditorView): boolean {
  const opened = openSearchPanel(view);
  if (opened) {
    requestAnimationFrame(() => {
      const input = view.dom.querySelector<HTMLInputElement>('input[name="replace"]');
      input?.focus();
      input?.select();
    });
  }
  return opened;
}

const previewCompartment = new Compartment();

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(function MarkdownEditor(
  {
    value,
    onChange,
    livePreview = true,
    placeholder: placeholderText = '从一句话开始。',
    documentVersion = 0,
    onOpenLink,
    resolveImage,
    previewContext = '',
  },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const syncingRef = useRef(false);
  const documentVersionRef = useRef(documentVersion);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const livePreviewRef = useRef(livePreview);
  livePreviewRef.current = livePreview;
  const previewConfigRef = useRef({ onOpenLink, resolveImage });
  previewConfigRef.current = { onOpenLink, resolveImage };

  function createPreviewExtensions() {
    return createLivePreviewExtensions({
      onOpenLink: href => previewConfigRef.current.onOpenLink?.(href),
      resolveImage: src => previewConfigRef.current.resolveImage?.(src) ?? Promise.resolve(null),
    });
  }

  function createExtensions() {
    return [
      history(),
      drawSelection(),
      dropCursor(),
      highlightActiveLine(),
      bracketMatching(),
      search({ top: true }),
      EditorState.phrases.of({
        Find: '查找',
        Replace: '替换',
        next: '下一个',
        previous: '上一个',
        all: '全部',
        'match case': '区分大小写',
        regexp: '正则',
        'by word': '整词',
        replace: '替换',
        'replace all': '全部替换',
        close: '关闭',
      }),
      highlightSelectionMatches(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      EditorView.lineWrapping,
      EditorState.tabSize.of(2),
      EditorView.contentAttributes.of({
        spellcheck: 'true',
        autocorrect: 'off',
        autocapitalize: 'off',
      }),
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        { key: 'Mod-h', run: openReplacePanel, preventDefault: true },
        indentWithTab,
      ]),
      gatherTheme,
      placeholder(placeholderText),
      previewCompartment.of(livePreviewRef.current ? createPreviewExtensions() : []),
      EditorView.updateListener.of(update => {
        if (!update.docChanged) return;
        if (syncingRef.current) {
          syncingRef.current = false;
          return;
        }
        onChangeRef.current(update.state.doc.toString());
      }),
    ];
  }

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: createExtensions(),
      }),
      parent: host,
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // The editor is intentionally created once; value is synchronized below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();

    if (documentVersion !== documentVersionRef.current) {
      documentVersionRef.current = documentVersion;
      // Rebuilding the state is the only reliable way to discard the previous
      // document's undo history, selections and plugin state.
      view.setState(EditorState.create({
        doc: value,
        selection: { anchor: 0 },
        extensions: createExtensions(),
      }));
      view.focus();
      return;
    }

    if (current !== value) {
      syncingRef.current = true;
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value, documentVersion]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: previewCompartment.reconfigure(livePreview ? createPreviewExtensions() : []),
    });
    // createPreviewExtensions reads the latest callbacks through a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [livePreview, previewContext]);

  useImperativeHandle(ref, () => ({
    focus() {
      viewRef.current?.focus();
    },
    wrap(before, after = before) {
      const view = viewRef.current;
      if (!view) return;
      const { from, to } = view.state.selection.main;
      const edit = toggleWrap(view.state.doc.toString(), from, to, before, after);
      view.dispatch({
        changes: { from: edit.from, to: edit.to, insert: edit.insert },
        selection: { anchor: edit.selectionFrom, head: edit.selectionTo },
        scrollIntoView: true,
      });
      view.focus();
    },
    prefix(prefix) {
      const view = viewRef.current;
      if (!view) return;
      const { from, to } = view.state.selection.main;
      const edit = toggleLinePrefix(view.state.doc.toString(), from, to, prefix);
      view.dispatch({
        changes: { from: edit.from, to: edit.to, insert: edit.insert },
        selection: { anchor: edit.selectionFrom, head: edit.selectionTo },
        scrollIntoView: true,
      });
      view.focus();
    },
    insert(text) {
      const view = viewRef.current;
      if (!view) return;
      const { from, to } = view.state.selection.main;
      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
        scrollIntoView: true,
      });
      view.focus();
    },
    openSearch() {
      const view = viewRef.current;
      if (!view) return;
      openSearchPanel(view);
    },
    openReplace() {
      const view = viewRef.current;
      if (!view) return;
      view.focus();
      openReplacePanel(view);
    },
    revealLine(line, column = 1) {
      const view = viewRef.current;
      if (!view) return;
      const lineNumber = Math.min(Math.max(1, Math.floor(line)), view.state.doc.lines);
      const info = view.state.doc.line(lineNumber);
      const offset = Math.min(Math.max(0, Math.floor(column) - 1), info.length);
      const position = info.from + offset;
      view.dispatch({
        selection: { anchor: position },
        effects: EditorView.scrollIntoView(position, { y: 'center' }),
      });
      view.focus();
    },
    getText() {
      return viewRef.current?.state.doc.toString() ?? '';
    },
  }), []);

  return <div ref={hostRef} className="gather-editor" aria-label="Markdown editor" />;
});

export { countText } from '@gather/core';
export { toggleLinePrefix, toggleWrap } from './text-commands';
