import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('captureOverlay', {
  submit(rect: { x: number; y: number; width: number; height: number } | null): void {
    ipcRenderer.send('capture:rect', rect);
  },
});
