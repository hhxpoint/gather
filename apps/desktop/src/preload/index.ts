import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type {
  DocumentExportRequest,
  DocumentExportResult,
  ExternalChange,
  OpenedFile,
  RecoveryPayload,
  RecoverySnapshot,
  RestoredRecovery,
  SaveAsRequest,
  SaveOutcome,
  SaveRequest,
  Workspace,
  WorkspaceSearchOptions,
  WorkspaceSearchResult,
} from '../shared/files';

const api = {
  openFile: (): Promise<OpenedFile | null> => ipcRenderer.invoke('file:open'),
  saveFile: (request: SaveRequest): Promise<SaveOutcome> =>
    ipcRenderer.invoke('file:save', request),
  saveFileAs: (request: SaveAsRequest): Promise<SaveOutcome | null> =>
    ipcRenderer.invoke('file:saveAs', request),
  reloadActiveFile: (): Promise<OpenedFile> => ipcRenderer.invoke('file:reloadActive'),
  openWorkspace: (): Promise<Workspace | null> => ipcRenderer.invoke('workspace:open'),
  refreshWorkspace: (): Promise<Workspace> => ipcRenderer.invoke('workspace:refresh'),
  searchWorkspace: (options: WorkspaceSearchOptions): Promise<WorkspaceSearchResult> =>
    ipcRenderer.invoke('workspace:search', options),
  openWorkspaceFile: (relativePath: string): Promise<OpenedFile> =>
    ipcRenderer.invoke('workspace:openFile', relativePath),
  closeWorkspace: (): Promise<boolean> => ipcRenderer.invoke('workspace:close'),
  exportDocument: (request: DocumentExportRequest): Promise<DocumentExportResult> =>
    ipcRenderer.invoke('document:export', request),
  resolveDocumentImage: (src: string): Promise<string | null> =>
    ipcRenderer.invoke('image:resolve', src),
  openExternalLink: (url: string): Promise<boolean> =>
    ipcRenderer.invoke('shell:openExternal', url),
  listRecoveries: (): Promise<RecoverySnapshot[]> => ipcRenderer.invoke('recovery:list'),
  readRecovery: (id: string): Promise<RestoredRecovery | null> =>
    ipcRenderer.invoke('recovery:read', id),
  activateRecovery: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('recovery:activate', id),
  writeRecovery: (payload: RecoveryPayload): Promise<RecoverySnapshot> =>
    ipcRenderer.invoke('recovery:write', payload),
  discardRecovery: (id: string): Promise<void> =>
    ipcRenderer.invoke('recovery:discard', id),
  onMenuAction: (listener: (action: string) => void) => {
    const handler = (_event: IpcRendererEvent, action: string) => listener(action);
    ipcRenderer.on('menu-action', handler);
    return () => {
      ipcRenderer.removeListener('menu-action', handler);
    };
  },
  onExternalChange: (listener: (change: ExternalChange) => void) => {
    const handler = (_event: IpcRendererEvent, change: ExternalChange) => listener(change);
    ipcRenderer.on('file:external-change', handler);
    return () => {
      ipcRenderer.removeListener('file:external-change', handler);
    };
  },
};

contextBridge.exposeInMainWorld('gather', api);

export type GatherApi = typeof api;
export type {
  DocumentExportRequest,
  DocumentExportResult,
  ExportFormat,
  ExternalChange,
  FileVersion,
  OpenedFile,
  RecoveryPayload,
  RecoverySnapshot,
  RestoredRecovery,
  SaveAsRequest,
  SaveOutcome,
  SaveRequest,
  SavedFile,
  Workspace,
  WorkspaceFile,
  WorkspaceSearchHit,
  WorkspaceSearchOptions,
  WorkspaceSearchResult,
} from '../shared/files';
