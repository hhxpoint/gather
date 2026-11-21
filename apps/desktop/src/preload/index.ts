import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

export interface OpenedFile {
  path: string;
  name: string;
  content: string;
}

const api = {
  openFile: (): Promise<OpenedFile | null> => ipcRenderer.invoke('file:open'),
  saveFile: (path: string, content: string): Promise<{ path: string; name: string } | null> =>
    ipcRenderer.invoke('file:save', { path, content }),
  saveFileAs: (content: string): Promise<{ path: string; name: string } | null> =>
    ipcRenderer.invoke('file:saveAs', { content }),
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
