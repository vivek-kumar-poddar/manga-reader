import { contextBridge, ipcRenderer } from 'electron';

export interface ElectronAPI {
  isElectron: true;
  selectFolder(): Promise<string | null>;
  listFolder(
    folderPath: string,
  ): Promise<{ relativePath: string; absolutePath: string; size: number; modified: number }[]>;
  readFile(absolutePath: string): Promise<ArrayBuffer | null>;
  setProgressBar(progress: number): void;
}

// Expose a minimal API to the renderer so it can detect the Electron environment
// and access local files without enabling nodeIntegration.
contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  selectFolder: (): Promise<string | null> => ipcRenderer.invoke('select-folder'),
  listFolder: (
    folderPath: string,
  ): Promise<{ relativePath: string; absolutePath: string; size: number; modified: number }[]> =>
    ipcRenderer.invoke('list-folder', folderPath),
  readFile: (absolutePath: string): Promise<ArrayBuffer | null> =>
    ipcRenderer.invoke('read-file', absolutePath),
  setProgressBar: (progress: number): void => ipcRenderer.send('set-progress-bar', progress),
} satisfies ElectronAPI);
