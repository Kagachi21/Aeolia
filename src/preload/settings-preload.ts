import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('settingsApi', {
  get: () => ipcRenderer.invoke('settings:get'),
  screenInfo: () => ipcRenderer.invoke('screen:info'),
  set: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value),
  close: () => ipcRenderer.send('settings:close'),
  pickFile: () => ipcRenderer.invoke('settings:pick-file'),
  pickFolder: () => ipcRenderer.invoke('settings:pick-folder'),
  openPath: (path: string) => ipcRenderer.send('settings:open-path', path),
  extras: () => ipcRenderer.invoke('extras:get'),
  onChange: (cb: (state: unknown) => void): (() => void) => {
    const handler = (_event: unknown, state: unknown) => cb(state);
    ipcRenderer.on('settings:changed', handler);
    return () => ipcRenderer.removeListener('settings:changed', handler);
  },
});
