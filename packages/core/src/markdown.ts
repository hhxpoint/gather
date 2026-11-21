import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

marked.setOptions({
  gfm: true,
  breaks: false,
});

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Render Markdown to a safe HTML fragment.
 * Raw HTML is allowed through a conservative allow-list, never evaled.
 */
export function renderMarkdown(markdown: string): string {
  const raw = marked.parse(markdown, { async: false });
  if (typeof raw !== 'string') throw new Error('Markdown renderer returned an unexpected result.');
  return sanitizeHtml(raw, {
    allowedTags: [
      'a', 'blockquote', 'br', 'code', 'del', 'details', 'div', 'em', 'h1', 'h2', 'h3', 'h4',
      'h5', 'h6', 'hr', 'img', 'input', 'kbd', 'li', 'ol', 'p', 'pre', 's', 'span', 'strong',
      'summary', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul',
    ],
    allowedAttributes: {
      a: ['href', 'title', 'class', 'rel'],
      code: ['class'],
      div: ['class'],
      h1: ['id'], h2: ['id'], h3: ['id'], h4: ['id'], h5: ['id'], h6: ['id'],
      img: ['src', 'alt', 'title', 'width', 'height'],
      input: ['type', 'checked', 'disabled'],
      li: ['class'],
      pre: ['class'],
      span: ['class'],
      table: ['class'],
      td: ['align'],
      th: ['align'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['http', 'https', 'data'] },
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, rel: 'noreferrer noopener' },
      }),
    },
  });
}

export function renderDocumentHtml(markdown: string, title = 'Gather'): string {
  const body = renderMarkdown(markdown);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; --paper: #fbfaf5; --ink: #303b34; --muted: #78836e; --rule: #e2e5da; --sage: #506d51; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f3f2eb; color: var(--ink); font-family: "Segoe UI", "Microsoft YaHei", sans-serif; line-height: 1.75; }
    article { max-width: 830px; margin: 0 auto; background: var(--paper); padding: 56px clamp(24px, 7vw, 86px) 72px; min-height: 100vh; }
    h1, h2, h3, h4 { font-family: Georgia, "Noto Serif CJK SC", "Songti SC", serif; font-weight: 500; line-height: 1.35; color: #344033; }
    h1 { font-size: 2.2rem; margin: 0 0 1.4em; }
    h2 { font-size: 1.55rem; margin: 2.2em 0 .65em; padding-top: .3em; border-top: 1px solid var(--rule); }
    h3 { font-size: 1.2rem; margin: 1.6em 0 .5em; }
    p, ul, ol, blockquote, pre, table { margin: 0 0 1.15em; }
    a { color: var(--sage); }
    blockquote { margin-left: 0; padding: .25em 1.2em; border-left: 3px solid #b9c9ae; color: var(--muted); background: #f1f4ea; }
    code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: .9em; background: #eef1e8; padding: .12em .35em; border-radius: 4px; }
    pre { overflow: auto; padding: 1em 1.1em; background: #eef1e8; border: 1px solid var(--rule); border-radius: 8px; }
    pre code { padding: 0; background: none; }
    table { width: 100%; border-collapse: collapse; font-size: .94em; }
    th, td { border: 1px solid var(--rule); padding: .55em .7em; text-align: left; vertical-align: top; }
    th { background: #f0f3e9; }
    img { max-width: 100%; height: auto; border-radius: 6px; }
    hr { border: 0; border-top: 1px solid var(--rule); margin: 2em 0; }
    input[type=checkbox] { accent-color: var(--sage); }
    @media print { body { background: #fff; } article { max-width: none; padding: 0; min-height: 0; } a { color: inherit; text-decoration: none; } }
  </style>
</head>
<body>
<article>
${body}
</article>
</body>
</html>`;
}

export function countText(value: string): { characters: number; words: number; lines: number } {
  const text = value.replace(/\r\n?/g, '\n');
  const latinWords = text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0;
  const cjk = text.match(/[\u3400-\u9fff\uf900-\ufaff]/g)?.length ?? 0;
  return { characters: [...text].length, words: latinWords + cjk, lines: text.split('\n').length };
}
