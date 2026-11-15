import { contextBridge, ipcRenderer, webUtils } from 'electron';

type PointerKind = 'enter' | 'move' | 'leave';

type RobotState = {
  idle: boolean;
  batteryPercent: number;
  charging: boolean;
  cursorDx: number;
};

contextBridge.exposeInMainWorld('island', {
  onStatus(cb: (status: unknown) => void): () => void {
    const handler = (_event: unknown, status: unknown) => cb(status);
    ipcRenderer.on('island:update', handler);
    return () => ipcRenderer.removeListener('island:update', handler);
  },
  pointer(kind: PointerKind, y?: number): void {
    ipcRenderer.send('island:pointer', kind, y);
  },
  onHover(cb: (inside: boolean) => void): () => void {
    const handler = (_event: unknown, inside: boolean) => cb(inside);
    ipcRenderer.on('island:hover', handler);
    return () => ipcRenderer.removeListener('island:hover', handler);
  },
  onRobotState(cb: (state: RobotState) => void): () => void {
    const handler = (_event: unknown, state: RobotState) => cb(state);
    ipcRenderer.on('robot:state', handler);
    return () => ipcRenderer.removeListener('robot:state', handler);
  },
});

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('state:get'),
  onState: (cb: (state: unknown) => void): (() => void) => {
    const handler = (_event: unknown, state: unknown) => cb(state);
    ipcRenderer.on('state:changed', handler);
    return () => ipcRenderer.removeListener('state:changed', handler);
  },
  setTab: (tab: string) => ipcRenderer.send('state:tab', tab),
  openUrl: (url: string) => ipcRenderer.send('open:url', url),
  addSite: (name: string, url: string) => ipcRenderer.send('site:add', { name, url }),
  addShelf: (files: { name: string; path: string; size: number }[]) =>
    ipcRenderer.send('shelf:add', files),
  clearNotices: () => ipcRenderer.send('notices:clear'),
  clearClips: () => ipcRenderer.send('clips:clear'),
  patch: (partial: Record<string, unknown>) => ipcRenderer.send('state:patch', partial),
  openSettings: (uri: string) => ipcRenderer.send('settings:open', uri),
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  openWindow: () => ipcRenderer.send('settings:window'),
  setCardHeight: (height: number) => ipcRenderer.send('card:height', height),
  onSettingsChanged: (cb: (s: unknown) => void): (() => void) => {
    const handler = (_event: unknown, s: unknown) => cb(s);
    ipcRenderer.on('settings:changed', handler);
    return () => ipcRenderer.removeListener('settings:changed', handler);
  },
  onLyricsAuto: (cb: (p: { title: string; lrc: string | null }) => void): (() => void) => {
    const handler = (_event: unknown, p: { title: string; lrc: string | null }) => cb(p);
    ipcRenderer.on('lyrics:auto-loaded', handler);
    return () => ipcRenderer.removeListener('lyrics:auto-loaded', handler);
  },
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSetting: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value),
  clipboardCopy: (text: string) => ipcRenderer.invoke('clip:copy', text),
  clipboardPaste: (text: string) => ipcRenderer.invoke('clip:paste', text),
  getExtras: () => ipcRenderer.invoke('extras:get'),
  onExtras: (cb: (s: unknown) => void): (() => void) => {
    const handler = (_event: unknown, s: unknown) => cb(s);
    ipcRenderer.on('extras:changed', handler);
    return () => ipcRenderer.removeListener('extras:changed', handler);
  },
  dismissResume: () => ipcRenderer.send('extras:dismiss-resume'),
  pauseMedia: () => ipcRenderer.send('media:pause'),
  playMedia: () => ipcRenderer.send('media:play'),
  bannerShow: (active: boolean) => ipcRenderer.send('banner:show', active),
  islandOpen: () => ipcRenderer.invoke('island:open'),
  micMuteState: () => ipcRenderer.invoke('mic:mute-state'),
  micMuteToggle: () => ipcRenderer.invoke('mic:mute-toggle'),
  camToggle: () => ipcRenderer.invoke('cam:toggle'),
  noticeReply: (app: string, body: string, text: string) => ipcRenderer.invoke('notice:reply', app, body, text),
  prevMedia: () => ipcRenderer.send('media:prev'),
  nextMedia: () => ipcRenderer.send('media:next'),
  openNotice: (app: string, body: string) => ipcRenderer.send('notice:open', app, body),
  getStats: () => ipcRenderer.invoke('stats:get'),
  cleanRam: () => ipcRenderer.invoke('ram:clean'),
  getBrightness: () => ipcRenderer.invoke('ctl:brightness'),
  setBrightness: (percent: number) => ipcRenderer.invoke('ctl:brightness-set', percent),
  volumeStep: (direction: 'up' | 'down', steps: number) =>
    ipcRenderer.send('ctl:volume', direction, steps),
  toggleMute: () => ipcRenderer.send('ctl:mute'),
  capture: (mode: string) => ipcRenderer.invoke('capture:run', mode),
  captureRecordStop: (data: ArrayBuffer) => ipcRenderer.invoke('capture:record-stop', data),
  captureRecordAbort: () => ipcRenderer.send('capture:record-abort'),
  onCaptureHotkey: (cb: (mode: string) => void): (() => void) => {
    const handler = (_event: unknown, mode: string) => cb(mode);
    ipcRenderer.on('capture:hotkey', handler);
    return () => ipcRenderer.removeListener('capture:hotkey', handler);
  },
  openCaptureFolder: () => ipcRenderer.send('capture:folder'),
  notify: (title: string, body: string) => ipcRenderer.send('notify:push', title, body),
});
