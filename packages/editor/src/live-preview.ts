import { syntaxTree } from '@codemirror/language';
import type { Range } from '@codemirror/state';
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view';

const headingClasses: Record<string, string> = {
  ATXHeading1: 'cm-heading-1',
  ATXHeading2: 'cm-heading-2',
  ATXHeading3: 'cm-heading-3',
  ATXHeading4: 'cm-heading-4',
  ATXHeading5: 'cm-heading-5',
  ATXHeading6: 'cm-heading-6',
  SetextHeading1: 'cm-heading-1',
  SetextHeading2: 'cm-heading-2',
};

const markClasses: Record<string, string> = {
  StrongEmphasis: 'cm-strong',
  Emphasis: 'cm-em',
  InlineCode: 'cm-inline-code',
  Link: 'cm-link',
};

const hiddenMarks = new Set(['HeaderMark', 'EmphasisMark', 'CodeMark']);

function selectionTouches(view: EditorView, from: number, to: number): boolean {
  return view.state.selection.ranges.some(range => range.from <= to && range.to >= from);
}

function addLine(items: Range<Decoration>[], view: EditorView, position: number, className: string) {
  const line = view.state.doc.lineAt(position);
  items.push({
    from: line.from,
    to: line.from,
    value: Decoration.line({ class: className }),
  });
}

function buildDecorations(view: EditorView): DecorationSet {
  const items: Range<Decoration>[] = [];
  const ranges = view.visibleRanges.length ? view.visibleRanges : [{ from: 0, to: view.state.doc.length }];
  for (const range of ranges) {
    syntaxTree(view.state).iterate({
      from: range.from,
      to: range.to,
      enter: node => {
        const name = node.name;
        const lineClass = headingClasses[name];
        if (lineClass) addLine(items, view, node.from, lineClass);
        if (name === 'Blockquote') addLine(items, view, node.from, 'cm-quote');
        if (name === 'FencedCode') {
          let position = node.from;
          while (position <= node.to) {
            addLine(items, view, position, 'cm-code-line');
            const line = view.state.doc.lineAt(position);
            if (line.to >= node.to) break;
            position = line.to + 1;
          }
        }
        if (name === 'BulletList' || name === 'OrderedList') addLine(items, view, node.from, 'cm-list-line');
        const markClass = markClasses[name];
        if (markClass) {
          items.push({
            from: node.from,
            to: node.to,
            value: Decoration.mark({ class: markClass }),
          });
        }
        const line = view.state.doc.lineAt(node.from);
        if (hiddenMarks.has(name) && !selectionTouches(view, line.from, line.to)) {
          items.push({
            from: node.from,
            to: node.to,
            value: Decoration.replace({}),
          });
        }
        return undefined;
      },
    });
  }
  items.sort((a, b) => a.from - b.from || a.to - b.to);
  return Decoration.set(items, true);
}

class LivePreview {
  decorations: DecorationSet;
  constructor(view: EditorView) {
    this.decorations = buildDecorations(view);
  }
  update(update: ViewUpdate) {
    if (update.docChanged || update.selectionSet || update.viewportChanged) {
      this.decorations = buildDecorations(update.view);
    }
  }
}

export const livePreview = ViewPlugin.fromClass(LivePreview, {
  decorations: value => value.decorations,
});

export const livePreviewExtensions = [livePreview];
