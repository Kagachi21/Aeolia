/* QA Yan - main-process runtime probe (independent design).
   Runs the COMPILED dist/main/main.js against a mocked electron surface with a
   fully virtual clock, so state machines, animations and hysteresis can be
   stepped deterministically. No product source is modified, no user data is
   touched (temp userData only). Run: node _qa-main.js
*/
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const entry = path.join(__dirname, 'dist', 'main', 'main.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aeolia-qa-main-'));

/* ---- seed user data: 23 historic notices (17 clipboard-style), no clips ---- */
const notices = [];
for (let i = 0; i < 17; i++) {
  notices.push({ id: 'clip-' + i, app: 'Clipboard', title: 'Teks disalin', body: 'legacy ' + i, at: 1700000000000 + i });
}
for (let i = 0; i < 6; i++) {
  notices.push({ id: 'app-' + i, app: i % 2 ? 'Pengingat' : 'Memory', title: 'Notifikasi asli ' + i, body: 'body', at: 1700000000100 + i });
}
fs.writeFileSync(path.join(tmp, 'state.json'), JSON.stringify({
  lastTab: 'web', sites: [], shelf: [], clips: [], notices, tasks: [],
}, null, 2), 'utf8');
fs.writeFileSync(path.join(tmp, 'settings.json'), JSON.stringify({
  islandStyle: 'dynamic', edgeMargin: 4, monitor: 'main', islandPosition: 'center',
  animationMs: 250, pollIntervalMs: 500, openDelayMs: 333, openDelayBusyMs: 444,
  hoverIdleResetMs: 55, miniMode: 'clock', miniTrigger: 'fullscreen',
  hiddenUntilHover: false, cardWidth: 360, visibleTabs: ['web', 'clipboard'],
  robotIdleOnly: true, robotBatteryExpressions: true, robotEyeMovement: 'relaxed',
  catIdleCenter: true, robotIdleAfterMs: 30000,
}, null, 2), 'utf8');

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  :: ' + detail}`);
};

/* ------------------------------------------------------------------ state */
let primaryY = 0;
let nearestY = 120;
const cursor = { x: 960, y: 5 };
let activeInfo = {
  process: 'explorer', exe: 'explorer.exe', title: 'QA', maximized: false, fullscreen: false,
  rect: { x: 0, y: 0, width: 1920, height: 1080 },
};
let busyProcess = false;
let idleSeconds = 0;
let clipText = '';
let meetingNow = false;

const sent = [];
const ignoreCalls = [];
const boundsCalls = [];
const clipboardWrites = [];
const pasteCalls = [];
const windows = [];
const hotkeys = new Map();
const ipcOn = new Map();
const ipcHandle = new Map();
let extrasCallbacks = null;
let holdNotice = false;

/* --------------------------------------------------------- virtual clock */
const realSetTimeout = global.setTimeout;
const realSetInterval = global.setInterval;
const realClearInterval = global.clearInterval;
const realClearTimeout = global.clearTimeout;
const realDateNow = Date.now;
let virtualNow = 1700000000000;
Date.now = () => virtualNow;
const intervals = new Map();
const timeouts = new Map();
let seq = 0;
global.setInterval = (fn, ms, ...args) => { const id = ++seq; intervals.set(id, { fn, ms, args }); return id; };
global.clearInterval = (id) => { intervals.delete(id); };
global.setTimeout = (fn, ms, ...args) => { const id = ++seq; timeouts.set(id, { fn, ms, args }); return id; };
global.clearTimeout = (id) => { timeouts.delete(id); };

const tickInterval = (ms, times = 1) => {
  for (let n = 0; n < times; n++) {
    virtualNow += ms;
    for (const [id, e] of Array.from(intervals)) {
      if (e.ms === ms && intervals.has(id)) e.fn(...e.args);
    }
  }
};
const tickByName = (name, times = 1) => {
  for (let n = 0; n < times; n++) {
    for (const [id, e] of Array.from(intervals)) {
      if (e.fn.name === name && intervals.has(id)) e.fn(...e.args);
    }
  }
};
const fireTimeouts = (ms) => {
  const fired = [];
  for (const [id, e] of Array.from(timeouts)) {
    if ((ms === undefined || e.ms === ms) && timeouts.has(id)) {
      timeouts.delete(id);
      e.fn(...e.args);
      fired.push(e.ms);
    }
  }
  return fired;
};
const pendingTimeouts = () => Array.from(timeouts.values()).map((e) => e.ms);
const countIntervals = (ms) => Array.from(intervals.values()).filter((e) => e.ms === ms).length;
const sleep = (ms) => new Promise((r) => realSetTimeout(r, ms));

/* ------------------------------------------------------------ electron mock */
class FakeWebContents {
  send(channel, payload) { sent.push({ channel, payload }); }
  once() {}
  on() {}
  executeJavaScript() { return Promise.resolve(null); }
}
class FakeBrowserWindow {
  constructor(options) {
    this.options = options || {};
    this._bounds = {
      x: Math.round(this.options.x ?? 0), y: Math.round(this.options.y ?? 0),
      width: Math.round(this.options.width ?? 100), height: Math.round(this.options.height ?? 30),
    };
    this.webContents = new FakeWebContents();
    this.destroyed = false;
    windows.push(this);
  }
  setMinimumSize() {} setMaximumSize() {} setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {}
  setContentProtection() {}
  setBounds(b) { this._bounds = { ...b }; boundsCalls.push({ ...b }); }
  getBounds() { return { ...this._bounds }; }
  setSize(w, h) { this._bounds.width = w; this._bounds.height = h; }
  setIgnoreMouseEvents(on, opts) { ignoreCalls.push({ on, opts }); }
  isDestroyed() { return this.destroyed; }
  show() {} showInactive() {} hide() {} focus() {} loadFile() {}
  close() { this.destroyed = true; }
  once() {} on() {}
}
const electronMock = {
  app: {
    requestSingleInstanceLock: () => true,
    on: () => {}, quit: () => {}, focus: () => {},
    whenReady: () => Promise.resolve(),
    setPath: () => {},
    getPath: (name) => (name === 'exe' ? path.join(tmp, 'Aeolia Island.exe') : tmp),
    setLoginItemSettings: () => {},
  },
  BrowserWindow: FakeBrowserWindow,
  clipboard: {
    readText: () => Promise.resolve(clipText),
    writeText: (t) => { clipboardWrites.push(t); clipText = t; },
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
  powerMonitor: { getSystemIdleTime: () => idleSeconds, on: () => {} },
  screen: {
    getPrimaryDisplay: () => ({
      bounds: { x: 0, y: primaryY, width: 1920, height: 1080 },
      workArea: { x: 0, y: primaryY, width: 1920, height: 1040 },
    }),
    getDisplayNearestPoint: () => ({
      bounds: { x: 0, y: nearestY, width: 1600, height: 900 },
      workArea: { x: 0, y: nearestY, width: 1600, height: 860 },
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
  activeWindow: { getActiveWindow: () => ({ ...activeInfo }), isBusyProcess: () => busyProcess, BROWSERS: new Set(), browserShouldShrink: () => false, browserTabCount: () => 0 },
  thinFrame: { dropThickFrame: () => {} },
  media: { readMedia: () => ({ playing: false, title: '' }) },
  power: { readPower: () => ({ percent: 80, charging: false }) },
  keys: { mediaPlayPause: () => {} },
  systemControl: {
    brightnessRange: () => ({ supported: false, min: 0, max: 100, current: 0 }),
    setBrightness: () => false,
    pasteShortcut: () => pasteCalls.push(true),
    toggleMute: () => {}, volumeStep: () => {},
  },
  ramClean: {
    cpuPercent: () => 12,
    memoryInfo: () => ({ usedMb: 8192, totalMb: 16384, percent: 50 }),
    cleanRam: () => ({ freedMb: 1, trimmed: 2, denied: 0 }),
  },
  capture: { registerCapture: () => {}, disposeCapture: () => {} },
  extras: {
    disposeExtras: () => {},
    getExtras: () => ({ meeting: false, meetingApp: '', online: true, weather: null, weatherError: '',
      calendarEvents: [], calendarError: '', lastDownload: '', resumeOffer: false }),
    isMeeting: () => meetingNow, openPath: () => {},
    pickFile: () => Promise.resolve(''), pickFolder: () => Promise.resolve(''),
    registerExtras: (cb) => { extrasCallbacks = cb; },
    shouldHoldNotice: () => holdNotice,
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

/* ------------------------------------------------------------- helpers */
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
const effectiveIgnore = () => (ignoreCalls.length ? ignoreCalls[ignoreCalls.length - 1].on : false);
const y = () => windows[0].getBounds().y;
const lastStatus = () => {
  for (let i = sent.length - 1; i >= 0; i--) if (sent[i].channel === 'island:update') return sent[i].payload;
  return null;
};
const robotStates = () => sent.filter((m) => m.channel === 'robot:state').map((m) => m.payload);
const clearSent = () => { sent.length = 0; };
const openHotkey = () => hotkeys.get('Ctrl+Alt+N');
/* Drive the 16 ms island animation to completion on every transition so the
   measured bounds are the REAL settled bounds, not a mid-frame value. */
const settle = () => tickInterval(16, 30);
const toggleCard = () => { openHotkey()(); settle(); };
const setFullscreen = (on) => {
  activeInfo = { ...activeInfo, fullscreen: on };
  tickByName('pollActiveWindow', 1);
  settle();
};

async function main() {
  require(entry);
  await sleep(40);
  check('main process booted, IPC handlers registered and initial window placed',
    !!windows[0] && ipcHandle.has('settings:set') && ipcHandle.has('clip:copy')
      && ipcHandle.has('clip:paste') && ipcHandle.has('state:get'),
    `windows=${windows.length} handlers=${ipcHandle.size}`);

  /* =================================================== BUG 1: notched geometry */
  check('dynamic pill starts at y = display.y + edgeMargin', y() === primaryY + 4, `y=${y()}`);
  for (const margin of [0, 4, 12, 40]) {
    await invoke('settings:set', 'edgeMargin', margin);
    await invoke('settings:set', 'islandStyle', 'dynamic');
    const dynamicY = y();
    await invoke('settings:set', 'islandStyle', 'notched');
    const notchedY = y();
    check(`Bug1 dynamic edgeMargin=${margin} -> y=${primaryY + margin}; notched -> y=${primaryY}`,
      dynamicY === primaryY + margin && notchedY === primaryY,
      `dynamic=${dynamicY} notched=${notchedY}`);
  }
  await invoke('settings:set', 'edgeMargin', 40);
  await invoke('settings:set', 'islandStyle', 'dynamic');
  setFullscreen(true);
  check('Bug1 mini state stays flush to the top edge even with dynamic + edgeMargin 40',
    y() === primaryY, `y=${y()}`);
  setFullscreen(false);

  /* Monitor under the cursor whose top edge is NOT y=0. */
  await invoke('settings:set', 'monitor', 'cursor');
  await invoke('settings:set', 'edgeMargin', 12);
  await invoke('settings:set', 'islandStyle', 'notched');
  const secondaryNotched = y();
  await invoke('settings:set', 'islandStyle', 'dynamic');
  const secondaryDynamic = y();
  await invoke('settings:set', 'edgeMargin', 0);
  setFullscreen(true);
  const secondaryMini = y();
  setFullscreen(false);
  check('Bug1 monitor=cursor uses the secondary display top edge (y=120), not 0',
    secondaryNotched === nearestY && secondaryDynamic === nearestY + 12 && secondaryMini === nearestY,
    `notched=${secondaryNotched} dynamic=${secondaryDynamic} mini=${secondaryMini}`);
  await invoke('settings:set', 'monitor', 'main');
  await invoke('settings:set', 'edgeMargin', 4);
  await invoke('settings:set', 'islandStyle', 'dynamic');

  /* Style change DURING a running animation: reposition() must stop stale frames. */
  await invoke('settings:set', 'edgeMargin', 40);
  openHotkey()();                                // pill(y=40) -> open(y=40) animation starts
  const animBefore = countIntervals(16);
  tickInterval(16, 2);                           // mid-transition
  const midY = y();
  check('Bug1 an open transition really starts a 16 ms animation with stale y',
    animBefore === 1 && midY === primaryY + 40, `anim=${animBefore} midY=${midY}`);
  await invoke('settings:set', 'islandStyle', 'notched');   // lands mid-transition
  const afterReposition = y();
  const animAfter = countIntervals(16);
  tickInterval(16, 40);                          // ghost frames would drag y back to 40
  const afterGhostFrames = y();
  check('Bug1 reposition() stops the running animation (no stale frames)',
    afterReposition === primaryY && animAfter === 0 && afterGhostFrames === primaryY,
    `afterReposition=${afterReposition} animAfter=${animAfter} afterGhostFrames=${afterGhostFrames}`);
  await invoke('settings:set', 'edgeMargin', 4);
  await invoke('settings:set', 'islandStyle', 'dynamic');
  toggleCard();                                  // close back to pill

  /* ============================================ BUG 2: click-through ownership */
  const cycle = [];
  const expected = [false, true, false, true, false, false, false];
  const labels = ['pill', 'mini', 'open', 'mini', 'pill', 'open', 'pill'];
  const record = () => cycle.push({ state: lastStatus()?.state, ignore: effectiveIgnore() });
  record();                       // initial pill
  setFullscreen(true); record();  // mini
  toggleCard(); record();         // open
  toggleCard(); record();         // close -> mini
  setFullscreen(false); record();// pill
  toggleCard(); record();         // open
  toggleCard(); record();         // close -> pill
  check('Bug2 pill->mini->open->mini->pill->open->pill : ignoreMouseEvents === (state==="mini")',
    cycle.length === 7 && cycle.every((c, i) => c.state === labels[i] && c.ignore === expected[i]),
    JSON.stringify(cycle));
  check('Bug2 every setIgnoreMouseEvents call keeps {forward:true} for hover reveal',
    ignoreCalls.length > 0 && ignoreCalls.every((c) => c.opts && c.opts.forward === true),
    JSON.stringify(ignoreCalls));

  const beforePointer = ignoreCalls.length;
  send('island:pointer', 'enter', 3);
  send('island:pointer', 'move', 4);
  send('island:pointer', 'leave', 5);
  check('Bug2 handleIslandPointer no longer touches click-through',
    ignoreCalls.length === beforePointer, `calls=${ignoreCalls.length}`);

  /* 3+ repeated cycles: nothing gets stuck. */
  const stuck = [];
  for (let i = 0; i < 4; i++) {
    setFullscreen(true);   stuck.push({ s: lastStatus()?.state, ig: effectiveIgnore() });
    toggleCard();          stuck.push({ s: lastStatus()?.state, ig: effectiveIgnore() });
    toggleCard();          stuck.push({ s: lastStatus()?.state, ig: effectiveIgnore() });
    setFullscreen(false);  stuck.push({ s: lastStatus()?.state, ig: effectiveIgnore() });
  }
  check('Bug2 4 extra open/close cycles never leave a state with wrong click-through',
    stuck.every((c) => c.ig === (c.s === 'mini')), JSON.stringify(stuck));

  /* settings change while mini / open must not flip the rule. */
  setFullscreen(true);
  await invoke('settings:set', 'accent', '#ffffff');
  check('Bug2 applySettings() while mini keeps click-through ON', effectiveIgnore() === true);
  toggleCard();
  await invoke('settings:set', 'accent', '#e9eef7');
  check('Bug2 applySettings() while open keeps click-through OFF', effectiveIgnore() === false);
  toggleCard();

  /* Hover peek: hovering the small notch expands the island to the pill and
     arms the card-open timer; leaving closes it back to the notch.
     Timers are dropped WITHOUT firing between cases, so a leftover logging or
     grace timer from a previous transition cannot masquerade as an armHover. */
  await invoke('settings:set', 'openDelayMs', 333);
  await invoke('settings:set', 'openDelayBusyMs', 444);
  const hoverAt = (x, yy) => { cursor.x = x; cursor.y = yy; tickByName('pollHoverZone', 1); };
  const dropTimers = () => { for (const id of Array.from(timeouts.keys())) timeouts.delete(id); };
  const outsideThenInside = () => { hoverAt(100, 700); dropTimers(); hoverAt(b.x + 5, b.y + 2); };
  setFullscreen(true);                  // deterministic starting state: mini
  const b = windows[0].getBounds();
  check('Bug2 hover harness is really in mini state',
    lastStatus()?.state === 'mini', `state=${lastStatus()?.state}`);
  dropTimers();
  outsideThenInside();
  const armedNotch = pendingTimeouts();
  // Under a fullscreen app busyForDelay is true, so the armed delay is the
  // busy one (444), same as the old miniOpensCard=ON case expected.
  check('Bug2 hover pada notch: island peek ke pill dan timer buka kartu terpasang',
    lastStatus()?.state === 'pill' && armedNotch.includes(444),
    `state=${lastStatus()?.state} pending=${JSON.stringify(armedNotch)}`);
  /* Banner return-to-mini while the cursor is still on the notch: the hover
     zone did not change, so the next tick must re-assert the peek. */
  send('banner:show', true);
  send('banner:show', false);
  check('Bug2 banner selesai saat kursor masih di atas: pulih ke notch',
    lastStatus()?.state === 'mini', `state=${lastStatus()?.state}`);
  hoverAt(b.x + 5, b.y + 2);
  check('Bug2 tick hover berikutnya mem-peek ulang notch yang tertutup banner',
    lastStatus()?.state === 'pill', `state=${lastStatus()?.state}`);
  fireTimeouts();
  check('Bug2 firing the notch hover timer really opens the card',
    lastStatus()?.state === 'open', JSON.stringify(lastStatus()));
  toggleCard();                         // closing the card returns to base, the notch
  check('Bug2 closing the card from a peek returns to the notch (base utuh)',
    lastStatus()?.state === 'mini', `state=${lastStatus()?.state}`);
  setFullscreen(false);                 // pill
  dropTimers();
  outsideThenInside();
  const armedPill = pendingTimeouts();
  check('Bug2 pill hover (including the dead gap) arms the reveal/open timer',
    armedPill.includes(333), JSON.stringify(armedPill));
  fireTimeouts();
  toggleCard();                         // the pill hover timer opened the card; close it again
  setFullscreen(true);
  dropTimers();
  hoverAt(100, 700);
  clearSent();
  hoverAt(b.x + 5, b.y + 2);
  check('Bug2 hiddenUntilHover republishes status on hover enter',
    sent.some((m) => m.channel === 'island:update'), JSON.stringify(sent.map((m) => m.channel)));
  await invoke('settings:set', 'hiddenUntilHover', false);
  toggleCard();  // back to mini
  setFullscreen(false);
  dropTimers();

  /* BugFix 3: the reserved mic/cam strip belongs to the two capsules, never
     to the island's hover-to-open zone. Both the geometric exclusion and the
     renderer's mic-enter signal must suppress the card-open timer. */
  if (lastStatus()?.state === 'open') toggleCard();  // deterministic pill state
  setFullscreen(false);
  settle();
  dropTimers();
  meetingNow = true;
  await invoke('settings:set', 'meetingMicButton', true); // applySettings -> syncMicPill
  const wide = windows[0].getBounds();
  dropTimers();
  hoverAt(100, 700); dropTimers();
  hoverAt(wide.x + wide.width - 10, wide.y + 5);
  const armedStrip = pendingTimeouts();
  check('BugFix3 kursor di strip kapsul tidak memasang timer buka kartu',
    !armedStrip.includes(333) && !armedStrip.includes(444), JSON.stringify(armedStrip));
  check('BugFix3 island tetap pill saat kapsul disentuh (kartu tidak keburu terbuka)',
    lastStatus()?.state === 'pill', `state=${lastStatus()?.state}`);
  hoverAt(wide.x + 5, wide.y + 5);  // control: hovering the body DOES arm it
  const armedBody = pendingTimeouts();
  send('island:pointer', 'mic-enter', 0);
  check('BugFix3 kontrol: hover badan memasang timer, mic-enter membatalkannya',
    armedBody.includes(333) && !pendingTimeouts().includes(333),
    JSON.stringify({ armedBody, after: pendingTimeouts() }));
  send('island:pointer', 'mic-leave', 0);
  meetingNow = false;
  await invoke('settings:set', 'meetingMicButton', true);
  dropTimers();

  /* ============================== BUG 4: clipboard text -> clips, never notices */
  const before = await invoke('state:get');
  /* state:get hands back the live cached store, so snapshot the numbers and
     the notice array instead of holding a mutable reference. */
  const clipsBefore = before.clips.length;
  const noticesBefore = before.notices.length;
  const noticeSignature = JSON.stringify(before.notices);
  check('Bug4 seeded user data has 23 historic notices, 17 clipboard-style, 0 clips',
    noticesBefore === 23 && before.notices.filter((n) => n.app === 'Clipboard').length === 17
      && clipsBefore === 0);
  clipText = 'QA-YAN-UNIQUE-COPY-001';
  tickInterval(900, 1);
  await sleep(10);
  const afterCopy = await invoke('state:get');
  check('Bug4 copying unique text adds exactly +1 clip and +0 notices',
    afterCopy.clips.length === clipsBefore + 1
      && afterCopy.clips[0].text === 'QA-YAN-UNIQUE-COPY-001'
      && afterCopy.notices.length === noticesBefore,
    `clips=${afterCopy.clips.length} notices=${afterCopy.notices.length} top=${afterCopy.clips[0]?.text}`);
  check('Bug4 the 17 historic clipboard-style notices are untouched (id/body preserved)',
    JSON.stringify(afterCopy.notices) === noticeSignature);
  tickInterval(900, 1);
  await sleep(10);
  check('Bug4 unchanged clipboard text does not duplicate a clip',
    (await invoke('state:get')).clips.length === 1);

  const copyRes = await invoke('clip:copy', 'QA-YAN-COPY-BACK');
  check('Bug4 clip:copy really writes the OS clipboard',
    copyRes.ok === true && clipboardWrites.includes('QA-YAN-COPY-BACK'), JSON.stringify(clipboardWrites));
  tickInterval(900, 1);
  await sleep(10);
  check('Bug4 our own clipboard write does not become a new history entry (lastClip guard)',
    (await invoke('state:get')).clips.length === 1);
  const pasteRes = await invoke('clip:paste', 'QA-YAN-PASTE-BACK');
  check('Bug4 clip:paste writes the text and fires the real Ctrl+V shortcut',
    pasteRes.ok === true && clipboardWrites.includes('QA-YAN-PASTE-BACK') && pasteCalls.length === 1,
    `pasteCalls=${pasteCalls.length}`);
  check('Bug4 clip:copy / clip:paste reject empty or non-string input',
    (await invoke('clip:copy', '')).ok === false
      && (await invoke('clip:copy', 42)).ok === false
      && (await invoke('clip:paste', null)).ok === false);

  clearSent();
  /* The store caps notices at MAX_NOTICES=24, so with 23 seeded historic ones
     only the first push grows the count. Prove each channel by the newest
     notice title (and its broadcast), which is the real user-visible effect. */
  send('notify:push', 'QA pengingat', 'isi');
  const c1 = await invoke('state:get');
  const t1 = c1.notices[0].title, n1 = c1.notices.length;
  await invoke('ram:clean');
  const c2 = await invoke('state:get');
  const t2 = c2.notices[0].title, n2 = c2.notices.length;
  send('shelf:add', [{ name: 'qa.txt', path: 'C:\\qa.txt', size: 12 }]);
  const c3 = await invoke('state:get');
  const t3 = c3.notices[0].title, n3 = c3.notices.length;
  extrasCallbacks.notice('Downloads', 'Unduhan selesai', 'qa.zip');
  const c4 = await invoke('state:get');
  const t4 = c4.notices[0].title, n4 = c4.notices.length;
  check('Bug4 real notifications still work (reminder / RAM clean / Shelf / Downloads)',
    t1 === 'QA pengingat' && n1 === 24
      && t2 === 'Memori dirapikan' && t3 === 'File ditambahkan' && t4 === 'Unduhan selesai'
      && [n2, n3, n4].every((n) => n === 24)
      && sent.filter((m) => m.channel === 'state:changed').length >= 4,
    `titles=${[t1, t2, t3, t4].join('|')} counts=${[n1, n2, n3, n4].join(',')} broadcasts=${sent.filter((m) => m.channel === 'state:changed').length}`);
  /* Notifications are NEVER held anymore (user spec 2026-11-15): the same
     "meeting notice" must land even while a meeting flag would be set. */
  extrasCallbacks.notice('Zoom', 'Rapat dimulai', 'meeting note');
  check('Bug4 meeting notice is NOT held — every notice lands',
    (await invoke('state:get')).notices[0].title === 'Rapat dimulai');
  check('Bug4 no copied text ever leaked into a Notification',
    (await invoke('state:get')).notices.every((n) => !n.body.includes('QA-YAN-UNIQUE-COPY-001')
      && !n.title.includes('QA-YAN-UNIQUE-COPY-001')));

  /* ======================================= BUG 5: robot hysteresis & teardown */
  clearSent();
  idleSeconds = 60;
  tickInterval(200, 1);
  check('Bug5 a single idle sample does not flip the robot to idle',
    robotStates().every((s) => s.idle === false), JSON.stringify(robotStates()));
  clearSent();
  for (let i = 0; i < 40; i++) {
    idleSeconds = i % 2 === 0 ? 60 : 0;
    tickInterval(200, 1);
  }
  const flapping = robotStates();
  check('Bug5 flapping around the threshold emits no idle:true and no repeated IPC spam',
    flapping.every((s) => s.idle === false) && flapping.length <= 1,
    `messages=${flapping.length} :: ${JSON.stringify(flapping)}`);
  idleSeconds = 60;
  clearSent();
  tickInterval(200, 20);
  const sustained = robotStates();
  check('Bug5 sustained idle publishes idle:true exactly once (15 stable ticks)',
    sustained.filter((s) => s.idle === true).length === 1 && sustained.length === 1,
    JSON.stringify(sustained));
  clearSent();
  await invoke('settings:set', 'robotIdleOnly', false);
  await invoke('settings:set', 'robotBatteryExpressions', false);
  await invoke('settings:set', 'robotEyeMovement', 'relaxed');
  /* While ANY robot feature is still on, a settings change legitimately
     republishes one REAL sample. Only check the FINAL teardown step, which is
     the one that clears the timer and must not emit a synthetic idle jump. */
  const intermediate = robotStates();
  check('Bug5 intermediate robot setting changes republish real sampled states only',
    intermediate.every((s) => s.idle === true), JSON.stringify(intermediate));
  clearSent();
  await invoke('settings:set', 'catIdleCenter', false);
  check('Bug5 timer teardown publishes no synthetic robot state (no cat jump)',
    robotStates().length === 0 && countIntervals(200) === 0,
    `states=${JSON.stringify(robotStates())} timers=${countIntervals(200)}`);
  clearSent();
  await invoke('settings:set', 'robotIdleOnly', true);
  check('Bug5 re-enabling while idle republishes exactly one real robot state',
    robotStates().length === 1 && robotStates()[0].idle === true, JSON.stringify(robotStates()));
  clearSent();
  tickInterval(200, 10);
  check('Bug5 unchanged robot samples are de-duplicated over IPC',
    robotStates().length === 0, JSON.stringify(robotStates()));

  const failed = results.filter((r) => !r.ok);
  console.log(`\nQA_MAIN ${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) console.log('FAILED: ' + failed.map((f) => f.name).join(' | '));
  global.setInterval = realSetInterval;
  global.clearInterval = realClearInterval;
  global.clearTimeout = realClearTimeout;
  global.setTimeout = realSetTimeout;
  Date.now = realDateNow;
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('QA_MAIN ERROR', err && err.stack || err);
  process.exit(2);
});
