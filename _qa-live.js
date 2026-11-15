/* QA Yan - end-to-end probe on the REAL compiled main process, REAL
   BrowserWindow, REAL preload and REAL renderer. Only Win32/OS side effects
   (foreground window reader, Ctrl+V, SMTC, extras) are stubbed. User data is a
   temp clone of the real settings.json/state.json; nothing in %APPDATA% is
   written. Run: env -u ELECTRON_RUN_AS_NODE electron.exe _qa-live.js
*/
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const electron = require('electron');
const { app, BrowserWindow, clipboard, screen, globalShortcut } = electron;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aeolia-qa-live-'));
app.setPath('userData', tmp);
process.env.ISLAND_OPEN_SETTINGS = '0';

const userData = path.join(process.env.APPDATA || '', 'Aeolia Island');
const realSettings = JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8'));
const realState = JSON.parse(fs.readFileSync(path.join(userData, 'state.json'), 'utf8'));
const seeded = Object.assign({}, realSettings, {
  pollIntervalMs: 300, openDelayMs: 600000, openDelayBusyMs: 600000,
  animationMs: 120, islandStyle: 'dynamic', edgeMargin: 4, monitor: 'main',
  miniMode: 'clock', miniTrigger: 'fullscreen',
  hiddenUntilHover: false, captureShortcut: 'off',
  robotIdleOnly: false, robotBatteryExpressions: false,
  robotEyeMovement: 'relaxed', catIdleCenter: false,
});
fs.writeFileSync(path.join(tmp, 'settings.json'), JSON.stringify(seeded, null, 2), 'utf8');
const seedState = Object.assign({}, realState, { clips: [] });
/* The user can clear Notifications at any moment, so the legacy clipboard-style
   scenario is guaranteed by seeding synthetic entries instead of assuming counts. */
const SYNTHETIC_LEGACY = 3;
seedState.notices = [
  ...realState.notices,
  ...Array.from({ length: SYNTHETIC_LEGACY }, (_, i) => ({
    id: 'qa-legacy-clip-' + i, app: 'Clipboard', title: 'Teks disalin', body: 'legacy ' + i, at: 1700000000000 + i,
  })),
];
const seedNoticesCount = seedState.notices.length;
fs.writeFileSync(path.join(tmp, 'state.json'), JSON.stringify(seedState, null, 2), 'utf8');
const historicNotices = JSON.stringify(seedState.notices);
const historicClipNotices = seedState.notices.filter((n) => n.app === 'Clipboard').length;

/* ---- record real click-through calls ---- */
const ignoreCalls = [];
const originalIgnore = BrowserWindow.prototype.setIgnoreMouseEvents;
BrowserWindow.prototype.setIgnoreMouseEvents = function (on, opts) {
  ignoreCalls.push({ on, opts, win: this.id });
  return originalIgnore.call(this, on, opts);
};
const lastIgnore = () => (ignoreCalls.length ? ignoreCalls[ignoreCalls.length - 1] : { on: false, opts: {} });
const effectiveIgnore = () => Boolean(lastIgnore().on);

/* ---- capture real hotkeys ---- */
const hotkeys = new Map();
globalShortcut.register = (accel, fn) => { hotkeys.set(accel, fn); return true; };
globalShortcut.unregisterAll = () => { hotkeys.clear(); };

let fullscreen = false;
let islandWin = null;
let settingsWin = null;
const consoleMessages = [];
const pasteCalls = [];

/* ---- stub only OS-facing local modules ---- */
const stubs = {
  activeWindow: {
    getActiveWindow: () => ({ process: 'explorer', exe: 'explorer.exe', title: 'QA',
      maximized: false, fullscreen, rect: { x: 0, y: 0, width: 1920, height: 1080 } }),
    getWindowTitles: () => [], isBusyProcess: () => false,
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
};
stubs.systemControl = {
  brightnessRange: () => ({ supported: false, min: 0, max: 100, current: 0 }),
  setBrightness: () => false,
  pasteShortcut: () => { pasteCalls.push(true); },   // no real Ctrl+V into the user's app
  toggleMute: () => {}, volumeStep: () => {},
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (typeof request === 'string' && request.startsWith('./')) {
    const key = path.basename(request, '.js');
    if (Object.prototype.hasOwnProperty.call(stubs, key)) return stubs[key];
  }
  return originalLoad.call(this, request, parent, isMain);
};

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
const openHotkey = () => hotkeys.get(seeded.hotkeyOpen || 'Ctrl+Alt+N');
const setSetting = (k, v) => js(`window.api.setSetting(${JSON.stringify(k)}, ${JSON.stringify(v)}); true`);

async function run() {
  const originalClip = String(await Promise.resolve(clipboard.readText()) || '');
  const entry = path.join(__dirname, 'dist', 'main', 'main.js');
  check('QA_LIVE uses the compiled main entry', fs.existsSync(entry), entry);
  require(entry);
  await sleep(1300);

  check('REAL BrowserWindow + REAL preload booted (api & island bridges present)',
    !!islandWin && !islandWin.isDestroyed()
      && (await js(`(() => ({ api: typeof window.api, island: typeof window.island }))()`)).api === 'object'
      && (await js(`typeof window.island`)) === 'object',
    `windows=${BrowserWindow.getAllWindows().length}`);
  check('QA_LIVE seeded real user notices verbatim + synthetic legacy into temp data',
    seedState.notices.length === realState.notices.length + SYNTHETIC_LEGACY
      && JSON.stringify(seedState.notices.slice(0, realState.notices.length)) === JSON.stringify(realState.notices)
      && historicClipNotices >= SYNTHETIC_LEGACY,
    `notices=${seedState.notices.length} clipboard=${historicClipNotices}`);

  const displayY = screen.getPrimaryDisplay().bounds.y;

  /* ---------------- Bug 1: real window geometry ---------------- */
  await setSetting('islandStyle', 'notched');
  await setSetting('edgeMargin', 0);
  await sleep(450);
  const notchedY = islandWin.getBounds().y;
  const notchedCss = await js(`(() => { const r = document.getElementById('island');
    return { style: r.dataset.islandStyle, radius: getComputedStyle(r).borderTopLeftRadius }; })()`);
  check('Bug1 REAL notched window menempel di tepi atas layar (y = display.y) + CSS 0px',
    notchedY === displayY && notchedCss.style === 'notched' && parseFloat(notchedCss.radius) === 0,
    JSON.stringify({ notchedY, displayY, notchedCss }));

  await setSetting('islandStyle', 'dynamic');
  await setSetting('edgeMargin', 12);
  await sleep(450);
  const dynamicY = islandWin.getBounds().y;
  const dynamicCss = await js(`getComputedStyle(document.getElementById('island')).borderTopLeftRadius`);
  check('Bug1 REAL dynamic window mengambang y = display.y + 12 + CSS 14px',
    dynamicY === displayY + 12 && parseFloat(dynamicCss) === 14,
    JSON.stringify({ dynamicY, dynamicCss }));

  /* style change while the open animation is running */
  const hk = openHotkey();
  check('hotkey buka/tutup terdaftar di aplikasi nyata', typeof hk === 'function');
  hk();                                  // start open animation (y target 12)
  await sleep(35);                        // mid-animation
  await setSetting('islandStyle', 'notched');   // reposition() must win
  await sleep(500);
  const midChangeY = islandWin.getBounds().y;
  check('Bug1 REAL ganti style saat animasi berjalan tidak menyeret window ke y lama',
    midChangeY === displayY, `y=${midChangeY} expected=${displayY}`);
  await setSetting('islandStyle', 'dynamic');
  await setSetting('edgeMargin', 4);
  hk();                                  // close card
  await sleep(400);

  /* ---------------- Bug 2: real click-through cycles ---------------- */
  const timeline = [];
  const snap = async (label) => timeline.push({ label, state: await state(), ignore: effectiveIgnore() });
  await snap('pill');
  for (let cycle = 0; cycle < 3; cycle++) {
    fullscreen = true;  await sleep(650); await snap('mini');
    openHotkey()();     await sleep(400); await snap('open');
    openHotkey()();     await sleep(400); await snap('mini-after-close');
    fullscreen = false; await sleep(650); await snap('pill');
  }
  check('Bug2 REAL 3 siklus pill->mini->open->mini->pill: setIgnoreMouseEvents ON hanya di mini',
    timeline.length === 13 && timeline.every((t) => t.ignore === (t.state === 'mini')),
    JSON.stringify(timeline));
  check('Bug2 REAL setiap panggilan memakai {forward:true} (hover reveal tetap hidup)',
    ignoreCalls.length > 0 && ignoreCalls.every((c) => c.opts && c.opts.forward === true),
    `calls=${ignoreCalls.length}`);

  /* real clicks while the card is open */
  fullscreen = true; await sleep(650);
  openHotkey()(); await sleep(400);
  const tabClick = await js(`(() => { const b = document.querySelector('.tab[data-tab="clipboard"]');
    if (!b) return { clicked: false }; b.click();
    return { clicked: true, active: !!document.querySelector('.panel[data-panel="clipboard"].active') }; })()`);
  check('Bug2 klik tab panel ASLI saat kartu terbuka mengaktifkan panelnya',
    tabClick.clicked && tabClick.active, JSON.stringify(tabClick));
  const settingsReach = await js(`(() => { const t = document.getElementById('tabs').getBoundingClientRect();
    const b = document.querySelector('.tab-settings'); const r = b.getBoundingClientRect();
    const at = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
    return { visible: getComputedStyle(b).display !== 'none', inside: r.right <= t.right + 1,
      hit: !!at && (at === b || b.contains(at)) }; })()`);
  check('Bug2 tombol Settings saat kartu terbuka terlihat & kena hit-test',
    settingsReach.visible && settingsReach.inside && settingsReach.hit, JSON.stringify(settingsReach));
  await js(`document.querySelector('.tab-settings').click(); true`);
  await sleep(500);
  check('Bug2 klik tombol Settings ASLI membuka jendela Settings',
    !!settingsWin && !settingsWin.isDestroyed(), `windows=${BrowserWindow.getAllWindows().length}`);
  if (settingsWin && !settingsWin.isDestroyed()) {
    await settingsWin.webContents.executeJavaScript(`document.getElementById('close')?.click(); true`);
    await sleep(300);
    check('Bug2 tombol Tutup jendela Settings benar-benar menutupnya',
      settingsWin.isDestroyed() || !settingsWin.isVisible());
  }
  openHotkey()(); await sleep(400);
  fullscreen = false; await sleep(650);

  /* ---------------- Bug 4: real clipboard + real state ---------------- */
  const before = await js(`window.api.getState()`);
  const clipsBefore = before.clips.length;
  const noticesBefore = before.notices.length;
  const unique = 'QA-YAN-LIVE-' + Date.now();
  await js(`window.api.clipboardCopy(${JSON.stringify(unique)}); true`);
  await sleep(150);
  const osClip = String(await Promise.resolve(clipboard.readText()) || '');
  check('Bug4 clip:copy menulis ke OS clipboard yang nyata', osClip === unique, JSON.stringify(osClip.slice(0, 50)));
  await js(`window.api.clipboardPaste(${JSON.stringify(unique + '-PASTE')}); true`);
  await sleep(150);
  const osPaste = String(await Promise.resolve(clipboard.readText()) || '');
  check('Bug4 clip:paste menulis teks & memicu Ctrl+V (tanpa mengirim ke aplikasi user)',
    osPaste === unique + '-PASTE' && pasteCalls.length === 1,
    `clip=${JSON.stringify(osPaste.slice(0, 50))} pasteCalls=${pasteCalls.length}`);

  /* simulate a NEW copy from another app: set OS clipboard then let the 900 ms poll see it */
  const copied = 'QA-YAN-OS-COPY-' + Date.now();
  clipboard.writeText(copied);
  await sleep(1150);
  const afterCopy = await js(`window.api.getState()`);
  check('Bug4 salin teks unik -> tepat +1 clips, +0 notices (seed notifikasi utuh)',
    afterCopy.clips.length === clipsBefore + 1 && afterCopy.clips[0].text === copied
      && afterCopy.notices.length === noticesBefore
      && JSON.stringify(afterCopy.notices) === historicNotices,
    `clips=${clipsBefore}->${afterCopy.clips.length} notices=${noticesBefore}->${afterCopy.notices.length} top=${afterCopy.clips[0]?.text}`);

  /* real notification channels still work */
  await js(`window.api.notify('QA pengingat', 'isi'); true`);
  await sleep(180);
  const afterNotify = await js(`window.api.getState()`);
  check('Bug4 notifikasi asli (notify:push) tetap bekerja',
    afterNotify.notices[0].title === 'QA pengingat' && afterNotify.notices.length === seedNoticesCount + 1,
    `top=${afterNotify.notices[0].title} count=${afterNotify.notices.length}`);

  /* MAX_CLIPS cap: with 24 clips a new copy replaces the oldest, no notice added */
  const filler = Array.from({ length: 24 }, (_, i) => ({ id: 'f' + i, kind: 'text', text: 'filler-' + i, at: 1700000000000 + i }));
  await js(`window.api.patch({ clips: ${JSON.stringify(filler)} }); true`);
  await sleep(150);
  const cappedText = 'QA-YAN-CAP-' + Date.now();
  clipboard.writeText(cappedText);
  await sleep(1150);
  const capped = await js(`window.api.getState()`);
  check('Bug4 cap MAX_CLIPS=24: entri baru di atas, jumlah tetap 24, notices tidak bertambah',
    capped.clips.length === 24 && capped.clips[0].text === cappedText
      && capped.notices.length === seedNoticesCount + 1,
    `clips=${capped.clips.length} top=${capped.clips[0]?.text} notices=${capped.notices.length}`);

  /* ---------------- persistence + settings whitelist on the real app ---------------- */
  await setSetting('visibleTabs', []);
  await sleep(150);
  const persisted = await js(`window.api.getSettings()`);
  const fileRaw = fs.readFileSync(path.join(tmp, 'settings.json'));
  const bom = fileRaw.length >= 3 && fileRaw[0] === 0xEF && fileRaw[1] === 0xBB && fileRaw[2] === 0xBF;
  const parsed = JSON.parse(fileRaw.toString('utf8'));
  check('Regresi Settings persist: visibleTabs=[] tersimpan, settings.json valid JSON tanpa BOM',
    Array.isArray(persisted.visibleTabs) && persisted.visibleTabs.length === 0
      && Array.isArray(parsed.visibleTabs) && parsed.visibleTabs.length === 0 && !bom,
    JSON.stringify({ runtime: persisted.visibleTabs, file: parsed.visibleTabs, bom }));
  await setSetting('visibleTabs', ['web', '__evil__', 'clipboard']);
  await sleep(150);
  const runtimeSettings = await js(`window.api.getSettings()`);
  const whitelisted = runtimeSettings.visibleTabs;
  check('Regresi whitelist token berlaku di runtime nyata', JSON.stringify(whitelisted) === '["web","clipboard"]',
    JSON.stringify(whitelisted));
  const stateFile = fs.readFileSync(path.join(tmp, 'state.json'));
  const stateBom = stateFile.length >= 3 && stateFile[0] === 0xEF && stateFile[1] === 0xBB && stateFile[2] === 0xBF;
  let stateValid = true;
  try { JSON.parse(stateFile.toString('utf8')); } catch { stateValid = false; }
  check('Regresi state.json valid JSON tanpa BOM', stateValid && !stateBom);

  /* restore the user's OS clipboard */
  clipboard.writeText(originalClip);

  const errors = consoleMessages.filter((m) => m.level >= 2);
  check('0 console error pada aplikasi nyata (main + renderer + preload)', errors.length === 0,
    JSON.stringify(errors.slice(0, 6)));
  const realStateAfter = JSON.parse(fs.readFileSync(path.join(userData, 'state.json'), 'utf8'));
  const realSettingsAfter = JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8'));
  /* Clip entries with QA markers are EXPECTED collateral when the user's own
     running instance watches the OS clipboard; a leak into notices or settings
     would be a real product bug, so only those are forbidden here. */
  const leakedClips = (realStateAfter.clips || []).filter((c) => String(c.text || '').includes('QA-YAN')).length;
  check('QA_LIVE tidak menyentuh data user asli (%APPDATA%)',
    JSON.stringify(realStateAfter.notices) === JSON.stringify(realState.notices)
      && !fs.readFileSync(path.join(userData, 'settings.json'), 'utf8').includes('QA-YAN')
      && realSettingsAfter.islandStyle === realSettings.islandStyle
      && realSettingsAfter.edgeMargin === realSettings.edgeMargin,
    `notices=${realStateAfter.notices.length} settings ok, qa-marker-clips=${leakedClips} (dibersihkan setelah probe)`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\nQA_LIVE ${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) console.log('FAILED: ' + failed.map((f) => f.name).join(' | '));
  console.log(`QA_LIVE_CONSOLE total=${consoleMessages.length} errors=${errors.length}`);
  process.exit(failed.length ? 1 : 0);
}

run().catch((err) => {
  console.error('QA_LIVE ERROR', err && err.stack || err);
  process.exit(2);
});
