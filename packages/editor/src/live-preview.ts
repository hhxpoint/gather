import { syntaxTree } from '@codemirror/language';
import {
  StateField,
  type EditorState,
  type Range,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { renderMarkdown } from '@gather/core';

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
};

const hiddenMarks = new Set(['HeaderMark', 'EmphasisMark', 'CodeMark', 'QuoteMark']);

/** Whole-document table previews are skipped above this size to protect typing latency. */
export const MAX_TABLE_PREVIEW_DOCUMENT = 1_500_000;
const MAX_TABLE_SOURCE = 50_000;
const MAX_TABLE_WIDGETS = 30;

export interface MarkdownImageSyntax {
  alt: string;
  src: string;
  title?: string;
}

export interface MarkdownLinkSyntax {
  text: string;
  href: string;
  title?: string;
}

export interface LivePreviewConfig {
  /** Ctrl/Cmd+click and table links call this; the desktop validates the URL again. */
  onOpenLink?: (href: string) => void;
  /** Resolve a document-relative image to a data URI, or null when unavailable. */
  resolveImage?: (src: string) => Promise<string | null>;
}

const LABEL = String.raw`((?:\\.|[^\]\\])*)`;
const TARGET = String.raw`\(\s*(?:<([^>]*)>|([^\s)]+))(?:\s+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?\s*\)`;
const IMAGE_SYNTAX = new RegExp(String.raw`^!\[${LABEL}\]${TARGET}$`, 's');
const LINK_SYNTAX = new RegExp(String.raw`^\[${LABEL}\]${TARGET}$`, 's');

function cleanMarkdownLabel(value: string): string {
  return value.replace(/\\([\\[\]()])/g, '$1');
}

export function parseImageSyntax(value: string): MarkdownImageSyntax | null {
  const match = IMAGE_SYNTAX.exec(value);
  if (!match) return null;
  const src = match[2] ?? match[3];
  if (!src) return null;
  return {
    alt: cleanMarkdownLabel(match[1]),
    src,
    title: match[4] ?? match[5] ?? match[6] ?? undefined,
  };
}

export function parseLinkSyntax(value: string): MarkdownLinkSyntax | null {
  const match = LINK_SYNTAX.exec(value);
  if (!match) return null;
  const href = match[2] ?? match[3];
  if (!href) return null;
  return {
    text: cleanMarkdownLabel(match[1]),
    href,
    title: match[4] ?? match[5] ?? match[6] ?? undefined,
  };
}

export function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function selectionTouches(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some(range => range.from <= to && range.to >= from);
}

function addLine(items: Range<Decoration>[], view: EditorView, position: number, className: string) {
  const line = view.state.doc.lineAt(position);
  items.push({
    from: line.from,
    to: line.from,
    value: Decoration.line({ class: className }),
  });
}

function addLineRange(
  items: Range<Decoration>[],
  view: EditorView,
  from: number,
  to: number,
  className: (first: boolean, last: boolean) => string,
) {
  let position = from;
  let first = true;
  while (position <= to) {
    const line = view.state.doc.lineAt(position);
    const last = line.to >= to;
    addLine(items, view, position, className(first, last));
    first = false;
    if (last) break;
    position = line.to + 1;
  }
}

function renderTableHtml(source: string): string | null {
  const rendered = renderMarkdown(source);
  const table = /<table\b[\s\S]*?<\/table>/i.exec(rendered);
  return table?.[0] ?? null;
}

interface TableInfo {
  from: number;
  to: number;
  html: string;
}

interface TablePreviewState {
  tables: TableInfo[];
  decorations: DecorationSet;
}

function scanTables(state: EditorState): TableInfo[] {
  if (state.doc.length > MAX_TABLE_PREVIEW_DOCUMENT) return [];
  const tables: TableInfo[] = [];
  syntaxTree(state).iterate({
    enter: node => {
      if (node.name !== 'Table') return undefined;
      const from = state.doc.lineAt(node.from).from;
      const to = state.doc.lineAt(node.to).to;
      const source = state.doc.sliceString(from, to);
      if (source.length <= MAX_TABLE_SOURCE && tables.length < MAX_TABLE_WIDGETS) {
        const html = renderTableHtml(source);
        if (html) tables.push({ from, to, html });
      }
      return false;
    },
  });
  return tables;
}

class TableWidget extends WidgetType {
  constructor(
    readonly html: string,
    readonly from: number,
    readonly config: LivePreviewConfig,
  ) {
    super();
  }

  eq(other: TableWidget): boolean {
    return other.html === this.html && other.from === this.from;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-table-widget';
    wrap.title = '点击表格进入源码编辑';
    wrap.innerHTML = this.html;
    wrap.addEventListener('click', event => {
      const target = event.target as Element | null;
      const anchor = target?.closest?.('a[href]');
      if (anchor && isHttpUrl(anchor.getAttribute('href') ?? '')) {
        event.preventDefault();
        event.stopPropagation();
        this.config.onOpenLink?.(anchor.getAttribute('href')!);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({ selection: { anchor: this.from }, scrollIntoView: true });
      view.focus();
    });
    return wrap;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function buildTableDecorations(
  tables: TableInfo[],
  state: EditorState,
  config: LivePreviewConfig,
): DecorationSet {
  const ranges = tables
    .filter(table => !selectionTouches(state, table.from, table.to))
    .map(table => Decoration.replace({
      widget: new TableWidget(table.html, table.from, config),
      block: true,
    }).range(table.from, table.to));
  return Decoration.set(ranges, true);
}

function createTablePreviewField(config: LivePreviewConfig): StateField<TablePreviewState> {
  return StateField.define<TablePreviewState>({
    create(state) {
      const tables = scanTables(state);
      return { tables, decorations: buildTableDecorations(tables, state, config) };
    },
    update(value, transaction) {
      if (transaction.docChanged) {
        const tables = scanTables(transaction.state);
        return {
          tables,
          decorations: buildTableDecorations(tables, transaction.state, config),
        };
      }
      if (transaction.selection) {
        return {
          tables: value.tables,
          decorations: buildTableDecorations(value.tables, transaction.state, config),
        };
      }
      return value;
    },
    provide: field => EditorView.decorations.from(field, value => value.decorations),
  });
}

class ImageWidget extends WidgetType {
  private destroyed = false;

  constructor(
    readonly image: MarkdownImageSyntax,
    readonly from: number,
    readonly config: LivePreviewConfig,
  ) {
    super();
  }

  eq(other: ImageWidget): boolean {
    return other.from === this.from
      && other.image.src === this.image.src
      && other.image.alt === this.image.alt
      && other.image.title === this.image.title;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'cm-image-widget is-loading';
    wrap.title = '点击编辑图片语法';
    wrap.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({ selection: { anchor: this.from }, scrollIntoView: true });
      view.focus();
    });

    const fallback = document.createElement('span');
    fallback.className = 'cm-image-fallback';
    fallback.textContent = '正在加载图片…';

    const img = document.createElement('img');
    img.alt = this.image.alt;
    img.decoding = 'async';
    // The widget only exists inside the visible viewport, and CSS keeps the
    // image hidden until load. Lazy loading would therefore never start.
    img.loading = 'eager';

    const caption = document.createElement('span');
    caption.className = 'cm-image-caption';
    caption.textContent = this.image.alt || this.image.src;
    if (this.image.src.length <= 240) caption.title = this.image.src;

    wrap.append(fallback, img, caption);
    this.load(wrap, img, fallback);
    return wrap;
  }

  private fail(wrap: HTMLElement, img: HTMLImageElement, fallback: HTMLElement, message: string) {
    if (this.destroyed) return;
    img.removeAttribute('src');
    wrap.classList.remove('is-loaded');
    wrap.classList.add('is-error');
    fallback.textContent = message;
  }

  private async load(wrap: HTMLElement, img: HTMLImageElement, fallback: HTMLElement) {
    const src = this.image.src;
    if (/^data:image\//i.test(src)) {
      this.show(wrap, img, fallback, src);
      return;
    }
    if (/^https?:/i.test(src)) {
      this.fail(wrap, img, fallback, '远程图片未自动加载');
      return;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//')) {
      this.fail(wrap, img, fallback, '不支持的图片地址');
      return;
    }
    if (!this.config.resolveImage) {
      this.fail(wrap, img, fallback, '本地图片预览不可用');
      return;
    }
    try {
      const dataUri = await this.config.resolveImage(src);
      if (this.destroyed) return;
      if (!dataUri) {
        this.fail(wrap, img, fallback, '本地图片未找到');
        return;
      }
      this.show(wrap, img, fallback, dataUri);
    } catch {
      this.fail(wrap, img, fallback, '本地图片读取失败');
    }
  }

  private show(wrap: HTMLElement, img: HTMLImageElement, fallback: HTMLElement, src: string) {
    img.addEventListener('load', () => {
      if (this.destroyed) return;
      wrap.classList.remove('is-loading', 'is-error');
      wrap.classList.add('is-loaded');
      fallback.hidden = true;
    }, { once: true });
    img.addEventListener('error', () => {
      this.fail(wrap, img, fallback, '图片无法显示');
    }, { once: true });
    img.src = src;
  }

  destroy(): void {
    this.destroyed = true;
  }
}

class LivePreview {
  decorations: DecorationSet;
  constructor(view: EditorView, readonly config: LivePreviewConfig) {
    this.decorations = buildDecorations(view, config);
  }
  update(update: ViewUpdate) {
    if (update.docChanged || update.selectionSet || update.viewportChanged) {
      this.decorations = buildDecorations(update.view, this.config);
    }
  }
}

function buildDecorations(view: EditorView, config: LivePreviewConfig): DecorationSet {
  const items: Range<Decoration>[] = [];
  const ranges = view.visibleRanges.length ? view.visibleRanges : [{ from: 0, to: view.state.doc.length }];
  for (const range of ranges) {
    syntaxTree(view.state).iterate({
      from: range.from,
      to: range.to,
      enter: node => {
        const name = node.name;
        // Table previews are block decorations from the state field. Skip the
        // table subtree here so inline decorations cannot overlap that block.
        if (name === 'Table') return false;
        const lineClass = headingClasses[name];
        if (lineClass) addLine(items, view, node.from, lineClass);
        if (name === 'Blockquote') {
          addLineRange(
            items,
            view,
            node.from,
            node.to,
            (first, last) => `cm-quote${first ? ' cm-quote-first' : ''}${last ? ' cm-quote-last' : ''}`,
          );
        }
        if (name === 'FencedCode') {
          addLineRange(
            items,
            view,
            node.from,
            node.to,
            (first, last) => `cm-code-line${first ? ' cm-code-first' : ''}${last ? ' cm-code-last' : ''}`,
          );
        }
        if (name === 'ListItem') addLine(items, view, node.from, 'cm-list-line');
        const markClass = markClasses[name];
        if (markClass) {
          items.push({
            from: node.from,
            to: node.to,
            value: Decoration.mark({ class: markClass }),
          });
        }
        if (name === 'Link') {
          const link = parseLinkSyntax(view.state.doc.sliceString(node.from, node.to));
          if (link && isHttpUrl(link.href)) {
            items.push({
              from: node.from,
              to: node.to,
              value: Decoration.mark({
                class: 'cm-link',
                attributes: {
                  'data-gather-href': link.href,
                  title: 'Ctrl/Cmd+点击打开链接',
                },
              }),
            });
          } else {
            items.push({
              from: node.from,
              to: node.to,
              value: Decoration.mark({ class: 'cm-link' }),
            });
          }
        }
        if (name === 'Image') {
          const image = parseImageSyntax(view.state.doc.sliceString(node.from, node.to));
          if (image && !selectionTouches(view.state, node.from, node.to)) {
            items.push({
              from: node.from,
              to: node.to,
              value: Decoration.replace({
                widget: new ImageWidget(image, node.from, config),
              }),
            });
          }
        }
        const line = view.state.doc.lineAt(node.from);
        if (hiddenMarks.has(name) && !selectionTouches(view.state, line.from, line.to)) {
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

function createLivePreviewPlugin(config: LivePreviewConfig) {
  return ViewPlugin.fromClass(
    class extends LivePreview {
      constructor(view: EditorView) {
        super(view, config);
      }
    },
    { decorations: value => value.decorations },
  );
}

function createLinkClickExtension(config: LivePreviewConfig) {
  return EditorView.domEventHandlers({
    mousedown(event) {
      if (!event.metaKey && !event.ctrlKey) return false;
      const target = event.target as Element | null;
      const link = target?.closest?.('[data-gather-href]');
      const href = link?.getAttribute('data-gather-href');
      if (!href) return false;
      event.preventDefault();
      config.onOpenLink?.(href);
      return true;
    },
  });
}

export function createLivePreviewExtensions(config: LivePreviewConfig = {}) {
  return [
    createTablePreviewField(config),
    createLivePreviewPlugin(config),
    createLinkClickExtension(config),
  ];
}
