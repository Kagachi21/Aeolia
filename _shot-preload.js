/* Temporary stub preload: feeds the card renderer a fully-populated state so
   the layout can be captured without the real main process. */
const { contextBridge } = require('electron');
const noop = () => () => {};

const status = {
  state: 'open', word: false, media: false, mediaTitle: '',
  accent: '#e9eef7', surface: 'Black', cardWidth: 360,
  visibleTabs: [],              // empty == "show every tab" (the reported case)
  hiddenUntilHover: false, openAction: 'last',
  meeting: false, miniMode: 'clock', meetingMicButton: true,
};

contextBridge.exposeInMainWorld('island', {
  onStatus: (cb) => { setTimeout(() => cb(status), 60); return () => {}; },
  onHover: noop,
  onRobotState: noop,
  pointer: () => {},
});

contextBridge.exposeInMainWorld('api', {
  getState: async () => ({
    lastTab: 'clipboard',
    sites: [],
    shelf: [],
    clips: [
      { id: 'c1', kind: 'text', text: 'https://example.com/some/copied/link?with=params', at: Date.now() - 40000 },
      { id: 'c2', kind: 'text', text: 'npm run dist:all', at: Date.now() - 600000 },
    ],
    notices: [
      { id: 'n1', app: 'Zoom', title: 'Rapat mulai', body: 'Standup dalam 2 menit', at: Date.now() - 60000 },
    ],
    tasks: [],
    waterMl: 0, waterGoalMl: 2000, waterStartHour: 8, waterEndHour: 22,
    waterEveryMin: 60, waterEnabled: false, waterSound: true, waterDay: '',
    eyeBreakMin: 0, eyeBreakSound: true, prayerCity: 'Jakarta',
  }),
  onState: noop,
  setTab() {}, openUrl() {}, addSite() {}, addShelf() {},
  clearNotices() {}, clearClips() {}, patch() {},
  openSettings() {}, pathForFile: () => '', openWindow() {}, setCardHeight() {},
  onSettingsChanged: (cb) => {
    setTimeout(() => cb({ accent: '#e9eef7', surface: 'Black', visibleTabs: [],
      barOrder: ['clock', 'cat', 'battery', 'media', 'mic'], miniOpensCard: false,
      islandStyle: 'notched', islandContent: 'clock-robot', catGreeting: false,
      worshipMode: 'prayer', worshipCountdown: true }), 20);
    return () => {};
  },
  getSettings: async () => ({ accent: '#e9eef7', surface: 'Black', cardWidth: 360,
    visibleTabs: [], barOrder: ['clock', 'cat', 'battery', 'media', 'mic'],
    islandStyle: 'notched', islandContent: 'clock-robot' }),
  setSetting: async () => ({}),
  clipboardCopy: async () => ({ ok: true }),
  clipboardPaste: async () => ({ ok: true }),
  getExtras: async () => ({ meeting: false, meetingApp: '', online: true, weather: null,
    weatherError: '', calendarEvents: [], calendarError: '', lastDownload: '', resumeOffer: false }),
  onExtras: noop, dismissResume() {}, pauseMedia() {}, playMedia() {},
  getStats: async () => ({ cpu: 12, ramUsedMb: 8200, ramTotalMb: 16384, ramPercent: 50 }),
  cleanRam: async () => ({ freedMb: 0, trimmed: 0, denied: 0 }),
  getBrightness: async () => ({ supported: true, current: 60 }),
  setBrightness: async () => ({ ok: true, current: 60 }),
  volumeStep() {}, toggleMute() {},
  capture: async () => ({ ok: true }),
  captureRecordStop: async () => ({ ok: true }),
  captureRecordAbort() {}, onCaptureHotkey: noop, openCaptureFolder() {}, notify() {},
});
