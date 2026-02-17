const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('xenoSplash', {
  onStatus: (listener) => {
    if (typeof listener !== 'function') return;
    ipcRenderer.on('splash-status', (_event, payload) => listener(payload));
  }
});
