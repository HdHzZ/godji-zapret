const { contextBridge, ipcRenderer } = require('electron');
function listen(channel, callback) {
  const handler = (event, value) => callback(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('electronAPI', {
  telegramStatus: () => ipcRenderer.invoke('telegram-status'),
  telegramAction: (action) => ipcRenderer.invoke('telegram-action', action),
  closeApp: () => ipcRenderer.send('close-app'),
  minimizeApp: () => ipcRenderer.send('minimize-app'),
  toggleZapret: (status) => ipcRenderer.invoke('toggle-zapret', status),
  openAdminPanel: () => ipcRenderer.send('open-admin-panel'),
  downloadZapret: () => ipcRenderer.invoke('download-zapret'),
  checkUpdates: () => ipcRenderer.invoke('check-updates'),
  runTests: () => ipcRenderer.invoke('run-tests'),
  checkStatus: () => ipcRenderer.invoke('check-status'),
  getGameFilter: () => ipcRenderer.invoke('get-game-filter'),
  setGameFilter: (mode) => ipcRenderer.invoke('set-game-filter', mode),
  getIpsetStatus: () => ipcRenderer.invoke('get-ipset-status'),
  setIpsetMode: (target) => ipcRenderer.invoke('set-ipset-mode', target),
  updateIpset: () => ipcRenderer.invoke('update-ipset'),
  updateHosts: () => ipcRenderer.invoke('update-hosts'),
  runDiagnostics: () => ipcRenderer.invoke('run-diagnostics'),
  listStrategies: () => ipcRenderer.invoke('list-strategies'),
  setStrategy: (name) => ipcRenderer.invoke('set-strategy', name),
  removeZapretService: () => ipcRenderer.invoke('remove-zapret-service'),
  scanServices: () => ipcRenderer.invoke('scan-services'),
  removeServices: (names) => ipcRenderer.invoke('remove-services', names),
  checkAppUpdate: () => ipcRenderer.invoke('check-app-update'),
  applyAppUpdate: () => ipcRenderer.invoke('apply-app-update'),
  onTestProgress: (callback) => listen('test-progress', callback),
  onTestComplete: (callback) => listen('test-complete', callback),
  onAppUpdateProgress: (callback) => listen('app-update-progress', callback)
});
