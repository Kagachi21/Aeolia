/* QA Kou - real click-level regression probe for the mic/cam capsules.
   Uses a REAL Electron BrowserWindow + the QA preload, real hit tests
   (elementFromPoint) and real MouseEvents, not `.click()` shortcuts.
   Run: env -u ELECTRON_RUN_AS_NODE electron.exe _probe-micclick.js */
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const root = __dirname;
const results = [];
const consoleErrors = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  :: ' + detail}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (win, code) => win.webContents.executeJavaScript(code);

const ALL = ['web', 'notifications', 'shelf', 'clipboard', 'music', 'today',
  'sholat', 'timer', 'reminders', 'water', 'capture', 'controls', 'deck', 'calls'];

/** Build a private QA preload whose persisted card/settings simulate a
    different launch (already-greeted install, or catGreeting disabled). */
function launchPreload(cardPatch = {}, settingsPatch = {}) {
  let base = {};
  try { base = JSON.parse(fs.readFileSync(path.join(root, '_qa-state.json'), 'utf8')); }
  catch { base = {}; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aeolia-first-run-'));
  fs.copyFileSync(path.join(root, '_qa-preload.js'), path.join(dir, '_qa-preload.js'));
  fs.writeFileSync(path.join(dir, '_qa-state.json'), JSON.stringify({
    ...base,
    card: { ...(base.card || {}), ...cardPatch },
    settings: { ...(base.settings || {}), ...settingsPatch },
  }));
  return dir;
}

function launchWindow(preload) {
  const win = new BrowserWindow({
    width: 360, height: 420, frame: false, show: false, backgroundColor: '#17191d',
    webPreferences: {
      preload: preload || path.join(root, '_qa-preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
      backgroundThrottling: false,
    },
  });
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) consoleErrors.push(message);
  });
  return win;
}

const greetingSnapshot = (win) => js(win, `(() => {
  const r = document.getElementById('island');
  return { greeting: r.dataset.greeting, catPos: r.dataset.catPos,
    patches: window.probe.calls().filter(c => c.kind === 'patch'
      && c.payload && c.payload.greetingSeen === true).length };
})()`);

async function main() {
  const win = new BrowserWindow({
    width: 360, height: 420, frame: false, show: true, backgroundColor: '#17191d',
    webPreferences: {
      preload: path.join(root, '_qa-preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
      backgroundThrottling: false,
    },
  });
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) consoleErrors.push(message);
  });
  await win.loadFile(path.join(root, 'dist', 'renderer', 'index.html'));
  await js(win, `window.probe.emit('status', {
    state: 'pill', meeting: true, meetingMicButton: true, meetingApp: 'Discord',
    visibleTabs: ${JSON.stringify(ALL)}, scaleEffective: 100, hiddenUntilHover: false,
    surface: 'Black', glassLevel: 55
  }); true`);
  await sleep(1600); // joining -> on, both capsules clickable

  /* 0. First run consumes the one-shot flag through the persisted store. */
  const firstRun = await greetingSnapshot(win);
  check('FirstRun peluncuran pertama menandai greetingSeen lewat state:patch',
    firstRun.patches >= 1, JSON.stringify(firstRun));

  /* 1. The cat must never own the hit area (greeting non-blocking). */
  const catHit = await js(win, `(() => {
    const slot = document.querySelector('#pill .cat-slot');
    if (!slot) return { missing: true };
    const r = slot.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { catsOwnsHit: !!el && !!el.closest('.cat-slot'), tag: el && el.tagName };
  })()`);
  check('Greeting tidak menelan klik: cat-slot bukan target hit',
    catHit.catsOwnsHit === false, JSON.stringify(catHit));

  /* 2. Real hit test on the mic capsule. */
  const micHit = await js(win, `(() => {
    const btn = document.getElementById('meetingMic');
    const pill = document.getElementById('micPill');
    if (!btn || pill.hidden) return { missing: true, hidden: pill.hidden };
    const r = btn.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const el = document.elementFromPoint(cx, cy);
    return { hit: !!el && !!el.closest('#meetingMic'), cx, cy, tag: el && el.tagName,
      pe: getComputedStyle(btn).pointerEvents, layerPe: getComputedStyle(pill).pointerEvents };
  })()`);
  check('Kapsul Mic benar-benar bisa di-hit (pointer-events + elementFromPoint)',
    micHit.hit === true && micHit.pe === 'auto' && micHit.layerPe === 'none',
    JSON.stringify(micHit));

  /* 3. Hover event on the capsule must report mic-enter (kills armHover). */
  await js(win, `(() => {
    const b = document.getElementById('meetingMic');
    const r = b.getBoundingClientRect();
    b.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
    return true;
  })()`);
  const pointerKinds = await js(win, `window.probe.calls().filter(c => c.kind === 'pointer').map(c => c.payload.kind)`);
  check('Hover kapsul mengirim mic-enter ke main (hover-open dicegah)',
    pointerKinds.includes('mic-enter'), JSON.stringify(pointerKinds));

  /* 4. A REAL click on the capsule: mute toggled, card NOT opened. */
  await js(win, `window.probe.clear(); true`);
  await js(win, `(() => {
    const b = document.getElementById('meetingMic');
    const r = b.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const el = document.elementFromPoint(cx, cy) || b;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true,
      view: window, clientX: cx, clientY: cy }));
    return true;
  })()`);
  await sleep(120);
  const micCalls = await js(win, `window.probe.calls().map(c => c.kind)`);
  check('Klik kapsul Mic memanggil micMuteToggle, BUKAN islandOpen',
    micCalls.includes('micMuteToggle') && !micCalls.includes('islandOpen'),
    JSON.stringify(micCalls));
  const stateAfterMic = await js(win, `(() => ({ state: document.getElementById('island').dataset.state,
    mic: document.getElementById('island').dataset.mic,
    hidden: document.getElementById('micPill').hidden }))()`);
  check('Klik kapsul tidak membuka kartu / tidak menyembunyikan kapsul',
    stateAfterMic.state === 'pill' && stateAfterMic.hidden === false,
    JSON.stringify(stateAfterMic));

  /* 4b. Injected helper failure: unknown state, never a fake definite state. */
  await js(win, `window.probe.flags({ failMic: true }); true`);
  await js(win, `(() => {
    const b = document.getElementById('meetingMic');
    const r = b.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) || b;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true,
      view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
    return true;
  })()`);
  await sleep(120);
  const micUnknown = await js(win, `(() => {
    const r = document.getElementById('island');
    const b = document.getElementById('meetingMic');
    return { muted: r.dataset.micMuted, pressed: b.getAttribute('aria-pressed'),
      fakeMuted: b.classList.contains('muted') };
  })()`);
  check('Kegagalan helper Mic menampilkan unknown + aria mixed',
    micUnknown.muted === 'unknown' && micUnknown.pressed === 'mixed'
    && micUnknown.fakeMuted === false, JSON.stringify(micUnknown));
  await js(win, `window.probe.flags({ failMic: false }); true`);

  /* 5. Same for the Cam capsule. */
  await js(win, `window.probe.clear(); true`);
  const camClick = await js(win, `(() => {
    const b = document.getElementById('meetingCam');
    const r = b.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const el = document.elementFromPoint(cx, cy);
    if (!el || !el.closest('#meetingCam')) return { hit: false };
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true,
      view: window, clientX: cx, clientY: cy }));
    return { hit: true };
  })()`);
  await sleep(120);
  const camCalls = await js(win, `window.probe.calls().map(c => c.kind)`);
  check('Klik kapsul Cam memanggil camToggle, BUKAN islandOpen',
    camClick.hit && camCalls.includes('camToggle') && !camCalls.includes('islandOpen'),
    JSON.stringify({ camClick, camCalls }));

  /* 6. Settings gear: real hit test + real click opens the Settings window. */
  await js(win, `window.probe.clear(); window.probe.emit('status', {
    state: 'open', meeting: false, visibleTabs: ${JSON.stringify(ALL)}
  }); true`);
  await sleep(250);
  const gearClick = await js(win, `(() => {
    const b = document.querySelector('.tab-settings');
    if (!b) return { hit: false, missing: true };
    const r = b.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const el = document.elementFromPoint(cx, cy);
    if (!el || !el.closest('.tab-settings')) return { hit: false, tag: el && el.tagName };
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true,
      view: window, clientX: cx, clientY: cy }));
    return { hit: true, isGear: !!b.querySelector('[data-icon="gear"]'),
      hasSun: !!b.querySelector('svg path[d*="M12 3v2"]') };
  })()`);
  await sleep(120);
  const gearCalls = await js(win, `window.probe.calls().map(c => c.kind)`);
  check('Ikon Settings = gear & klik asli memanggil openWindow',
    gearClick.hit && gearClick.isGear && !gearClick.hasSun && gearCalls.includes('openWindow'),
    JSON.stringify({ gearClick, gearCalls }));

  /* 7. Liquid Glass FX really turn on in Electron, stay inert to the pointer,
        respond to --glass-a and fall back when the CSS features are off. */
  await js(win, `window.probe.emit('settings', { surface: 'Liquid glass', glassLevel: 55 });
    window.probe.emit('status', { state: 'pill', surface: 'Liquid glass', glassLevel: 55 }); true`);
  await sleep(120);
  const glass = await js(win, `(() => {
    const r = document.getElementById('island');
    const fx = document.querySelector('.glass-fx');
    return { fx: r.dataset.glassFx, display: getComputedStyle(fx).display,
      pe: getComputedStyle(fx).pointerEvents, a: r.style.getPropertyValue('--glass-a') };
  })()`);
  check('Bug5 FX kaca aktif, inert, dan mengikuti --glass-a',
    glass.fx === 'on' && glass.display === 'block' && glass.pe === 'none' && glass.a === '0.55',
    JSON.stringify(glass));
  const glassOff = await js(win, `(() => {
    const r = document.getElementById('island');
    r.dataset.glassFx = 'off';
    const display = getComputedStyle(document.querySelector('.glass-fx')).display;
    r.dataset.glassFx = 'on';
    return display;
  })()`);
  check('Bug5 fallback kaca gelap saat CSS tidak didukung', glassOff === 'none', glassOff);

  /* 8. Simulated SECOND LAUNCH: persisted greetingSeen=true. */
  const secondDir = launchPreload({ greetingSeen: true }, { catIdleCenter: false });
  const win2 = launchWindow(path.join(secondDir, '_qa-preload.js'));
  await win2.loadFile(path.join(root, 'dist', 'renderer', 'index.html'));
  await sleep(300);
  const second = await greetingSnapshot(win2);
  check('FirstRun setiap peluncuran menyapa kembali',
    second.greeting === 'true' && second.catPos === 'center',
    JSON.stringify(second));
  await sleep(1700);
  // Re-enabling catGreeting inside the same running window must not replay.
  await js(win2, `window.probe.emit('settings', { catGreeting: true }); true`);
  await sleep(150);
  const reenabled = await greetingSnapshot(win2);
  check('FirstRun mengaktifkan ulang catGreeting dalam sesi yang sama tidak memutar ulang sapaan',
    reenabled.greeting === 'false', JSON.stringify(reenabled));
  win2.destroy();

  /* 9. catGreeting=false: no greeting, but the decision is still consumed for
        this session, so later re-enabling cannot replay mid-session. */
  const offDir = launchPreload({}, { catGreeting: false, catIdleCenter: false });
  const win3 = launchWindow(path.join(offDir, '_qa-preload.js'));
  await win3.loadFile(path.join(root, 'dist', 'renderer', 'index.html'));
  await sleep(300);
  const off = await greetingSnapshot(win3);
  check('FirstRun catGreeting=false tidak menyapa & tetap menyimpan flag',
    off.greeting === 'false' && off.catPos === 'right' && off.patches === 1,
    JSON.stringify(off));
  win3.destroy();

  check('0 console error', consoleErrors.length === 0, JSON.stringify(consoleErrors));
  win.destroy();
  const failed = results.filter((r) => !r.ok);
  console.log(`\nMICCLICK ${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) console.log('FAILED: ' + failed.map((f) => f.name).join(' | '));
  app.exit(failed.length ? 1 : 0);
}

app.whenReady().then(main).catch((e) => { console.error(e); app.exit(1); });
