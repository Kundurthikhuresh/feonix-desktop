const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('feonix', {
  back: () => ipcRenderer.send('feonix:back'),
  quit: () => ipcRenderer.send('feonix:quit'),
  goToDashboard: () => ipcRenderer.send('feonix:dashboard'),
  minimize: () => ipcRenderer.send('feonix:minimize'),
  resize: (width, height) => ipcRenderer.send('feonix:resize', width, height),
  moveBy: (dx, dy) => ipcRenderer.send('feonix:move-by', dx, dy),
  startSession: (opts) => ipcRenderer.invoke('feonix:start-session', opts),
  pendingHandoff: () => ipcRenderer.invoke('feonix:pending-handoff'),
  onHandoff: (callback) => {
    ipcRenderer.on('feonix:handoff', (_event, data) => callback(data));
  },
  // Privacy & Security panel
  getSecurityStatus: () => ipcRenderer.invoke('feonix:get-security-status'),
  clearAppLogs: () => ipcRenderer.invoke('feonix:clear-logs'),
  clearSessionData: () => ipcRenderer.invoke('feonix:clear-session-data'),

  // Assistant settings (persisted in the main process — see settingsStore.js)
  getSettings: () => ipcRenderer.invoke('feonix:get-settings'),
  setSetting: (key, value) => ipcRenderer.invoke('feonix:set-setting', key, value),

  // Keeps the tray's Start/Stop Listening label accurate no matter where
  // recording was actually toggled from.
  setListeningState: (value) => ipcRenderer.send('feonix:set-listening-state', Boolean(value)),

  // Global shortcut + tray commands, pushed from the main process. Each
  // returns an unsubscribe function so a component can clean up on unmount.
  onShortcutToggle: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('feonix:shortcut-toggle', listener);
    return () => ipcRenderer.removeListener('feonix:shortcut-toggle', listener);
  },
  onShortcutHide: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('feonix:shortcut-hide', listener);
    return () => ipcRenderer.removeListener('feonix:shortcut-hide', listener);
  },
  onTrayShow: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('feonix:tray-show', listener);
    return () => ipcRenderer.removeListener('feonix:tray-show', listener);
  },
  onTrayMinimize: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('feonix:tray-minimize', listener);
    return () => ipcRenderer.removeListener('feonix:tray-minimize', listener);
  },
  onTrayToggleListening: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('feonix:tray-toggle-listening', listener);
    return () => ipcRenderer.removeListener('feonix:tray-toggle-listening', listener);
  },
  onTrayOpenSettings: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('feonix:tray-open-settings', listener);
    return () => ipcRenderer.removeListener('feonix:tray-open-settings', listener);
  },
});

window.addEventListener('DOMContentLoaded', () => {
  document.body.dataset.shell = 'tauri';
});
