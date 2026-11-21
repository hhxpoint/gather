import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type {
  ExternalChange,
  OpenedFile,
  RecoveryPayload,
  RecoverySnapshot,
  RestoredRecovery,
  SaveAsRequest,
  SaveOutcome,
  SaveRequest,
} from '../shared/files';

const api = {
  openFile: (): Promise<OpenedFile | null> => ipcRenderer.invoke('file:open'),
  saveFile: (request: SaveRequest): Promise<SaveOutcome> =>
    ipcRenderer.invoke('file:save', request),
  saveFileAs: (request: SaveAsRequest): Promise<SaveOutcome | null> =>
    ipcRenderer.invoke('file:saveAs', request),
  reloadActiveFile: (): Promise<OpenedFile> => ipcRenderer.invoke('file:reloadActive'),
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
} from '../shared/files';
