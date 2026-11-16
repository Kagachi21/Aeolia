/* Main-process runtime probe.
   Runs the compiled dist/main/main.js against a mocked electron surface so the
   real Island, bounds, settings and store modules execute. Assertions cover:
     - notched geometry and live reposition
     - click-through across open/close cycles while mini
     - clipboard text never leaking into notifications
     - robot idle debounce and a clean timer teardown
   Run with: electron.exe _probe-main.js
*/
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const entry = path.join(__dirname, 'dist', 'main', 'main.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aeolia-main-probe-'));

let activeInfo = {
  process: 'explorer', exe: '', title: '', maximized: false, fullscreen: false,
  rect: { x: 0, y: 0, width: 1920, height: 1080 },
};
let idleSeconds = 0;
let clipText = '';
const cursor = { x: 10, y: 500 };

const sent = [];
const ignoreCalls = [];
const boundsCalls = [];
const pasteCalls = [];
const clipboardWrites = [];
const windows = [];
const hotkeys = new Map();
const ipcOn = new Map();
const ipcHandle = new Map();
const intervals = new Map();
let intervalSeq = 0;

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok), detail: detail === undefined ? '' : String(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  :: ' + detail}`);
};

class FakeWebContents {
  constructor() { this.sent = sent; }
  send(channel, payload) { sent.push({ channel, payload }); }
  once() {}
  on() {}
  executeJavaScript() { return Promise.resolve(null); }
}

class FakeBrowserWindow {
  constructor(options) {
    this.options = options || {};
    this._bounds = {
      x: Math.round(this.options.x ?? 0),
      y: Math.round(this.options.y ?? 0),
      width: Math.round(this.options.width ?? 100),
      height: Math.round(this.options.height ?? 30),
    };
    this.webContents = new FakeWebContents();
    this.destroyed = false;
    windows.push(this);
  }
  setMinimumSize() {}
  setMaximumSize() {}
  setAlwaysOnTop() {}
  setVisibleOnAllWorkspaces() {}
  setContentProtection() {}
  setBounds(b) { this._bounds = { ...b }; boundsCalls.push({ ...b }); }
  getBounds() { return { ...this._bounds }; }
  setSize(w, h) { this._bounds.width = w; this._bounds.height = h; }
  setIgnoreMouseEvents(on, opts) { ignoreCalls.push({ on, opts }); }
  isDestroyed() { return this.destroyed; }
  show() {}
  showInactive() {}
  hide() {}
  focus() {}
  close() { this.destroyed = true; }
  loadFile() {}
  once() {}
  on() {}
}

const electronMock = {
  app: {
    requestSingleInstanceLock: () => true,
    on: () => {},
    quit: () => {},
    focus: () => {},
    whenReady: () => Promise.resolve(),
    setPath: () => {},
    getPath: (name) => (name === 'exe' ? path.join(tmp, 'Aeolia Island.exe') : tmp),
    setLoginItemSettings: () => {},
  },
  BrowserWindow: FakeBrowserWindow,
  clipboard: {
    readText: () => Promise.resolve(clipText),
    writeText: (t) => { clipboardWrites.push(t); },
    write: () => Promise.resolve(),
  },
  globalShortcut: {
    unregisterAll: () => hotkeys.clear(),
    register: (accel, fn) => { hotkeys.set(accel, fn); },
  },
  ipcMain: {
    on: (channel, fn) => ipcOn.set(channel, fn),
    handle: (channel, fn) => ipcHandle.set(channel, fn),
  },
  powerMonitor: {
    getSystemIdleTime: () => idleSeconds,
    on: () => {},
  },
  screen: {
    getPrimaryDisplay: () => ({
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    }),
    getDisplayNearestPoint: () => ({
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    }),
    getCursorScreenPoint: () => ({ ...cursor }),
  },
  shell: { openExternal: () => {}, openPath: () => Promise.resolve('') },
  dialog: { showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }) },
  net: { fetch: () => Promise.reject(new Error('offline in probe')) },
  desktopCapturer: { getSources: () => Promise.resolve([]) },
  session: { fromPartition: () => ({}) },
  ClipboardItem: class {},
};

const stubs = {
  activeWindow: {
    getActiveWindow: () => ({ ...activeInfo }),
    isBusyProcess: () => false, BROWSERS: new Set(), browserShouldShrink: () => false, browserTabCount: () => 0,
  },
  thinFrame: { dropThickFrame: () => {} },
  media: { readMedia: () => ({ playing: false, title: '' }) },
  power: { readPower: () => ({ percent: 80, charging: false }) },
  keys: { mediaPlayPause: () => {} },
  systemControl: {
    brightnessRange: () => ({ supported: false, min: 0, max: 100, current: 0 }),
    setBrightness: () => false,
    pasteShortcut: () => pasteCalls.push(true),
    toggleMute: () => {},
    volumeStep: () => {},
  },
  ramClean: {
    cpuPercent: () => 12,
    memoryInfo: () => ({ usedMb: 8192, totalMb: 16384, percent: 50 }),
    cleanRam: () => ({ freedMb: 0, trimmed: 0, denied: 0 }),
  },
  capture: { registerCapture: () => {}, disposeCapture: () => {} },
  extras: {
    disposeExtras: () => {},
    getExtras: () => ({
      meeting: false, meetingApp: '', online: true, weather: null, weatherError: '',
      calendarEvents: [], calendarError: '', lastDownload: '', resumeOffer: false,
    }),
    isMeeting: () => false,
    openPath: () => {},
    pickFile: () => Promise.resolve(''),
    pickFolder: () => Promise.resolve(''),
    registerExtras: () => {},
    shouldHoldNotice: () => false,
    dismissResumeOffer: () => {},
  },
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

const originalSetInterval = global.setInterval;
const originalClearInterval = global.clearInterval;
global.setInterval = (fn, ms, ...args) => {
  const id = ++intervalSeq;
  intervals.set(id, { fn, ms, args });
  return id;
};
global.clearInterval = (id) => { intervals.delete(id); };

const tick = (name) => {
  let out = null;
  for (const { fn } of intervals.values()) if (fn.name === name) out = fn();
  return out;
};
const tickMs = (ms, name) => {
  let out = null;
  for (const entry of intervals.values()) {
    if (entry.ms === ms && (!name || entry.fn.name === name)) out = entry.fn();
  }
  return out;
};
const invoke = (channel, ...args) => {
  const fn = ipcHandle.get(channel);
  if (!fn) throw new Error('no ipcMain.handle for ' + channel);
  return fn(null, ...args);
};
const send = (channel, ...args) => {
  const fn = ipcOn.get(channel);
  if (!fn) throw new Error('no ipcMain.on for ' + channel);
  return fn(null, ...args);
};
const lastIgnore = () => (ignoreCalls.length ? ignoreCalls[ignoreCalls.length - 1].on : null);
const robotStates = () => sent.filter((m) => m.channel === 'robot:state').map((m) => m.payload);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  require(entry);
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setTimeout(r, 30));

  check('main process booted and registered IPC handlers',
    ipcHandle.has('settings:set') && ipcHandle.has('clip:copy') && ipcHandle.has('clip:paste'),
    `handlers=${[...ipcHandle.keys()].length}`);

  /* ---- Bug 1: notched must sit flush to the top edge, live ---- */
  const startY = windows[0].getBounds().y;
  check('dynamic pill keeps the floating edgeMargin', startY === 4, `y=${startY}`);

  await invoke('settings:set', 'islandStyle', 'notched');
  const notchedY = windows[0].getBounds().y;
  check('switching to Notched repositions the window to y=0', notchedY === 0, `y=${notchedY}`);

  await invoke('settings:set', 'islandStyle', 'dynamic');
  const backY = windows[0].getBounds().y;
  check('switching back to Dynamic restores the gap', backY === 4, `y=${backY}`);

  await invoke('settings:set', 'edgeMargin', 12);
  const marginY = windows[0].getBounds().y;
  check('edgeMargin change repositions the window', marginY === 12, `y=${marginY}`);
  await invoke('settings:set', 'edgeMargin', 4);

  /* ---- Bug 2: mini click-through must survive an open/close cycle ---- */
  activeInfo = { ...activeInfo, fullscreen: true };
  tick('pollActiveWindow');
  await new Promise((r) => setTimeout(r, 30));
  check('entering mini enables click-through', lastIgnore() === true,
    `lastIgnore=${lastIgnore()}, calls=${JSON.stringify(ignoreCalls)}`);

  const openHotkey = hotkeys.get('Ctrl+Alt+N');
  check('open hotkey is registered', typeof openHotkey === 'function');
  openHotkey();
  check('opening the card disables click-through so controls work', lastIgnore() === false,
    `lastIgnore=${lastIgnore()}`);

  send('island:pointer', 'leave');
  openHotkey();
  check('closing the card back to mini re-enables click-through (no pointer event)',
    lastIgnore() === true, `lastIgnore=${lastIgnore()}, calls=${JSON.stringify(ignoreCalls)}`);

  activeInfo = { ...activeInfo, fullscreen: false };
  tick('pollActiveWindow');
  check('returning to pill disables click-through', lastIgnore() === false,
    `lastIgnore=${lastIgnore()}`);
  activeInfo = { ...activeInfo, fullscreen: true };
  tick('pollActiveWindow');
  check('re-entering mini enables click-through again', lastIgnore() === true,
    `lastIgnore=${lastIgnore()}`);

  /* ---- Bug 4: copied text goes to clips only, never to notices ---- */
  const before = await invoke('state:get');
  const noticesBefore = before.notices.length;
  clipText = 'AEOLIA-PROBE-CLIP-42';
  await tickMs(900);
  await new Promise((r) => setTimeout(r, 20));
  const afterClip = await invoke('state:get');
  check('copying text adds exactly one Clipboard entry',
    afterClip.clips.length === 1 && afterClip.clips[0].text === clipText,
    JSON.stringify(afterClip.clips));
  check('copying text does NOT create a Notification',
    afterClip.notices.length === noticesBefore,
    `before=${noticesBefore} after=${afterClip.notices.length}`);

  const copyResult = await invoke('clip:copy', 'AEOLIA-COPY-BACK');
  check('clip:copy writes the text back to the clipboard',
    copyResult.ok === true && clipboardWrites.includes('AEOLIA-COPY-BACK'),
    JSON.stringify(clipboardWrites));
  const pasteResult = await invoke('clip:paste', 'AEOLIA-PASTE-BACK');
  check('clip:paste writes the text and fires the real Ctrl+V shortcut',
    pasteResult.ok === true && clipboardWrites.includes('AEOLIA-PASTE-BACK') && pasteCalls.length > 0,
    `pasteCalls=${pasteCalls.length}`);

  /* ---- Bug 5: idle must be debounced and the timer teardown must not jump ---- */
  sent.length = 0;
  idleSeconds = 60;
  tick('pollRobot');
  const firstIdle = robotStates().map((s) => s.idle);
  check('a single idle sample does not flip the cat position',
    firstIdle.length === 0 || firstIdle[firstIdle.length - 1] === false,
    JSON.stringify(robotStates()));

  for (let i = 0; i < 3; i++) tick('pollRobot');
  idleSeconds = 0;
  tick('pollRobot');
  idleSeconds = 60;
  tick('pollRobot');
  const flapping = robotStates().map((s) => s.idle);
  check('flapping around the idle threshold emits no idle:true',
    flapping.every((v) => v === false), JSON.stringify(flapping));

  for (let i = 0; i < 20; i++) tick('pollRobot');
  const stableIdle = robotStates().map((s) => s.idle);
  check('sustained idle eventually reports idle exactly once',
    stableIdle.filter(Boolean).length === 1 && stableIdle[stableIdle.length - 1] === true,
    JSON.stringify(stableIdle));

  await invoke('settings:set', 'robotIdleOnly', false);
  await invoke('settings:set', 'robotBatteryExpressions', false);
  await invoke('settings:set', 'robotEyeMovement', 'relaxed');
  sent.length = 0;
  await invoke('settings:set', 'catIdleCenter', false);
  const teardown = robotStates();
  check('disabling the robot timer publishes no synthetic idle state (no cat jump)',
    teardown.length === 0, JSON.stringify(teardown));

  sent.length = 0;
  await invoke('settings:set', 'robotIdleOnly', true);
  check('an idle-driven setting change republishes one robot state',
    robotStates().length === 1, JSON.stringify(robotStates()));

  const failed = results.filter((r) => !r.ok);
  console.log(`\nPROBE_MAIN ${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) console.log('FAILED: ' + failed.map((f) => f.name).join(' | '));
  global.setInterval = originalSetInterval;
  global.clearInterval = originalClearInterval;
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('PROBE_MAIN ERROR', err);
  process.exit(2);
});
