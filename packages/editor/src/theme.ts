import { EditorView } from '@codemirror/view';

export const gatherTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: '#303b34',
    backgroundColor: '#fbfaf5',
    fontSize: '17px',
  },
  '.cm-scroller': {
    fontFamily: 'Georgia, "Noto Serif CJK SC", "Songti SC", serif',
    lineHeight: '1.9',
    overflow: 'auto',
  },
  '.cm-content': {
    padding: '46px 0 120px',
    caretColor: '#506d51',
    maxWidth: '820px',
    margin: '0 auto',
  },
  '.cm-line': {
    padding: '0 38px',
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#506d51' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: '#dce7cf',
  },
  '.cm-panels': { backgroundColor: '#f1f2e9', color: '#465242' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid #dfe4d5' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid #dfe4d5' },
  '.cm-searchMatch': { backgroundColor: '#f2e4b8' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#e4d39b' },
  '.cm-activeLine': { backgroundColor: '#f4f5ec' },
  '.cm-gutters': { display: 'none' },
  '.cm-heading-1': { fontSize: '2em', fontWeight: '600', lineHeight: '1.35', paddingTop: '0.55em' },
  '.cm-heading-2': { fontSize: '1.55em', fontWeight: '600', lineHeight: '1.4', paddingTop: '0.5em' },
  '.cm-heading-3': { fontSize: '1.25em', fontWeight: '600', lineHeight: '1.45', paddingTop: '0.4em' },
  '.cm-heading-4, .cm-heading-5, .cm-heading-6': { fontWeight: '600' },
  '.cm-strong': { fontWeight: '700', color: '#263429' },
  '.cm-em': { fontStyle: 'italic', color: '#4d5b49' },
  '.cm-inline-code': {
    fontFamily: 'ui-monospace, Consolas, monospace',
    fontSize: '0.88em',
    backgroundColor: '#eef1e8',
    padding: '0.08em 0.28em',
    borderRadius: '4px',
  },
  '.cm-link': { color: '#506d51', textDecoration: 'underline', textUnderlineOffset: '3px' },
  '.cm-quote': {
    color: '#6f7d67',
    boxShadow: 'inset 3px 0 0 #b9c9ae',
    backgroundColor: '#f1f4ea',
  },
  '.cm-code-line': {
    fontFamily: 'ui-monospace, Consolas, monospace',
    fontSize: '0.88em',
    backgroundColor: '#eef1e8',
  },
  '.cm-list-line': { paddingLeft: '42px' },
  '.cm-placeholder': { color: '#a2ab98', fontStyle: 'italic' },
});
