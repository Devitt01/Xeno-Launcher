const { contextBridge, ipcRenderer } = require('electron');

const sendChannels = new Set([
  'get-instances',
  'set-ram',
  'install-instance',
  'launch-game',
  'delete-instance',
  'focus-window',
  'focus-debug',
  'get-vanilla-versions',
  'get-profile',
  'save-profile',
  'clear-profile',
  'open-instance-folder',
  'get-forge-versions',
  'get-neoforge-versions',
  'get-snapshot-versions',
  'get-fabric-versions',
  'open-external',
  'get-settings',
  'set-java-path',
  'set-skin-service-settings',
  'check-username-conflict',
  'ely-login',
  'window-minimize',
  'window-toggle-maximize',
  'window-close'
]);

const onChannels = new Set([
  'instances-list',
  'install-complete',
  'install-error',
  'game-log',
  'vanilla-versions',
  'vanilla-versions-error',
  'install-progress',
  'install-finished',
  'game-starting',
  'game-started',
  'launch-error',
  'profile-data',
  'open-instance-folder-error',
  'forge-versions',
  'forge-versions-error',
  'neoforge-versions',
  'neoforge-versions-error',
  'snapshot-versions',
  'snapshot-versions-error',
  'fabric-versions',
  'fabric-versions-error',
  'java-guide',
  'settings-data',
  'java-path-result',
  'username-conflict-result',
  'ely-login-result',
  'window-state'
]);

contextBridge.exposeInMainWorld('xeno', {
  send: (channel, ...args) => {
    if (sendChannels.has(channel)) {
      ipcRenderer.send(channel, ...args);
    }
  },
  on: (channel, listener) => {
    if (onChannels.has(channel)) {
      ipcRenderer.on(channel, listener);
    }
  }
});
