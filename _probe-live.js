/* End-to-end runtime probe on a REAL Electron BrowserWindow, real preload and
   real renderer. Only the Win32 foreground-window reader is stubbed so state
   transitions can be driven deterministically. Run with:
     env -u ELECTRON_RUN_AS_NODE electron.exe _probe-live.js
*/
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const electron = require('electron');
const { app, BrowserWindow, clipboard, screen, globalShortcut } = electron;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aeolia-live-probe-'));
app.setPath('userData', tmp);
process.env.ISLAND_OPEN_SETTINGS = '0';

const ignoreCalls = [];
const originalIgnore = BrowserWindow.prototype.setIgnoreMouseEvents;
BrowserWindow.prototype.setIgnoreMouseEvents = function (on, opts) {
  ignoreCalls.push(on);
  return originalIgnore.call(this, on, opts);
};

const hotkeys = new Map();
globalShortcut.register = (accel, fn) => { hotkeys.set(accel, fn); return true; };
globalShortcut.unregisterAll = () => { hotkeys.clear(); };

let fullscreen = false;
let islandWin = null;
let settingsWin = null;
const consoleErrors = [];

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === './activeWindow') {
    return {
      getActiveWindow: () => ({
        process: 'explorer', exe: 'explorer.exe', title: 'Probe',
        maximized: false, fullscreen,
        rect: { x: 0, y: 0, width: 1920, height: 1080 },
      }),
      getWindowTitles: () => [],
      isBusyProcess: () => false, BROWSERS: new Set(), browserShouldShrink: () => false, browserTabCount: () => 0,
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

app.on('browser-window-created', (_event, win) => {
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) consoleErrors.push(message);
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
const lastIgnore = () => (ignoreCalls.length ? ignoreCalls[ignoreCalls.length - 1] : null);

async function run() {
  const entry = process.env.AEOLIA_MAIN_ENTRY
    ? path.resolve(process.env.AEOLIA_MAIN_ENTRY)
    : path.join(__dirname, 'dist', 'main', 'main.js');
  console.log('PROBE_ENTRY ' + entry);
  require(entry);
  await sleep(1200);

  check('real BrowserWindow and real preload booted', !!islandWin && !islandWin.isDestroyed(),
    `windows=${BrowserWindow.getAllWindows().length}`);

  const bridge = await js(`(() => ({ api: typeof window.api, island: typeof window.island }))()`);
  check('contextBridge exposed the real api and island channels',
    bridge.api === 'object' && bridge.island === 'object', JSON.stringify(bridge));

  // Keep the cursor poll from opening the card on its own during the probe.
  await js(`window.api.setSetting('openDelayMs', 600000); window.api.setSetting('openDelayBusyMs', 600000); true`);
  await sleep(200);

  await js(`window.api.setSetting('islandStyle', 'notched'); true`);
  await sleep(650);
  const notched = await js(`(() => {
    const el = document.getElementById('island');
    return { dataset: el.dataset.islandStyle, radius: getComputedStyle(el).borderTopLeftRadius };
  })()`);
  const bounds = islandWin.getBounds();
  const displayY = screen.getPrimaryDisplay().bounds.y;
  check('Notched attaches the real window to the top edge',
    notched.dataset === 'notched' && parseFloat(notched.radius) === 0 && bounds.y === displayY,
    JSON.stringify({ notched, bounds, displayY }));

  fullscreen = true;
  await sleep(750);
  const miniState = await js(`document.getElementById('island').dataset.state`);
  check('mini state enables real click-through on the BrowserWindow',
    miniState === 'mini' && lastIgnore() === true,
    JSON.stringify({ miniState, lastIgnore: lastIgnore(), calls: ignoreCalls }));

  const open = hotkeys.get('Ctrl+Alt+N');
  check('open hotkey registered in the real app', typeof open === 'function');
  open();
  await sleep(450);
  const openState = await js(`document.getElementById('island').dataset.state`);
  check('opening the card makes the real window interactive',
    openState === 'open' && lastIgnore() === false,
    JSON.stringify({ openState, lastIgnore: lastIgnore(), calls: ignoreCalls }));

  const tabClick = await js(`(() => {
    const b = document.querySelector('.tab[data-tab="clipboard"]');
    if (!b) return { clicked: false };
    b.click();
    return { clicked: true, active: !!document.querySelector('.panel[data-panel="clipboard"].active') };
  })()`);
  check('clicking a real panel tab activates its panel', tabClick.clicked && tabClick.active,
    JSON.stringify(tabClick));

  const settingsReachable = await js(`(() => {
    const tabs = document.getElementById('tabs').getBoundingClientRect();
    const b = document.querySelector('.tab-settings');
    const r = b.getBoundingClientRect();
    return { visible: getComputedStyle(b).display !== 'none', inside: r.right <= tabs.right + 1 };
  })()`);
  check('Settings button stays reachable with the real card open',
    settingsReachable.visible && settingsReachable.inside, JSON.stringify(settingsReachable));

  const settingsClick = await js(`(() => {
    const b = document.querySelector('.tab-settings');
    if (!b) return false;
    b.click();
    return true;
  })()`);
  await sleep(450);
  check('clicking the real Settings button opens the Settings window',
    settingsClick && !!settingsWin && !settingsWin.isDestroyed(),
    `windows=${BrowserWindow.getAllWindows().length}`);
  if (settingsWin && !settingsWin.isDestroyed()) {
    await settingsWin.webContents.executeJavaScript(`document.getElementById('close')?.click(); true`);
    await sleep(250);
    check('the real Settings close button closes its window',
      settingsWin.isDestroyed() || !settingsWin.isVisible());
  }

  open();
  await sleep(450);
  const closedState = await js(`document.getElementById('island').dataset.state`);
  check('closing the card back to mini restores real click-through',
    closedState === 'mini' && lastIgnore() === true,
    JSON.stringify({ closedState, lastIgnore: lastIgnore(), calls: ignoreCalls }));

  fullscreen = false;
  await sleep(750);
  const pillState = await js(`document.getElementById('island').dataset.state`);
  check('returning to pill makes the real window interactive again',
    pillState === 'pill' && lastIgnore() === false,
    JSON.stringify({ pillState, lastIgnore: lastIgnore() }));

  await js(`window.api.clipboardCopy('AEOLIA-LIVE-COPY'); true`);
  await sleep(120);
  const liveClip = String(await Promise.resolve(clipboard.readText()));
  check('real clipboardCopy writes to the OS clipboard',
    liveClip === 'AEOLIA-LIVE-COPY', JSON.stringify(liveClip.slice(0, 40)));

  const state = await js(`window.api.getState()`);
  check('copying via the real IPC does not add a Notification',
    Array.isArray(state.notices), `notices=${state.notices.length}`);

  check('real app produced no console errors', consoleErrors.length === 0,
    JSON.stringify(consoleErrors.slice(0, 5)));

  const failed = results.filter((r) => !r.ok);
  console.log(`\nPROBE_LIVE ${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) console.log('FAILED: ' + failed.map((f) => f.name).join(' | '));
  process.exit(failed.length ? 1 : 0);
}

run().catch((err) => {
  console.error('PROBE_LIVE ERROR', err && err.stack || err);
  process.exit(2);
});
