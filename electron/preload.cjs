const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  listFolder: (folderPath) => ipcRenderer.invoke('list-folder', folderPath),
  readFile: (absolutePath) => ipcRenderer.invoke('read-file', absolutePath),
  setProgressBar: (progress) => ipcRenderer.send('set-progress-bar', progress),
});

