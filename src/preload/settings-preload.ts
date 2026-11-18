import { contextBridge, ipcRenderer } from 'electron';

const surfaceArg = process.argv.find((arg) => arg.startsWith('--aeolia-surface='));
const injectedSurface = surfaceArg ? surfaceArg.slice('--aeolia-surface='.length) : '';
const LIGHT_SURFACES = ['Liquid glass', 'Translucent', 'Candy glass'];

/* Preload runs at document-start, before <html> exists. The observer applies
   the theme the moment the root element appears, which is before CSS first
   paint; settings.js later re-applies the same values as a safety net. Keep
   the global for callers that read the injected value explicitly. */
function applyInjectedTheme(): boolean {
  if (!document.documentElement || !injectedSurface) return false;
  document.documentElement.dataset.surface = injectedSurface;
  document.documentElement.dataset.tone = LIGHT_SURFACES.includes(injectedSurface) ? 'light' : 'dark';
  return true;
}
if (!applyInjectedTheme()) {
  const observer = new MutationObserver(() => {
    if (applyInjectedTheme()) observer.disconnect();
  });
  observer.observe(document, { childList: true });
}
contextBridge.exposeInMainWorld('__AEOLIA_THEME__', { surface: injectedSurface });

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
