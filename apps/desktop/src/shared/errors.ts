/**
 * Electron prefixes rejected ipcRenderer.invoke calls with
 * "Error invoking remote method '…': Error: ". Hide that plumbing from the UI.
 */
export function errorMessage(error: unknown, fallback = '操作失败'): string {
  if (!(error instanceof Error)) return fallback;
  const cleaned = error.message.replace(
    /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/,
    '',
  ).trim();
  return cleaned || fallback;
}
