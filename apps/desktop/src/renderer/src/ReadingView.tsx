import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import { renderMarkdown } from '@gather/core';
import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { classHighlighter, highlightTree } from '@lezer/highlight';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { extractHeadings, nearestHeadingLine } from './reading-utils';

const MAX_FIND_MATCHES = 500;
const FIND_HIGHLIGHT = 'gather-reading-find';
const CURRENT_HIGHLIGHT = 'gather-reading-find-current';

interface ReadingViewProps {
  markdown: string;
  resolveImage: (src: string) => Promise<string | null>;
  onOpenLink: (href: string) => void;
  /** Editor cursor line used to scroll to the nearest heading on entry. */
  initialLine?: number;
}

export interface ReadingHeading {
  id: string;
  level: number;
  text: string;
  sourceLine: number;
}

export interface ReadingViewHandle {
  openSearch: () => void;
  toggleToc: () => void;
  /** Source line of the last heading above the reading scroll position. */
  getActiveSourceLine: () => number | null;
}

interface HighlightRegistry {
  set: (name: string, value: unknown) => void;
  delete: (name: string) => void;
}

function imageNote(image: HTMLImageElement, reason: string): string {
  return image.alt ? `${reason} · ${image.alt}` : reason;
}

function replaceWithNote(document: Document, image: HTMLImageElement, text: string): void {
  const note = document.createElement('span');
  note.className = 'reading-image-note';
  note.textContent = text;
  image.replaceWith(note);
}

function replaceLiveImageWithNote(image: HTMLImageElement, text: string): void {
  replaceWithNote(document, image, text);
}

/**
 * Sanitize image sources before the rendered HTML enters the live DOM. Remote
 * images must not start a request; local images wait for the main-process
 * boundary to return a data URI.
 */
function prepareReadingHtml(markdown: string): { html: string; headings: ReadingHeading[] } {
  const parsed = new DOMParser().parseFromString(
    `<body>${renderMarkdown(markdown)}</body>`,
    'text/html',
  );
  for (const image of [...parsed.body.querySelectorAll('img')]) {
    const src = image.getAttribute('src') ?? '';
    if (!src || /^data:image\//i.test(src)) continue;
    if (/^https?:/i.test(src)) {
      replaceWithNote(parsed, image, imageNote(image, '远程图片未自动加载'));
      continue;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//')) {
      replaceWithNote(parsed, image, imageNote(image, '不支持的图片地址'));
      continue;
    }
    image.setAttribute('data-reading-src', src);
    image.removeAttribute('src');
    image.classList.add('is-loading');
  }

  for (const table of [...parsed.body.querySelectorAll('table')]) {
    const wrapper = parsed.createElement('div');
    wrapper.className = 'reading-table';
    table.replaceWith(wrapper);
    wrapper.append(table);
  }

  const sourceHeadings = extractHeadings(markdown);
  const headings: ReadingHeading[] = [];
  const rendered = [...parsed.body.querySelectorAll<HTMLHeadingElement>('h1, h2, h3, h4, h5, h6')];
  rendered.forEach((heading, index) => {
    const source = sourceHeadings[index];
    const id = `reading-heading-${index + 1}`;
    heading.id = id;
    heading.dataset.headingIndex = String(index);
    if (source) heading.dataset.sourceLine = String(source.line);
    headings.push({
      id,
      level: Number(heading.tagName.slice(1)),
      text: heading.textContent?.trim() || source?.text || `第 ${index + 1} 节`,
      sourceLine: source?.line ?? 0,
    });
  });

  return { html: parsed.body.innerHTML, headings };
}

async function highlightCodeBlocks(article: HTMLElement, cancelled: () => boolean): Promise<void> {
  const blocks = [...article.querySelectorAll<HTMLElement>('pre code')];
  for (const block of blocks) {
    if (cancelled()) return;
    if (block.dataset.highlighted === 'true') continue;
    const match = /language-([\w-]+)/.exec(block.className);
    if (!match) continue;
    const description = LanguageDescription.matchLanguageName(languages, match[1], true);
    if (!description) continue;
    let support;
    try {
      support = await description.load();
    } catch {
      continue;
    }
    if (cancelled()) return;
    const source = block.textContent ?? '';
    if (source.length > 200_000) continue;
    const tree = support.language.parser.parse(source);
    const fragment = document.createDocumentFragment();
    let position = 0;
    highlightTree(tree, classHighlighter, (from, to, classes) => {
      if (from > position) fragment.append(source.slice(position, from));
      if (classes) {
        const span = document.createElement('span');
        span.className = classes;
        span.textContent = source.slice(from, to);
        fragment.append(span);
      } else {
        fragment.append(source.slice(from, to));
      }
      position = to;
    });
    if (position < source.length) fragment.append(source.slice(position));
    block.replaceChildren(fragment);
    block.dataset.highlighted = 'true';
  }
}

function highlightRegistry(): HighlightRegistry | null {
  return (CSS as unknown as { highlights?: HighlightRegistry }).highlights ?? null;
}

function makeHighlight(ranges: Range[]): unknown | null {
  const HighlightConstructor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  return HighlightConstructor ? new HighlightConstructor(...ranges) : null;
}

function collectFindRanges(root: HTMLElement, query: string): Range[] {
  const needle = query.toLowerCase();
  if (!needle) return [];
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node && ranges.length < MAX_FIND_MATCHES) {
    const text = node.nodeValue ?? '';
    const parent = node.parentElement;
    if (parent && !parent.closest('script, style')) {
      const haystack = text.toLowerCase();
      let from = 0;
      while (ranges.length < MAX_FIND_MATCHES) {
        const index = haystack.indexOf(needle, from);
        if (index < 0) break;
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + needle.length);
        ranges.push(range);
        from = index + Math.max(1, needle.length);
      }
    }
    node = walker.nextNode();
  }
  return ranges;
}

function scrollRangeIntoView(range: Range): void {
  let node: Node | null = range.startContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  const element = node instanceof Element ? node : node?.parentElement;
  const block = element?.closest('p, li, h1, h2, h3, h4, h5, h6, pre, blockquote, td, th, figcaption');
  (block ?? element)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

export const ReadingView = forwardRef<ReadingViewHandle, ReadingViewProps>(
  function ReadingView({ markdown, resolveImage, onOpenLink, initialLine = 1 }, ref) {
    const prepared = useMemo(() => prepareReadingHtml(markdown), [markdown]);
    const scrollRef = useRef<HTMLDivElement>(null);
    const articleRef = useRef<HTMLElement>(null);
    const progressRef = useRef<HTMLSpanElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const resolverRef = useRef(resolveImage);
    resolverRef.current = resolveImage;
    const linkRef = useRef(onOpenLink);
    linkRef.current = onOpenLink;
    const rangesRef = useRef<Range[]>([]);
    const matchIndexRef = useRef(0);
    const activeLineRef = useRef(initialLine);
    const [contentVersion, setContentVersion] = useState(0);
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [matchCount, setMatchCount] = useState(0);
    const [currentMatch, setCurrentMatch] = useState(0);
    const [tocOpen, setTocOpen] = useState(false);
    const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);

    function applyCurrentMatch(index: number, ranges = rangesRef.current) {
      matchIndexRef.current = index;
      setCurrentMatch(index);
      const registry = highlightRegistry();
      if (registry) {
        registry.delete(CURRENT_HIGHLIGHT);
        const current = ranges[index];
        if (current) {
          const highlight = makeHighlight([current]);
          if (highlight) registry.set(CURRENT_HIGHLIGHT, highlight);
        }
      }
      const range = ranges[index];
      if (range) scrollRangeIntoView(range);
    }

    useImperativeHandle(ref, () => ({
      openSearch() {
        setTocOpen(false);
        setSearchOpen(true);
        window.requestAnimationFrame(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        });
      },
      toggleToc() {
        setSearchOpen(false);
        setTocOpen(value => !value);
      },
      getActiveSourceLine() {
        return activeLineRef.current || initialLine || null;
      },
    }), [initialLine]);

    useEffect(() => {
      const article = articleRef.current;
      if (!article) return;
      let cancelled = false;
      const images = [...article.querySelectorAll<HTMLImageElement>('img[data-reading-src]')];

      for (const image of images) {
        const original = image.dataset.readingSrc ?? '';
        if (!original) continue;
        image.addEventListener('error', () => {
          if (!cancelled) replaceLiveImageWithNote(image, imageNote(image, '图片无法显示'));
        }, { once: true });
        void resolverRef.current(original).then(dataUri => {
          if (cancelled) return;
          if (!dataUri) {
            replaceLiveImageWithNote(image, imageNote(image, '本地图片未找到'));
            return;
          }
          image.src = dataUri;
          image.classList.remove('is-loading');
        }).catch(() => {
          if (!cancelled) replaceLiveImageWithNote(image, imageNote(image, '本地图片读取失败'));
        });
      }

      void highlightCodeBlocks(article, () => cancelled).then(() => {
        if (!cancelled) setContentVersion(value => value + 1);
      });

      return () => {
        cancelled = true;
      };
    }, [prepared.html]);

    useEffect(() => {
      const view = scrollRef.current;
      const article = articleRef.current;
      if (!view || !article || prepared.headings.length === 0) return;
      const targetLine = nearestHeadingLine(
        prepared.headings.map(heading => ({ line: heading.sourceLine })),
        initialLine,
      );
      if (targetLine === null) return;
      const target = article.querySelector<HTMLElement>(`[data-source-line="${targetLine}"]`);
      if (!target) return;
      const frame = window.requestAnimationFrame(() => {
        view.scrollTop = Math.max(0, target.offsetTop - 16);
      });
      return () => window.cancelAnimationFrame(frame);
    }, [prepared.html, prepared.headings, initialLine]);

    useEffect(() => {
      const view = scrollRef.current;
      const article = articleRef.current;
      const progress = progressRef.current;
      if (!view || !article || !progress) return;
      let frame = 0;
      const update = () => {
        frame = 0;
        const range = view.scrollHeight - view.clientHeight;
        const ratio = range > 0 ? Math.min(1, Math.max(0, view.scrollTop / range)) : 0;
        progress.style.width = `${(ratio * 100).toFixed(2)}%`;

        const viewTop = view.getBoundingClientRect().top;
        const headingElements = [...article.querySelectorAll<HTMLElement>('[data-heading-index]')];
        let active: HTMLElement | null = null;
        for (const heading of headingElements) {
          const top = heading.getBoundingClientRect().top - viewTop;
          if (top <= 120) active = heading;
          else break;
        }
        if (view.scrollTop + view.clientHeight >= view.scrollHeight - 8) {
          active = headingElements.at(-1) ?? active;
        }
        if (active) {
          const sourceLine = Number(active.dataset.sourceLine ?? 0);
          if (sourceLine) activeLineRef.current = sourceLine;
          setActiveHeadingId(current => current === active!.id ? current : active!.id);
        }
      };
      const onScroll = () => {
        if (!frame) frame = window.requestAnimationFrame(update);
      };
      view.addEventListener('scroll', onScroll, { passive: true });
      update();
      return () => {
        view.removeEventListener('scroll', onScroll);
        if (frame) window.cancelAnimationFrame(frame);
      };
    }, [prepared.html]);

    useEffect(() => {
      if (!searchOpen) {
        const registry = highlightRegistry();
        registry?.delete(FIND_HIGHLIGHT);
        registry?.delete(CURRENT_HIGHLIGHT);
        rangesRef.current = [];
        setMatchCount(0);
        return;
      }
      const article = articleRef.current;
      const query = searchQuery.trim();
      if (!article || !query) {
        rangesRef.current = [];
        setMatchCount(0);
        return;
      }
      const ranges = collectFindRanges(article, query);
      rangesRef.current = ranges;
      setMatchCount(ranges.length);
      const registry = highlightRegistry();
      if (registry) {
        registry.delete(FIND_HIGHLIGHT);
        registry.delete(CURRENT_HIGHLIGHT);
        if (ranges.length > 0) {
          const all = makeHighlight(ranges);
          if (all) registry.set(FIND_HIGHLIGHT, all);
        }
      }
      if (ranges.length > 0) applyCurrentMatch(0, ranges);
      else setCurrentMatch(0);
      return () => {
        const currentRegistry = highlightRegistry();
        currentRegistry?.delete(FIND_HIGHLIGHT);
        currentRegistry?.delete(CURRENT_HIGHLIGHT);
      };
      // contentVersion re-runs search after code blocks are tokenized.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchOpen, searchQuery, prepared.html, contentVersion]);

    useEffect(() => {
      if (!searchOpen && !tocOpen) return;
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        if (searchOpen) setSearchOpen(false);
        else setTocOpen(false);
      };
      window.addEventListener('keydown', onKeyDown, true);
      return () => window.removeEventListener('keydown', onKeyDown, true);
    }, [searchOpen, tocOpen]);

    function stepMatch(delta: number) {
      const ranges = rangesRef.current;
      if (ranges.length === 0) return;
      const next = (matchIndexRef.current + delta + ranges.length) % ranges.length;
      applyCurrentMatch(next, ranges);
    }

    function jumpToHeading(index: number) {
      const article = articleRef.current;
      const heading = article?.querySelector<HTMLElement>(`[data-heading-index="${index}"]`);
      heading?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      setTocOpen(false);
    }

    function handleClick(event: MouseEvent<HTMLElement>) {
      const target = event.target as Element | null;
      const anchor = target?.closest?.('a[href]');
      if (!anchor) return;
      const href = anchor.getAttribute('href') ?? '';
      event.preventDefault();
      if (/^https?:/i.test(href)) linkRef.current(href);
    }

    return (
      <div className="reading-view" ref={scrollRef}>
        <div className="reading-progress" aria-hidden="true"><span ref={progressRef} /></div>
        <article
          className="reading-article"
          ref={articleRef}
          onClick={handleClick}
          dangerouslySetInnerHTML={{ __html: prepared.html }}
        />

        {searchOpen && (
          <div className="reading-search" role="search">
            <Search size={14} aria-hidden="true" />
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  stepMatch(event.shiftKey ? -1 : 1);
                }
              }}
              placeholder="在阅读中查找…"
              aria-label="在阅读中查找"
              spellCheck={false}
            />
            <span className="reading-search-count" aria-live="polite">
              {matchCount > 0 ? `${currentMatch + 1} / ${matchCount}` : searchQuery.trim() ? '无匹配' : ''}
            </span>
            <button type="button" onClick={() => stepMatch(-1)} disabled={matchCount === 0} title="上一个匹配" aria-label="上一个匹配">
              <ChevronUp size={14} />
            </button>
            <button type="button" onClick={() => stepMatch(1)} disabled={matchCount === 0} title="下一个匹配" aria-label="下一个匹配">
              <ChevronDown size={14} />
            </button>
            <button type="button" className="reading-search-close" onClick={() => setSearchOpen(false)} title="关闭查找" aria-label="关闭查找">
              <X size={13} />
            </button>
          </div>
        )}

        {tocOpen && (
          <nav className="reading-toc" aria-label="文内目录">
            <header>
              <strong>文内目录</strong>
              <button type="button" onClick={() => setTocOpen(false)} title="关闭目录" aria-label="关闭目录">
                <X size={13} />
              </button>
            </header>
            {prepared.headings.length > 0 ? (
              <ol>
                {prepared.headings.map((heading, index) => (
                  <li key={heading.id}>
                    <button
                      type="button"
                      className={activeHeadingId === heading.id ? 'active' : undefined}
                      style={{ paddingLeft: `${8 + (heading.level - 1) * 10}px` }}
                      onClick={() => jumpToHeading(index)}
                      title={heading.text}
                    >
                      {heading.text}
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p>这篇文稿没有标题。</p>
            )}
          </nav>
        )}
      </div>
    );
  },
);
