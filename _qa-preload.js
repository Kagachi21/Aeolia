/* QA Yan - verification preload seam (NOT part of the product).
   Drives the compiled renderer/settings pages from executeJavaScript.
   Extra vs Kou's seam: injectable clipboard success/failure so the
   Tersalin / Ditempel / Gagal branches can actually be exercised.
*/
const { contextBridge } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const ALL_TABS = [
  'web', 'notifications', 'shelf', 'clipboard', 'music', 'today', 'sholat',
  'timer', 'reminders', 'water', 'capture', 'controls', 'deck', 'calls',
];

let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '_qa-state.json'), 'utf8')); }
catch { cfg = {}; }

let status = Object.assign({
  state: 'open', word: false, media: false, mediaTitle: '',
  accent: '#e9eef7', surface: 'Black', cardWidth: 360,
  visibleTabs: [...ALL_TABS], hiddenUntilHover: false, openAction: 'last',
  meeting: false, miniMode: 'clock', meetingMicButton: true,
}, cfg.status || {});

let settings = Object.assign({
  accent: '#e9eef7', surface: 'Black', cardWidth: 360,
  visibleTabs: [...ALL_TABS], islandStyle: 'dynamic', islandContent: 'clock-robot',
  barOrder: ['clock', 'cat', 'battery', 'media', 'mic'],
  robotEyeColor: '', robotAccessory: 'none', robotEyeMovement: 'relaxed',
  robotIdleOnly: false, robotIdleAfterMs: 30000, robotBatteryExpressions: true,
  robotHoldsItems: false, catGreeting: true, catIdleCenter: true,
  miniMode: 'clock', miniTrigger: 'fullscreen', miniOpensCard: false,
  worshipMode: 'prayer', worshipRemind: true, worshipCountdown: true,
  worshipImsakIftar: false, worshipPauseMusic: false,
  worshipOther: [], adhanEnabled: false, adhanVolume: 70, adhanFajr: true,
  adhanFile: '', lyricsOffsetSec: 0, lyricsSpeed: 1, lyricsText: '',
  meetingAuto: false, meetingMicButton: true, meetingIgnoreApps: [],
  notifyDownloads: false, notifyInternet: false, notifyResumeMusic: false,
  calendarCountdown: true, calendarIcalUrl: '', weatherEnabled: false,
  weatherRainAlert: false, captureShortcut: 'default', captureShowIsland: false,
  captureMic: false, captureClipboard: true, captureShotDir: '', captureVideoDir: '',
  edgeMargin: 4, islandPosition: 'center', monitor: 'main', hiddenUntilHover: false,
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
  return () => { const l = listeners.get(name) || []; const i = l.indexOf(cb); if (i >= 0) l.splice(i, 1); };
};
const emit = (name, payload) => { for (const cb of (listeners.get(name) || []).slice()) cb(payload); };
const noopReg = (name) => (cb) => reg(name, cb);

const flags = { failCopy: false, failPaste: false, throwCopy: false, throwPaste: false };

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
  clipboardCopy: (text) => {
    record('clipboardCopy', text);
    if (flags.throwCopy) return Promise.reject(new Error('injected failure'));
    return Promise.resolve({ ok: !flags.failCopy });
  },
  clipboardPaste: (text) => {
    record('clipboardPaste', text);
    if (flags.throwPaste) return Promise.reject(new Error('injected failure'));
    return Promise.resolve({ ok: !flags.failPaste });
  },
  getExtras: async () => ({ ...extras }),
  onExtras: noopReg('extras'),
  dismissResume: () => record('dismissResume', null),
  pauseMedia: () => record('pauseMedia', null),
  playMedia: () => record('playMedia', null),
  bannerShow: (active) => record('bannerShow', active),
  noticeReply: async (app, body, text) => {
    record('noticeReply', { app, body, text });
    return { opened: true };
  },
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
  flags: (next) => Object.assign(flags, next),
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
