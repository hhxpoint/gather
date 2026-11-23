import { useEffect, useMemo, useRef, type MouseEvent } from 'react';
import { renderMarkdown } from '@gather/core';

interface ReadingViewProps {
  markdown: string;
  resolveImage: (src: string) => Promise<string | null>;
  onOpenLink: (href: string) => void;
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

/**
 * The sanitized HTML still contains image URLs. Remove every non-data `src`
 * before it enters the live DOM: remote images must never start a request, and
 * local images stay blank until the main-process boundary returns a data URI.
 */
function prepareReadingHtml(markdown: string): string {
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
  return parsed.body.innerHTML;
}

function replaceLiveImageWithNote(image: HTMLImageElement, text: string): void {
  replaceWithNote(document, image, text);
}

/**
 * Read-only rendering of the current Markdown source. It is a view, not a
 * second document model: content comes from `renderMarkdown`, local images are
 * resolved through the existing main-process boundary, and remote images are
 * never fetched.
 */
export function ReadingView({ markdown, resolveImage, onOpenLink }: ReadingViewProps) {
  const html = useMemo(() => prepareReadingHtml(markdown), [markdown]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const progressRef = useRef<HTMLSpanElement>(null);
  const resolverRef = useRef(resolveImage);
  resolverRef.current = resolveImage;
  const linkRef = useRef(onOpenLink);
  linkRef.current = onOpenLink;

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

    return () => {
      cancelled = true;
    };
  }, [html]);

  useEffect(() => {
    const view = scrollRef.current;
    const progress = progressRef.current;
    if (!view || !progress) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const range = view.scrollHeight - view.clientHeight;
      const ratio = range > 0 ? Math.min(1, Math.max(0, view.scrollTop / range)) : 0;
      progress.style.width = `${(ratio * 100).toFixed(2)}%`;
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
  }, [html]);

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
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
