/* R15 VIDEO probe (fails before mediaMiniBehavior is implemented).
   Drives the compiled main process with a virtual clock and checks the island
   base state / mediaHidden flag for mediaMiniBehavior keep|mini|hide, while
   preserving the fullscreen priority. Run: node _probe-r15-video.js */
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const root = __dirname;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aeolia-r15-video-'));
fs.writeFileSync(path.join(tmp, 'settings.json'), JSON.stringify({
  pollIntervalMs: 500, miniMode: 'clock', miniTrigger: 'busy', mediaMiniBehavior: 'keep',
  mini: { width: 64, height: 14 }, pill: { width: 150, height: 36 }, open: { width: 360, height: 92 },
}), 'utf8');
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  :: ' + detail}`);
};

const realSetTimeout = global.setTimeout;
const realSetInterval = global.setInterval;
const realClearInterval = global.clearInterval;
const realClearTimeout = global.clearTimeout;
const realNow = Date.now;
let now = 1700000000000;
Date.now = () => now;
const intervals = new Map();
let seq = 0;
global.setInterval = (fn, ms, ...args) => { const id = ++seq; intervals.set(id, { fn, ms, args }); return id; };
global.clearInterval = (id) => { intervals.delete(id); };
global.setTimeout = (fn, ms, ...args) => { const id = ++seq; intervals.set(id, { fn, ms, args, once: true }); return id; };
global.clearTimeout = (id) => { intervals.delete(id); };
const runByName = (name) => {
  for (const [id, e] of Array.from(intervals)) if (intervals.has(id) && e.fn.name === name) e.fn(...e.args);
};
const tickPoll = () => {
  now += 500;
  for (const [id, e] of Array.from(intervals)) {
    if (intervals.has(id) && e.ms === 500 && e.fn.name === 'pollActiveWindow') e.fn(...e.args);
  }
};
const sleep = (ms) => new Promise((r) => realSetTimeout(r, ms));

let playing = false;
let fullscreen = false;
const sent = [];
const ipcHandle = new Map();
const display = { bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
const electronMock = {
  app: {
    requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(),
    on: () => {}, quit: () => {}, focus: () => {}, setPath: () => {}, getPath: () => tmp, setLoginItemSettings: () => {},
  },
  BrowserWindow: class {
    constructor() { this.webContents = { send: (ch, p) => sent.push({ ch, p }), once: () => {}, on: () => {} }; }
    setBounds() {} getBounds() { return { x: 0, y: 4, width: 150, height: 36 }; }
    setMinimumSize() {} setMaximumSize() {} setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {}
    setContentProtection() {} setIgnoreMouseEvents() {} isDestroyed() { return false; }
    show() {} showInactive() {} hide() {} focus() {} loadFile() {} once() {} on() {}
  },
  clipboard: { readText: () => Promise.resolve(''), writeText: () => {} },
  globalShortcut: { unregisterAll: () => {}, register: () => {} },
  ipcMain: { on: () => {}, handle: (c, fn) => ipcHandle.set(c, fn) },
  powerMonitor: { getSystemIdleTime: () => 0, on: () => {} },
  screen: { getPrimaryDisplay: () => display, getDisplayNearestPoint: () => display, getCursorScreenPoint: () => ({ x: 960, y: 5 }) },
  shell: { openExternal: () => {}, openPath: () => Promise.resolve('') },
  dialog: { showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }) },
  net: { fetch: () => Promise.reject(new Error('offline')) },
  desktopCapturer: { getSources: () => Promise.resolve([]) },
  session: { fromPartition: () => ({}) },
};
const stubs = {
  thinFrame: { dropThickFrame: () => {} },
  activeWindow: {
    BROWSERS: new Set(['chrome']), browserShouldShrink: (p, t, fs, tabs) => fs || tabs >= 8,
    isBusyProcess: () => false, browserTabCount: () => 12, focusProcessWindow: () => false,
    getActiveWindow: () => ({ process: 'chrome', title: '12 tabs', fullscreen, maximized: !fullscreen, hwnd: '1' }),
    getWindowTitles: () => [],
  },
  media: { readMedia: () => ({ playing, title: playing ? 'Track' : '' }) },
  power: { readPower: () => ({ percent: 80, charging: false }) },
  keys: { mediaPlayPause: () => {}, mediaPrev: () => {}, mediaNext: () => {}, sendShortcut: () => true },
  systemControl: { brightnessRange: () => ({ supported: false, current: 0 }), setBrightness: () => false, pasteShortcut: () => {}, toggleMute: () => {}, volumeStep: () => {} },
  ramClean: { cpuPercent: () => 1, memoryInfo: () => ({ usedMb: 1, totalMb: 2, percent: 1 }), cleanRam: () => ({ freedMb: 0, trimmed: 0 }) },
  capture: { registerCapture: () => {}, disposeCapture: () => {} },
  desktopGlass: { setDesktopGlass: () => {} },
  extras: {
    disposeExtras: () => {}, getExtras: () => ({ meeting: false, meetingApp: '', online: true, weather: null, weatherError: '', calendarEvents: [], calendarError: '', lastDownload: '', resumeOffer: false }),
    isMeeting: () => false, openPath: () => {}, pickFile: () => Promise.resolve(''), pickFolder: () => Promise.resolve(''),
    registerExtras: () => {}, dismissResumeOffer: () => {},
  },
  micMute: { getMicMuted: () => Promise.resolve(false), toggleMicMute: () => Promise.resolve(false), lastMicError: () => null },
  cameraPrivacy: { toggleWebcamConsent: () => Promise.resolve({ ok: false, verified: false, enabled: null, code: 'privacy-unverified', hint: '' }) },
  lyrics: { fetchLyrics: () => Promise.resolve(null) },
  musicColors: { fetchTrackColors: () => Promise.resolve(null), toDeepPalette: () => null },
  noticeLaunch: { open: () => Promise.resolve({}), reply: () => Promise.resolve({}) },
};
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronMock;
  if (typeof request === 'string' && request.startsWith('./')) {
    const key = path.basename(request, '.js');
    if (Object.prototype.hasOwnProperty.call(stubs, key)) return stubs[key];
  }
  return originalLoad.call(this, request, parent, isMain);
};

const statusFor = () => {
  for (let i = sent.length - 1; i >= 0; i--) if (sent[i].ch === 'island:update') return sent[i].p;
  return null;
};

(async () => {
  require(path.join(root, 'dist/main/main.js'));
  await sleep(40);
  const setSetting = (key, value) => ipcHandle.get('settings:set')(null, key, value);

  // Baseline: a crowded browser already shrinks the island. Turn media OFF.
  playing = false; fullscreen = false;
  await setSetting('mediaMiniBehavior', 'keep');
  tickPoll(); await sleep(5);
  check('baseline: crowded browser shrinks without media', statusFor()?.state === 'mini', JSON.stringify({ state: statusFor()?.state }));

  // keep: media keeps the full pill, exactly like the current build.
  playing = true; runByName('pollMedia');
  await setSetting('mediaMiniBehavior', 'keep');
  tickPoll(); await sleep(5);
  const keep = statusFor();
  check('mediaMiniBehavior keep: media keeps the full pill', keep?.state === 'pill' && keep?.mediaHidden !== true,
    JSON.stringify({ state: keep?.state, mediaHidden: keep?.mediaHidden }));

  // mini: media shrinks to the notch, no full hide.
  await setSetting('mediaMiniBehavior', 'mini');
  tickPoll(); await sleep(5);
  const mini = statusFor();
  check('mediaMiniBehavior mini: media shrinks to the notch', mini?.state === 'mini' && mini?.mediaHidden !== true,
    JSON.stringify({ state: mini?.state, mediaHidden: mini?.mediaHidden }));

  // hide: media shrinks AND publishes a hidden flag for the renderer.
  await setSetting('mediaMiniBehavior', 'hide');
  tickPoll(); await sleep(5);
  const hide = statusFor();
  check('mediaMiniBehavior hide: media hides (flag set)', hide?.state === 'mini' && hide?.mediaHidden === true,
    JSON.stringify({ state: hide?.state, mediaHidden: hide?.mediaHidden }));

  // Fullscreen priority: even keep must shrink while a fullscreen app is up.
  await setSetting('mediaMiniBehavior', 'keep');
  fullscreen = true;
  tickPoll(); await sleep(5);
  const fullscreenStatus = statusFor();
  check('fullscreen keeps priority over media behaviour', fullscreenStatus?.state === 'mini' && fullscreenStatus?.mediaHidden !== true,
    JSON.stringify({ state: fullscreenStatus?.state, mediaHidden: fullscreenStatus?.mediaHidden }));

  const mainSrc = fs.readFileSync(path.join(root, 'src/main/main.ts'), 'utf8');
  const uiSrc = fs.readFileSync(path.join(root, 'src/settings/settings.ts'), 'utf8');
  check('setting is persisted and validated', /mediaMiniBehavior/.test(fs.readFileSync(path.join(root, 'src/main/settings.ts'), 'utf8')));
  check('hide decision uses mediaMiniBehavior', /mediaMiniBehavior/.test(mainSrc) && /mediaHidden/.test(mainSrc));
  check('Settings UI offers keep / mini / hide', /mediaMiniBehavior/.test(uiSrc) && /Sembunyi/.test(uiSrc) && /Biarkan/.test(uiSrc));

  Module._load = originalLoad;
  Date.now = realNow;
  global.setInterval = realSetInterval; global.setTimeout = realSetTimeout;
  global.clearInterval = realClearInterval; global.clearTimeout = realClearTimeout;
  const failed = results.filter((r) => !r.ok);
  console.log(`\nR15_VIDEO ${results.length - failed.length}/${results.length} FAILED=${failed.length}`);
  process.exit(failed.length === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
