/* QA Yan - does the 39 px window floor break clicking? (throwaway probe, NOT
 * product).
 *
 * The notch paints 14 px but Electron/Windows will not make the frameless
 * window shorter than 39 px, so 25 px of the window are transparent. This probe
 * boots the REAL compiled main process (REAL BrowserWindow, REAL preload, REAL
 * renderer) with a temp userData cloned from the user's settings and measures
 * what those coordinates can do:
 *
 *   - click-through flag: every setIgnoreMouseEvents call is recorded, because
 *     Electron exposes no isIgnoringMouseEvents() getter;
 *   - nothing below the strip is painted (per-row alpha from the real capture)
 *     and nothing below the strip has a receiving element (elementFromPoint);
 *   - hover is read from the cursor POSITION by the main process, so feeding the
 *     cursor sampler a point on the strip must peek the island to the pill and
 *     flip click-through off;
 *   - with the pill up, a real Chromium input click on the body opens the card
 *     (the old regression: the peeked pill must not stay click-through);
 *   - counter-check: the page DOES have a click handler on the notch, so if the
 *     OS flag were ever lost, a click would be swallowed by the island instead
 *     of reaching the app below.
 *
 * Honest limits, stated up front:
 *   - A Win32 click could not be injected: spawning PowerShell from this
 *     process is blocked by the harness, and the PowerShell tool blocks
 *     Add-Type, so mouse_event is unavailable. OS-side pass-through is
 *     therefore proven by the ignore flag + the documented {forward:true}
 *     option, not by watching a click land on a second app.
 *   - The hover input is fed by pinning screen.getCursorScreenPoint to the
 *     strip, which is exactly the value Windows reports when the pointer rests
 *     there; the app reads that position, not mouse events.
 *
 * Run: env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe _probe-clickthrough.js
 */
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const electron = require('electron');
const { app, BrowserWindow, screen, globalShortcut } = electron;

const root = __dirname;
const SHOT_DIR = path.join(root, '.superpowers', 'shots');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aeolia-clickthrough-'));
app.setPath('userData', tmp);
process.env.ISLAND_OPEN_SETTINGS = '0';

/* Seed from the user's real settings so the boot path is the real one, but
   neutralize what would race this probe. */
const USER_DATA = path.join(process.env.APPDATA || '', 'Aeolia Island');
const realSettings = JSON.parse(fs.readFileSync(path.join(USER_DATA, 'settings.json'), 'utf8'));
const seeded = Object.assign({}, realSettings, {
  pollIntervalMs: 300, openDelayMs: 600000, openDelayBusyMs: 600000, animationMs: 120,
  islandStyle: 'dynamic', edgeMargin: 0, monitor: 'main', miniMode: 'clock',
  miniTrigger: 'maximized', hiddenUntilHover: false, captureShortcut: 'off',
  runAtStartup: false, meetingAuto: false, meetingMicButton: false,
  robotIdleOnly: false, robotBatteryExpressions: false, robotEyeMovement: 'relaxed',
  catIdleCenter: false, islandScale: 100,
});
fs.writeFileSync(path.join(tmp, 'settings.json'), JSON.stringify(seeded, null, 2), 'utf8');
fs.writeFileSync(path.join(tmp, 'state.json'), JSON.stringify({
  lastTab: 'music', clips: [], notices: [], sites: [], shelf: [], tasks: [],
}, null, 2), 'utf8');

/* ---- record the real click-through calls (no getter exists in Electron) ---- */
const ignoreCalls = [];
const originalIgnore = BrowserWindow.prototype.setIgnoreMouseEvents;
BrowserWindow.prototype.setIgnoreMouseEvents = function (on, opts) {
  ignoreCalls.push({ on, opts, at: Date.now() });
  return originalIgnore.call(this, on, opts);
};
const ignoreNow = () => (ignoreCalls.length ? ignoreCalls[ignoreCalls.length - 1].on : null);

/* ---- record hotkeys instead of registering them on the user's desktop ---- */
const hotkeys = new Map();
globalShortcut.register = (accel, fn) => { hotkeys.set(accel, fn); return true; };
globalShortcut.unregisterAll = () => { hotkeys.clear(); };

let maximized = false;
let islandWin = null;
let settingsWin = null;
const consoleMessages = [];
const pasteCalls = [];

/* ---- stub only OS-facing local modules ---- */
const stubs = {
  activeWindow: {
    getActiveWindow: () => ({ process: 'explorer', exe: 'explorer.exe', title: 'QA',
      maximized, fullscreen: false, rect: { x: 0, y: 0, width: 1920, height: 1080 } }),
    getWindowTitles: () => [], isBusyProcess: () => false, BROWSERS: new Set(), browserShouldShrink: () => false, browserTabCount: () => 0,
  },
  media: { readMedia: () => ({ playing: false, title: '' }) },
  power: { readPower: () => ({ percent: 80, charging: false }) },
  keys: { mediaPlayPause: () => {} },
  ramClean: { cpuPercent: () => 12,
    memoryInfo: () => ({ usedMb: 8192, totalMb: 16384, percent: 50 }),
    cleanRam: () => ({ freedMb: 0, trimmed: 0, denied: 0 }) },
  capture: { registerCapture: () => {}, disposeCapture: () => {} },
  extras: {
    disposeExtras: () => {},
    getExtras: () => ({ meeting: false, meetingApp: '', online: true, weather: null, weatherError: '',
      calendarEvents: [], calendarError: '', lastDownload: '', resumeOffer: false }),
    isMeeting: () => false, openPath: () => {},
    pickFile: () => Promise.resolve(''), pickFolder: () => Promise.resolve(''),
    registerExtras: () => {}, shouldHoldNotice: () => false, dismissResumeOffer: () => {},
  },
  systemControl: {
    brightnessRange: () => ({ supported: false, min: 0, max: 100, current: 0 }),
    setBrightness: () => false,
    pasteShortcut: () => { pasteCalls.push(true); },
    toggleMute: () => {}, volumeStep: () => {},
  },
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (typeof request === 'string' && request.startsWith('./')) {
    const key = path.basename(request, '.js');
    if (Object.prototype.hasOwnProperty.call(stubs, key)) return stubs[key];
  }
  return originalLoad.call(this, request, parent, isMain);
};

/* ---- the cursor the main process reads: real by default, pinnable ----------
   Installed after app ready (the screen module throws before that). */
let pinnedCursor = null;
function installCursorSeam() {
  const original = screen.getCursorScreenPoint.bind(screen);
  screen.getCursorScreenPoint = () => (pinnedCursor ? { ...pinnedCursor } : original());
}

app.on('browser-window-created', (_event, win) => {
  win.webContents.on('console-message', (_e, level, message) => {
    consoleMessages.push({ level, message });
  });
  if (!islandWin) islandWin = win;
  else if (!settingsWin) settingsWin = win;
});

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  :: ' + detail}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (code) => islandWin.webContents.executeJavaScript(code);
const state = () => js(`document.getElementById('island').dataset.state`);
const clickAt = (x, y) => {
  islandWin.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  islandWin.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
};

async function run() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  installCursorSeam();
  const entry = path.join(root, 'dist', 'main', 'main.js');
  check('probe memakai entry main hasil kompilasi', fs.existsSync(entry), entry);
  require(entry);
  await sleep(1600);
  check('REAL main + REAL window booted', !!islandWin && !islandWin.isDestroyed());

  /* ---------------- force the mini notch ---------------- */
  maximized = true;
  await sleep(900);
  const miniState = await state();
  const miniBounds = islandWin.getBounds();
  check('state mini tercapai (window maximized)', miniState === 'mini', JSON.stringify(miniBounds));

  /* What the page knows about its own window, row by row. */
  const ROWS = `(() => {
    const isl = document.getElementById('island');
    const r = isl.getBoundingClientRect();
    const w = window.innerWidth; const h = window.innerHeight;
    const cx = Math.round(w / 2);
    const rows = [];
    for (let y = 0; y < h; y += 1) {
      const el = document.elementFromPoint(cx, y);
      const inside = !!(el && el.closest('#island'));
      rows.push({ y, hit: el ? (el.id || el.tagName) : null, inside });
    }
    return {
      innerWidth: w, innerHeight: h,
      islandRect: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
      rows,
    };
  })()`;
  const rows = await js(ROWS);
  const painted = rows.rows.filter((r) => r.inside).map((r) => r.y);
  const paintedMax = painted.length ? Math.max(...painted) : -1;
  const below = rows.rows.filter((r) => r.y > 13);

  const shotMini = await islandWin.capturePage();
  const size = shotMini.getSize();
  const bmp = shotMini.toBitmap();
  const alphaPerRow = [];
  for (let y = 0; y < size.height; y += 1) {
    let maxA = 0;
    for (let x = 0; x < size.width; x += 1) {
      const a = bmp[(y * size.width + x) * 4 + 3];
      if (a > maxA) maxA = a;
    }
    alphaPerRow.push(maxA);
  }
  fs.writeFileSync(path.join(SHOT_DIR, 'clickthrough-mini-raw.png'), shotMini.toPNG());

  check('window tetap 39 px walau strip hanya 14 px (lantai Electron)',
    miniBounds.height === 39 && rows.innerHeight === 39,
    `window h=${miniBounds.height} page h=${rows.innerHeight}`);
  check('#island sendiri hanya 14 px (strip, bukan seluruh window)',
    rows.islandRect.h === 14 && rows.islandRect.w === 64,
    JSON.stringify(rows.islandRect));
  check('14 px pertama memang punya elemen penerima (#island)',
    painted.length === 14 && painted[0] === 0 && paintedMax === 13,
    `rows 0..${paintedMax}`);
  check('y=14..38 tidak punya elemen penerima di halaman',
    below.every((r) => !r.inside) && below.every((r) => r.hit === 'BODY' || r.hit === 'HTML'),
    JSON.stringify(below.map((r) => `${r.y}:${r.hit}`).slice(0, 6)));
  /* The notch carries its own drop shadow, so "nothing painted" is measured as
     "no surface", not "alpha exactly 0": a 12 % shadow is not a hit target. */
  const maxBelow = Math.max(...alphaPerRow.slice(14));
  check('di bawah strip tidak ada permukaan terlukis (hanya bayangan tipis)',
    maxBelow <= 40, `alpha maksimum baris 14..38 = ${maxBelow}/255`);

  /* ---------------- click-through flag ---------------- */
  pinnedCursor = { x: 40, y: 900 };       // hover sampler parked away
  await sleep(260);
  check('mini: setIgnoreMouseEvents(true, {forward:true}) aktif -> klik tembus ke bawah',
    ignoreNow() === true && ignoreCalls.some((c) => c.on === true && c.opts && c.opts.forward === true),
    JSON.stringify({ ignore: ignoreNow(), calls: ignoreCalls.length }));
  check('semua panggilan memakai {forward:true} (hover reveal tetap hidup)',
    ignoreCalls.every((c) => c.opts && c.opts.forward === true), `calls=${ignoreCalls.length}`);

  const stripPoint = { x: miniBounds.x + Math.round(miniBounds.width / 2), y: miniBounds.y + 7 };
  const bandPoint = { x: miniBounds.x + Math.round(miniBounds.width / 2), y: miniBounds.y + 26 };

  /* ---------------- hover is positional: peek to pill ---------------- */
  pinnedCursor = { x: stripPoint.x, y: stripPoint.y };
  await sleep(700);
  const peekState = await state();
  const peekBounds = islandWin.getBounds();
  check('hover pada 14 px pertama (dibaca dari posisi kursor) memicu peek ke pill',
    peekState === 'pill', `state=${peekState} bounds=${JSON.stringify(peekBounds)}`);
  check('setelah peek, click-through MATI (window menerima klik)',
    ignoreNow() === false, `ignore=${ignoreNow()}`);

  /* A cursor in the transparent remainder must NOT peek: the main process only
     counts the painted strip (paintedH = mini height) as "on the island". */
  pinnedCursor = { x: 40, y: 900 };
  await sleep(450);
  const backToMini = await state();
  check('kursor menjauh -> island kembali ke notch mini', backToMini === 'mini', `state=${backToMini}`);
  check('kembali ke mini -> click-through ON lagi', ignoreNow() === true, `ignore=${ignoreNow()}`);
  pinnedCursor = { x: bandPoint.x, y: bandPoint.y };
  await sleep(600);
  const afterBandHover = await state();
  check('kursor di y=26 (sisa transparan) TIDAK memicu peek (bukan area island)',
    afterBandHover === 'mini', `state=${afterBandHover}`);
  check('kursor di y=26 tidak mengubah click-through', ignoreNow() === true, `ignore=${ignoreNow()}`);

  /* ---------------- the old regression: peeked pill must accept the click ---- */
  pinnedCursor = { x: stripPoint.x, y: stripPoint.y };
  await sleep(700);
  const pillUp = await state();
  const bodyX = Math.round(peekBounds.width / 2);
  const bodyY = Math.round(peekBounds.height / 2);
  clickAt(bodyX, bodyY);
  await sleep(900);
  const afterBodyClick = await state();
  const openBounds = islandWin.getBounds();
  check('klik pada badan island (pill) MEMBUKA kartu, tidak tembus',
    pillUp === 'pill' && afterBodyClick === 'open',
    `pill=${pillUp} -> ${afterBodyClick} bounds=${JSON.stringify(openBounds)} at page ${bodyX},${bodyY}`);
  check('kartu terbuka tetap menerima klik (ignore=false)', ignoreNow() === false, String(ignoreNow()));
  fs.writeFileSync(path.join(SHOT_DIR, 'clickthrough-open.png'), (await islandWin.capturePage()).toPNG());

  /* ---------------- close back to the notch ----------------
     Parking the cursor away is what closes the card (leave timer), which is the
     real path. Do NOT use the open/close hotkey here: it is a toggle, and the
     leave timer may already have closed the card, so the toggle would re-open
     it. */
  pinnedCursor = { x: 40, y: 900 };
  const samples = [];
  for (let i = 0; i < 6; i += 1) { await sleep(200); samples.push(await state()); }
  const closedState = samples[samples.length - 1];
  check('kartu tertutup sendiri saat kursor menjauh -> kembali ke notch mini',
    closedState === 'mini', `samples=${JSON.stringify(samples)}`);
  check('kembali ke notch -> click-through ON (regresi siklus)', ignoreNow() === true, `ignore=${ignoreNow()}`);
  check('hotkey buka/tutup terdaftar di aplikasi nyata',
    typeof hotkeys.get(seeded.hotkeyOpen || 'Ctrl+Alt+N') === 'function',
    JSON.stringify([...hotkeys.keys()]));

  /* ---------------- counter-check: the page WOULD swallow a click ----------
     Chromium-level input bypasses the OS flag, so this is not a pass-through
     test: it proves the notch has a click handler, i.e. the OS flag is the only
     thing keeping the strip click-through. */
  pinnedCursor = { x: 40, y: 900 };
  await sleep(300);
  const beforeCounter = await state();
  clickAt(Math.round(miniBounds.width / 2), 7);
  await sleep(700);
  const afterCounter = await state();
  check('batas pengujian: klik level-Chromium di notch MEMBUKA kartu (halaman punya handler; '
    + 'yang menahan klik OS adalah flag ignore, bukan halaman)',
    beforeCounter === 'mini' && afterCounter === 'open',
    `mini -> ${afterCounter}`);

  const errors = consoleMessages.filter((m) => m.level >= 2);
  check('0 console error di renderer saat probe', errors.length === 0, JSON.stringify(errors.slice(0, 4)));

  fs.writeFileSync(path.join(SHOT_DIR, 'clickthrough-report.json'), JSON.stringify({
    seededFrom: path.join(USER_DATA, 'settings.json'),
    miniBounds, peekBounds, openBounds,
    stripPoint, bandPoint, bodyPoint: { x: bodyX, y: bodyY },
    ignoreCalls, islandRows: rows, alphaPerRow,
  }, null, 2), 'utf8');

  const failed = results.filter((r) => !r.ok);
  console.log(`\nPROBE_CLICKTHROUGH ${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) console.log('FAILED: ' + failed.map((f) => f.name).join(' | '));
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* locked by Electron */ }
  process.exit(failed.length ? 1 : 0);
}

app.whenReady().then(() => run()).catch((err) => {
  console.error('PROBE_CLICKTHROUGH ERROR', (err && err.stack) || err);
  process.exit(2);
});
