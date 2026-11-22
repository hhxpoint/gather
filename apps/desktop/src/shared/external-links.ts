export class ExternalLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExternalLinkError';
  }
}

/**
 * Only ordinary web links may leave Gather. This rejects javascript:, file:,
 * data:, credentials in the authority, and malformed values before shell.openExternal.
 */
export function safeExternalUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ExternalLinkError('链接地址为空。');
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ExternalLinkError('链接地址无效。');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ExternalLinkError('只允许打开 http/https 链接。');
  }
  if (parsed.username || parsed.password) {
    throw new ExternalLinkError('链接不能包含账号或密码。');
  }
  return parsed.toString();
}
