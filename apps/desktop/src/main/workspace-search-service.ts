import { utilityProcess, type UtilityProcess } from 'electron';
import { join } from 'node:path';
import type { WorkspaceSearchOptions, WorkspaceSearchResult } from '../shared/files';

const SEARCH_TIMEOUT_MS = 8000;

let active: { id: number; child: UtilityProcess } | null = null;
let nextId = 0;

function emptyResult(error?: string): WorkspaceSearchResult {
  return {
    matches: [],
    filesScanned: 0,
    filesSkipped: 0,
    truncated: false,
    timedOut: false,
    durationMs: 0,
    ...(error ? { error } : {}),
  };
}

export function cancelWorkspaceSearch(): void {
  if (!active) return;
  const current = active;
  active = null;
  try {
    current.child.kill();
  } catch {
    // The process may already have exited.
  }
}

/**
 * Run the scan in an Electron utility process so a slow regex or a large
 * workspace cannot block the main process. The whole child is killed on a
 * new query, on workspace close and on the timeout.
 */
export function runWorkspaceSearch(
  root: string,
  options: WorkspaceSearchOptions,
): Promise<WorkspaceSearchResult> {
  cancelWorkspaceSearch();
  const id = ++nextId;
  const startedAt = Date.now();

  let child: UtilityProcess;
  try {
    child = utilityProcess.fork(join(__dirname, 'workspace-search-worker.js'), [], {
      serviceName: 'Gather Workspace Search',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '无法启动搜索进程。';
    return Promise.resolve(emptyResult(message));
  }
  active = { id, child };

  return new Promise(resolve => {
    let settled = false;
    const finish = (result: WorkspaceSearchResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (active?.id === id) active = null;
      try {
        child.kill();
      } catch {
        // Already exited.
      }
      resolve({
        ...result,
        durationMs: result.durationMs || Date.now() - startedAt,
      });
    };

    const timer = setTimeout(() => {
      finish({
        ...emptyResult(`搜索超过 ${SEARCH_TIMEOUT_MS / 1000} 秒，已停止。请缩小关键词或关闭正则。`),
        timedOut: true,
      });
    }, SEARCH_TIMEOUT_MS);

    child.on('message', (message: unknown) => {
      const data = message as { type?: string; result?: WorkspaceSearchResult };
      if (data?.type === 'result' && data.result) finish(data.result);
    });
    child.on('error', type => {
      if (!settled) console.error('Gather workspace search process error:', type);
      finish(emptyResult('搜索进程发生错误，请重试。'));
    });
    child.on('exit', () => {
      finish(emptyResult('搜索进程意外退出，请重试。'));
    });
    child.on('spawn', () => {
      if (!settled) {
        child.postMessage({ type: 'search', root, options });
      }
    });
  });
}
