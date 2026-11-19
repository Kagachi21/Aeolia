/* Verification seam for the Aeolia runtime probes.
   Replaces the real preload so the renderer and Settings pages can be driven
   from executeJavaScript without launching the whole main process. */
const { contextBridge } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const ALL_TABS = [
  'web', 'notifications', 'shelf', 'clipboard', 'music', 'today', 'sholat',
  'timer', 'reminders', 'water', 'capture', 'controls', 'deck', 'calls',
];

let cfg = {};
try {
  cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '_probe-state.json'), 'utf8'));
} catch {
  cfg = {};
}

let status = Object.assign({
  state: 'open', word: false, media: false, mediaTitle: '',
  accent: '#6ea8ff', surface: 'Graphite', cardWidth: 360,
  visibleTabs: [...ALL_TABS], hiddenUntilHover: false, openAction: 'last',
  meeting: false, miniMode: 'clock', meetingMicButton: true,
}, cfg.status || {});

let settings = Object.assign({
  accent: '#6ea8ff', surface: 'Graphite', cardWidth: 360,
  visibleTabs: [...ALL_TABS], islandStyle: 'notched', islandContent: 'clock-robot',
  barOrder: ['clock', 'cat', 'battery', 'media', 'mic'],
  robotEyeColor: '', robotAccessory: 'none', robotEyeMovement: 'relaxed',
  robotIdleOnly: false, robotIdleAfterMs: 30000, robotBatteryExpressions: true,
  robotHoldsItems: false, catGreeting: true, catIdleCenter: true,
  miniMode: 'clock', miniTrigger: 'fullscreen',
  worshipMode: 'prayer', worshipRemind: true, worshipCountdown: true,
  worshipImsakIftar: false, worshipPauseMusic: false,
  worshipOther: [], adhanEnabled: false, adhanVolume: 70, adhanFajr: true,
  adhanFile: '', lyricsOffsetSec: 0, lyricsSpeed: 1, lyricsText: '',
  meetingAuto: false, meetingMicButton: true, meetingIgnoreApps: [],
  notifyDownloads: false, notifyInternet: false, notifyResumeMusic: false,
  calendarCountdown: true, calendarIcalUrl: '', weatherEnabled: false,
  weatherRainAlert: false, captureShortcut: 'default', captureShowIsland: false,
  captureMic: false, captureClipboard: true, captureShotDir: '', captureVideoDir: '',
}, cfg.settings || {});

let card = Object.assign({
  lastTab: 'clipboard', sites: [], shelf: [], clips: [], notices: [], tasks: [],
  waterMl: 0, waterGoalMl: 2000, waterStartHour: 8, waterEndHour: 22,
  waterEveryMin: 60, waterEnabled: false, waterSound: true, waterDay: '',
  eyeBreakMin: 0, eyeBreakSound: true, prayerCity: 'Jakarta',
}, cfg.card || {});

const extras = Object.assign({
  meeting: false, meetingApp: '', online: true, weather: null, weatherError: '',
  calendarEvents: [], calendarError: '', lastDownload: '', resumeOffer: false,
}, cfg.extras || {});

const robot = Object.assign({ idle: false, batteryPercent: 80, charging: false, cursorDx: 0 }, cfg.robot || {});

const listeners = new Map();
const calls = [];
const record = (kind, payload) => calls.push({ kind, payload });
const reg = (name, cb) => {
  if (!listeners.has(name)) listeners.set(name, []);
  listeners.get(name).push(cb);
  return () => {
    const list = listeners.get(name) || [];
    const i = list.indexOf(cb);
    if (i >= 0) list.splice(i, 1);
  };
};
const emit = (name, payload) => {
  for (const cb of (listeners.get(name) || []).slice()) cb(payload);
};

const noopReg = (name) => (cb) => reg(name, cb);

contextBridge.exposeInMainWorld('island', {
  onStatus: noopReg('status'),
  onHover: noopReg('hover'),
  onRobotState: noopReg('robot'),
  pointer: (kind, y) => record('pointer', { kind, y }),
});

contextBridge.exposeInMainWorld('api', {
  getState: async () => ({ ...card }),
  onState: noopReg('state'),
  setTab: (tab) => record('setTab', tab),
  openUrl: (url) => record('openUrl', url),
  addSite: (name, url) => record('addSite', { name, url }),
  addShelf: (files) => record('addShelf', files),
  clearNotices: () => record('clearNotices', null),
  clearClips: () => record('clearClips', null),
  patch: (partial) => record('patch', partial),
  openSettings: (uri) => record('openSettings', uri),
  pathForFile: () => '',
  openWindow: () => record('openWindow', null),
  setCardHeight: (h) => record('setCardHeight', h),
  onSettingsChanged: noopReg('settings'),
  getSettings: async () => ({ ...settings }),
  setSetting: (key, value) => {
    record('setSetting', { key, value });
    settings[key] = value;
    emit('settings', { ...settings });
    if (key === 'visibleTabs') {
      status = { ...status, visibleTabs: Array.isArray(value) ? [...value] : [] };
      emit('status', { ...status });
    }
    emit('settingsChange', { ...settings });
    return { ...settings };
  },
  clipboardCopy: (text) => { record('clipboardCopy', text); return Promise.resolve({ ok: true }); },
  clipboardPaste: (text) => { record('clipboardPaste', text); return Promise.resolve({ ok: true }); },
  getExtras: async () => ({ ...extras }),
  onExtras: noopReg('extras'),
  dismissResume: () => record('dismissResume', null),
  pauseMedia: () => record('pauseMedia', null),
  playMedia: () => record('playMedia', null),
  getStats: async () => ({ cpu: 12, ramUsedMb: 8200, ramTotalMb: 16384, ramPercent: 50 }),
  cleanRam: async () => ({ freedMb: 0, trimmed: 0, denied: 0 }),
  getBrightness: async () => ({ supported: true, current: 60 }),
  setBrightness: async () => ({ ok: true, current: 60 }),
  volumeStep: (d, s) => record('volumeStep', { d, s }),
  toggleMute: () => record('toggleMute', null),
  capture: async () => ({ ok: true }),
  captureRecordStop: async () => ({ ok: true }),
  captureRecordAbort: () => {},
  onCaptureHotkey: noopReg('captureHotkey'),
  openCaptureFolder: () => {},
  notify: (t, b) => record('notify', { t, b }),

  /* Channels the renderer subscribes to or invokes that this stub was missing.
     onLyricsAuto is called at MODULE TOP LEVEL in renderer.ts, so a missing
     stub threw "window.api.onLyricsAuto is not a function" during boot and took
     every later assertion in the UI probe down with it (8/20 instead of 20/20).
     A stub that is narrower than the real preload turns a harness gap into a
     phantom product regression, so it is kept in sync with preload.ts. */
  onLyricsAuto: noopReg('lyricsAuto'),
  onMusicColors: noopReg('musicColors'),
  onGlassFrame: noopReg('glassFrame'),
  setGlassCapture: async () => true,
  bannerShow: (active) => record('bannerShow', active),
  islandOpen: async () => { record('islandOpen', null); return { ok: true }; },
  micMuteState: async () => ({ muted: false, supported: true }),
  micMuteToggle: async () => { record('micMuteToggle', null); return { ok: true, muted: true }; },
  camToggle: async () => { record('camToggle', null); return { ok: true, focused: false, shortcut: false }; },
  noticeReply: async (app, body, text) => { record('noticeReply', { app, body, text }); return { ok: true }; },
  prevMedia: () => record('prevMedia', null),
  nextMedia: () => record('nextMedia', null),
  openNotice: (app, body) => record('openNotice', { app, body }),
});

contextBridge.exposeInMainWorld('settingsApi', {
  get: async () => ({ ...settings }),
  set: (key, value) => {
    record('settingsSet', { key, value });
    settings[key] = value;
    emit('settingsChange', { ...settings });
    return Promise.resolve({ ...settings });
  },
  close: () => record('settingsClose', null),
  pickFile: async () => '',
  pickFolder: async () => '',
  openPath: (p) => record('settingsOpenPath', p),
  extras: async () => ({ ...extras }),
  onChange: noopReg('settingsChange'),
});

contextBridge.exposeInMainWorld('probe', {
  emit: (name, payload) => {
    if (name === 'status') status = Object.assign({}, status, payload);
    if (name === 'settings') settings = Object.assign({}, settings, payload);
    if (name === 'card' || name === 'state') card = Object.assign({}, card, payload);
    const channel = name === 'card' ? 'state' : name;
    emit(channel, channel === 'status' ? { ...status }
      : channel === 'settings' || channel === 'settingsChange' ? { ...settings }
        : channel === 'state' ? { ...card }
          : payload);
    return true;
  },
  calls: () => calls.map((c) => ({ ...c })),
  clear: () => { calls.length = 0; },
  data: () => ({ status: { ...status }, settings: { ...settings }, card: { ...card } }),
});

/* Initial paint, mirroring the main process's did-finish-load broadcast. */
setTimeout(() => {
  emit('status', { ...status });
  emit('settings', { ...settings });
  emit('state', { ...card });
  emit('extras', { ...extras });
  emit('robot', { ...robot });
  emit('settingsChange', { ...settings });
}, 30);
