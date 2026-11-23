import type { WorkspaceSearchOptions, WorkspaceSearchResult } from '../shared/files';
import { listWorkspace } from './workspace';
import { searchWorkspaceFiles } from './workspace-search';

interface SearchMessage {
  type: 'search';
  root: string;
  options: WorkspaceSearchOptions;
}

const port = process.parentPort;
if (!port) {
  throw new Error('Workspace search must run as an Electron utility process.');
}

function errorResult(message: string): WorkspaceSearchResult {
  return {
    matches: [],
    filesScanned: 0,
    filesSkipped: 0,
    truncated: false,
    timedOut: false,
    durationMs: 0,
    error: message,
  };
}

async function handle(message: SearchMessage): Promise<void> {
  if (!message || message.type !== 'search') return;
  try {
    const workspace = await listWorkspace(message.root);
    const result = await searchWorkspaceFiles(
      workspace.root,
      workspace.files,
      message.options,
    );
    port?.postMessage({ type: 'result', result });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : '工作区搜索失败。';
    port?.postMessage({ type: 'result', result: errorResult(messageText) });
  }
}

port.on('message', event => {
  void handle(event.data as SearchMessage);
});
