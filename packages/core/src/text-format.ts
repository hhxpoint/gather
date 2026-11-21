export type TextEol = 'lf' | 'crlf' | 'mixed';

export interface TextFormat {
  /** Whether the decoded file started with a UTF-8 BOM. */
  bom: boolean;
  /** Pure LF, pure CRLF, or a file that mixed line endings. */
  eol: TextEol;
}

export interface DecodedText {
  /** Editor text normalized to LF. */
  text: string;
  format: TextFormat;
}

export const DEFAULT_TEXT_FORMAT: TextFormat = Object.freeze({
  bom: false,
  eol: 'lf',
});

const UTF8_BOM = '\uFEFF';

/**
 * Split storage format from editor text. The editor always receives LF text;
 * the original BOM and line-ending style travel as metadata so a save can
 * restore them instead of silently rewriting the file.
 */
export function decodeText(raw: string): DecodedText {
  const bom = raw.startsWith(UTF8_BOM);
  const body = bom ? raw.slice(1) : raw;
  let crlf = 0;
  let lf = 0;
  let loneCr = 0;

  for (let index = 0; index < body.length; index += 1) {
    const code = body.charCodeAt(index);
    if (code === 13) {
      if (body.charCodeAt(index + 1) === 10) {
        crlf += 1;
        index += 1;
      } else {
        loneCr += 1;
      }
    } else if (code === 10) {
      lf += 1;
    }
  }

  let eol: TextEol = 'lf';
  if (crlf > 0 && lf === 0 && loneCr === 0) {
    eol = 'crlf';
  } else if (crlf > 0 || loneCr > 0) {
    eol = 'mixed';
  }

  return {
    text: body.replace(/\r\n?/g, '\n'),
    format: { bom, eol },
  };
}

/**
 * Encode editor text for disk. Pure LF and CRLF round-trip byte-for-byte;
 * mixed files are normalized to LF, which is why the UI must surface that
 * format instead of pretending every file can be preserved exactly.
 */
export function encodeText(text: string, format: TextFormat = DEFAULT_TEXT_FORMAT): string {
  const safe = normalizeTextFormat(format);
  const normalized = text.replace(/\r\n?/g, '\n');
  const body = safe.eol === 'crlf' ? normalized.replace(/\n/g, '\r\n') : normalized;
  return `${safe.bom ? UTF8_BOM : ''}${body}`;
}

/** Validate data crossing IPC or persisted configuration. */
export function normalizeTextFormat(value: unknown): TextFormat {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_TEXT_FORMAT };
  }
  const record = value as Record<string, unknown>;
  const eol: TextEol = record.eol === 'crlf' || record.eol === 'mixed' ? record.eol : 'lf';
  return {
    bom: record.bom === true,
    eol,
  };
}

export function describeTextFormat(format: TextFormat): string {
  const safe = normalizeTextFormat(format);
  const eol = safe.eol === 'crlf' ? 'CRLF' : safe.eol === 'mixed' ? '混合行尾' : 'LF';
  return `UTF-8${safe.bom ? ' BOM' : ''} · ${eol}`;
}
