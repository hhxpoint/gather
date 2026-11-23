export interface ReadingHeadingSource {
  level: number;
  text: string;
  /** 1-based source line. */
  line: number;
}

function decodeEntities(value: string): string {
  const entities: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    try {
      if (code.startsWith('#x')) return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
      if (code.startsWith('#')) return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
      return entities[code.toLowerCase()] ?? match;
    } catch {
      return match;
    }
  });
}

export function cleanHeadingText(raw: string): string {
  let text = raw.replace(/\s+#+\s*$/, '').trim();
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  text = text.replace(/<[^>]*>/g, '');
  text = text.replace(/[`*_~]/g, '');
  text = text.replace(/\\([\\`*{}[\]()#+\-.!_>])/g, '$1');
  return decodeEntities(text).replace(/\s+/g, ' ').trim();
}

/**
 * Extract heading positions for the TOC and source-line sync. Fenced code is
 * skipped so shell comments and `#` examples do not become outline entries.
 */
export function extractHeadings(markdown: string): ReadingHeadingSource[] {
  const lines = markdown.split(/\r\n|\n|\r/);
  const headings: ReadingHeadingSource[] = [];
  let fence: { character: string; length: number } | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!fence) {
        fence = { character: marker[0], length: marker.length };
      } else if (marker[0] === fence.character && marker.length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (fence) continue;

    const atx = /^\s{0,3}(#{1,6})(?:\s+(.*?))?\s*$/.exec(line);
    if (atx) {
      const text = cleanHeadingText(atx[2] ?? '');
      if (text) headings.push({ level: atx[1].length, text, line: index + 1 });
      continue;
    }

    const next = lines[index + 1] ?? '';
    const setext = /^\s{0,3}(=+|-+)\s*$/.exec(next);
    const text = cleanHeadingText(line);
    if (
      text
      && setext
      && !/^\s{0,3}(?:[-*+]|\d+\.)\s/.test(line)
      && !/^\s{0,3}>/.test(line)
    ) {
      headings.push({ level: setext[1][0] === '=' ? 1 : 2, text, line: index + 1 });
      index += 1;
    }
  }

  return headings;
}

/** The last heading at or above the requested source line. */
export function nearestHeadingLine(
  headings: Pick<ReadingHeadingSource, 'line'>[],
  line: number,
): number | null {
  let nearest: number | null = null;
  for (const heading of headings) {
    if (heading.line <= line) nearest = heading.line;
    else break;
  }
  return nearest;
}
