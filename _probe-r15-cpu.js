/* R15 CPU probe (fails before the spawn-churn fix).
   Drives the compiled main process with a virtual clock and counts real child
   process launches (powershell.exe) over a fixed 60 s window in two scenarios:
   idle desktop, and a browser in the foreground. Run: node _probe-r15-cpu.js */
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const cp = require('node:child_process');
const { EventEmitter } = require('node:events');

const root = __dirname;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aeolia-r15-cpu-'));
fs.writeFileSync(path.join(tmp, 'settings.json'), JSON.stringify({
  pollIntervalMs: 500, miniMode: 'clock', miniTrigger: 'busy', mini: { width: 64, height: 14 },
  pill: { width: 150, height: 36 }, open: { width: 360, height: 92 },
  meetingAuto: true, meetingMicButton: true, surface: 'Black',
}), 'utf8');

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  :: ' + detail}`);
};

/* ---- count child-process launches without launching anything ---- */
let spawnCount = 0;
const realExecFileSync = cp.execFileSync;
const realSpawn = cp.spawn;
cp.execFileSync = function (...args) { spawnCount += 1; if (/browser-tab-count/.test(String(args[1] && args[1][2]))) return '2'; return '2'; };
cp.spawn = function (...args) {
  spawnCount += 1;
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => true;
  process.nextTick(() => {
    child.stdout.emit('data', Buffer.from('diag|devices=0|sessions=0\n'));
    child.emit('close', 0);
  });
  return child;
};
process.versions.electron = '45.0.0'; // let captureSessions run its COM helper path

/* ---- virtual clock ---- */
const realSetTimeout = global.setTimeout;
const realSetInterval = global.setInterval;
const realClearInterval = global.clearInterval;
const realClearTimeout = global.clearTimeout;
const realNow = Date.now;
let now = 1700000000000;
Date.now = () => now;
const intervals = new Map();
const timeouts = new Map();
let seq = 0;
global.setInterval = (fn, ms, ...args) => { const id = ++seq; intervals.set(id, { fn, ms, args }); return id; };
global.clearInterval = (id) => { intervals.delete(id); };
global.clearTimeout = (id) => { timeouts.delete(id); };
global.setTimeout = (fn, ms, ...args) => { const id = ++seq; timeouts.set(id, { fn, ms, args }); return id; };
const tick = (ms, times = 1) => {
  for (let n = 0; n < times; n++) {
    now += ms;
    for (const [id, e] of Array.from(intervals)) if (intervals.has(id) && e.ms === ms) e.fn(...e.args);
    for (const [id, e] of Array.from(timeouts)) if (timeouts.has(id) && e.ms === ms) { timeouts.delete(id); e.fn(...e.args); }
  }
};
const sleep = (ms) => new Promise((r) => realSetTimeout(r, ms));

/* ---- electron / dependency mocks ---- */
let activeInfo = { process: 'explorer', exe: 'explorer.exe', title: '', maximized: false, fullscreen: false, hwnd: '1', rect: null };
let titles = [];
const display = { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
const electronMock = {
  app: {
    requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(),
    on: () => {}, quit: () => {}, focus: () => {}, setPath: () => {}, getPath: () => tmp, setLoginItemSettings: () => {},
  },
  BrowserWindow: class {
    constructor(o) { this.options = o || {}; this._b = { x: 0, y: 0, width: 150, height: 36 }; this.webContents = { send: () => {}, once: () => {}, on: () => {} }; }
    setBounds(b) { this._b = { ...b }; } getBounds() { return { ...this._b }; }
    setMinimumSize() {} setMaximumSize() {} setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {} setContentProtection() {}
    setIgnoreMouseEvents() {} isDestroyed() { return false; } show() {} showInactive() {} hide() {} focus() {} loadFile() {} once() {} on() {}
  },
  clipboard: { readText: () => Promise.resolve(''), writeText: () => {}, write: () => {} },
  globalShortcut: { unregisterAll: () => {}, register: () => {} },
  ipcMain: { on: () => {}, handle: () => {} },
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
  media: { readMedia: () => ({ playing: false, title: '' }) },
  power: { readPower: () => ({ percent: 80, charging: false }) },
  keys: { mediaPlayPause: () => {}, mediaPrev: () => {}, mediaNext: () => {}, sendShortcut: () => {} },
  systemControl: { brightnessRange: () => ({ supported: false, current: 0 }), setBrightness: () => false, pasteShortcut: () => {}, toggleMute: () => {}, volumeStep: () => {} },
  ramClean: { cpuPercent: () => 1, memoryInfo: () => ({ usedMb: 100, totalMb: 1000, percent: 10 }), cleanRam: () => ({ freedMb: 0, trimmed: 0, denied: 0 }) },
  capture: { registerCapture: () => {}, disposeCapture: () => {} },
  desktopGlass: { setDesktopGlass: () => {} },
  micMute: { getMicMuted: () => Promise.resolve(false), toggleMicMute: () => Promise.resolve(true) },
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

async function measure(label, processName, windowTitles) {
  activeInfo = { ...activeInfo, process: processName, exe: processName + '.exe', title: windowTitles[0] ? windowTitles[0].title : '' };
  titles = windowTitles;
  // Let the active-window module's cache and the meeting poller settle first.
  spawnCount = 0;
  for (let n = 0; n < 120; n++) {
    now += 500;
    for (const [id, e] of Array.from(intervals)) {
      if (intervals.has(id) && e.ms > 0 && now % e.ms === 0) e.fn(...e.args);
    }
    await sleep(0); // let the async capture polls settle before the next tick
  }
  await sleep(10);
  const count = spawnCount;
  console.log(`  ${label}: ${count} child processes / 60 s`);
  return count;
}

(async () => {
  // Expose the controlled foreground/window data to the real activeWindow module
  // via its own module-level dependencies: koffi is not available here, so we
  // feed main through a thin stub that still calls the REAL browserTabCount.
  const awPath = require.resolve(path.join(root, 'dist/main/activeWindow.js'));
  delete require.cache[awPath];
  const realAw = require(awPath);
  stubs.activeWindow = {
    BROWSERS: realAw.BROWSERS, browserShouldShrink: realAw.browserShouldShrink,
    isBusyProcess: realAw.isBusyProcess,
    browserTabCount: realAw.browserTabCount,
    focusProcessWindow: () => false,
    getActiveWindow: () => ({ ...activeInfo }),
    getWindowTitles: () => titles.map((t) => ({ ...t })),
  };
  // extras uses getWindowTitles from activeWindow; make it see our titles.
  require(path.join(root, 'dist/main/main.js'));
  await sleep(50);

  const idle = await measure('idle desktop', 'explorer', []);
  const browser = await measure('browser foreground', 'chrome', [{ process: 'chrome', title: 'GitHub' }]);

  check('idle desktop spawns <= 8 child processes / min', idle <= 8, String(idle));
  check('browser foreground spawns <= 20 child processes / min', browser <= 20, String(browser));
  check('spawn churn drops substantially versus the old 33-120/min baseline',
    idle <= 8 && browser <= 20, `idle=${idle} browser=${browser}`);

  cp.execFileSync = realExecFileSync;
  cp.spawn = realSpawn;
  Date.now = realNow;
  global.setInterval = realSetInterval; global.setTimeout = realSetTimeout;
  global.clearInterval = realClearInterval; global.clearTimeout = realClearTimeout;
  Module._load = originalLoad;
  const failed = results.filter((r) => !r.ok);
  console.log(`\nR15_CPU ${results.length - failed.length}/${results.length} FAILED=${failed.length}`);
  process.exit(failed.length === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
