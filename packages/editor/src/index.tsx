import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, drawSelection, dropCursor, highlightActiveLine, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { bracketMatching, defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { toggleLinePrefix, toggleWrap } from './text-commands';
import { livePreviewExtensions } from './live-preview';
import { gatherTheme } from './theme';

export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  livePreview?: boolean;
  placeholder?: string;
  /** Increment when a different document is loaded to reset undo history. */
  documentVersion?: number;
}

export interface MarkdownEditorHandle {
  focus: () => void;
  wrap: (before: string, after?: string) => void;
  prefix: (prefix: string) => void;
  insert: (text: string) => void;
  getText: () => string;
}

const previewCompartment = new Compartment();

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(function MarkdownEditor(
  { value, onChange, livePreview = true, placeholder: placeholderText = '从一句话开始。', documentVersion = 0 },
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

  function createExtensions() {
    return [
      history(),
      drawSelection(),
      dropCursor(),
      highlightActiveLine(),
      bracketMatching(),
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
        indentWithTab,
      ]),
      gatherTheme,
      placeholder(placeholderText),
      previewCompartment.of(livePreviewRef.current ? livePreviewExtensions : []),
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
      effects: previewCompartment.reconfigure(livePreview ? livePreviewExtensions : []),
    });
  }, [livePreview]);

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
    getText() {
      return viewRef.current?.state.doc.toString() ?? '';
    },
  }), []);

  return <div ref={hostRef} className="gather-editor" aria-label="Markdown editor" />;
});

export { countText } from '@gather/core';
export { toggleLinePrefix, toggleWrap } from './text-commands';
