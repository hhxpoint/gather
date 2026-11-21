import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type {
  OpenedFile,
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
  onMenuAction: (listener: (action: string) => void) => {
    const handler = (_event: IpcRendererEvent, action: string) => listener(action);
    ipcRenderer.on('menu-action', handler);
    return () => {
      ipcRenderer.removeListener('menu-action', handler);
    };
  },
};

contextBridge.exposeInMainWorld('gather', api);

export type GatherApi = typeof api;
export type {
  OpenedFile,
  SaveAsRequest,
  SaveOutcome,
  SaveRequest,
  SavedFile,
  FileVersion,
} from '../shared/files';
