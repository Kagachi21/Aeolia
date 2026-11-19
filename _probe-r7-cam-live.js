/* R7 camera honesty probe on a real BrowserWindow, preload and renderer.
   No Zoom/Teams/Webex/Meet is installed here, so shortcut/focus are injected at
   the module seam. The probe proves honest reporting, NOT camera E2E.
   Run: env -u ELECTRON_RUN_AS_NODE electron.exe _probe-r7-cam-live.js */
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'aeolia-r7-cam-')));
process.env.ISLAND_FORCE_STATE = 'pill';
process.env.ISLAND_OPEN_SETTINGS = '0';

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  :: ' + JSON.stringify(detail)}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let islandWin = null;
app.on('browser-window-created', (_e, win) => { if (!islandWin) islandWin = win; });

const env = {
  meetingApp: 'Discord', focused: 'discord', sendOk: true,
  focuses: [], shortcuts: [],
};
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === './activeWindow') {
    return {
      getActiveWindow: () => ({ process: env.focused, exe: env.focused + '.exe', title: env.focused,
        maximized: false, fullscreen: false, rect: { x: 0, y: 0, width: 1920, height: 1080 } }),
      getWindowTitles: () => [env.focused], isBusyProcess: () => false, BROWSERS: new Set(), browserShouldShrink: () => false, browserTabCount: () => 0,
      focusProcessWindow: (name) => { env.focuses.push(name); return true; },
    };
  }
  if (request === './extras') {
    return {
      getExtras: () => ({ meeting: true, meetingApp: env.meetingApp, online: true, weather: null,
        weatherError: '', calendarEvents: [], calendarError: '', lastDownload: '', resumeOffer: false }),
      isMeeting: () => true, registerExtras: () => {}, dismissResumeOffer: () => {},
      disposeExtras: () => {}, openPath: () => {}, pickFile: () => '', pickFolder: () => '',
    };
  }
  if (request === './keys') {
    return {
      sendShortcut: (combo) => { env.shortcuts.push(combo); return env.sendOk; },
      mediaNext: () => {}, mediaPrev: () => {}, mediaPlayPause: () => {},
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const js = (code) => islandWin.webContents.executeJavaScript(code);
const clickCam = () => js(`(() => {
  const b = document.getElementById('meetingCam');
  const r = b.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const el = document.elementFromPoint(cx, cy) || b;
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true,
    view: window, clientX: cx, clientY: cy }));
  return true;
})()`);
async function bannerAfter(predicate) {
  let last = '';
  for (let i = 0; i < 70; i += 1) {
    const snap = await js(`(() => ({ text: document.querySelector('#banner:not([hidden]) #bnBody')?.textContent || '',
      dataset: document.getElementById('island').dataset.banner,
      hidden: document.getElementById('banner').hidden,
      state: document.getElementById('island').dataset.state }))()`);
    last = snap.text;
    if (process.env.R7_DEBUG && i % 8 === 0) console.log('BANNER_SNAP ' + JSON.stringify(snap));
    if (predicate(last)) return last;
    await sleep(150);
  }
  return last;
}
const honest = (r) => r && r.ok === false && r.verified === false
  && typeof r.hint === 'string' && /best effort|aplikasi rapat|klik ikon kamera|Fokuskan/.test(r.hint)
  && !/kamera (berhasil )?dimatikan|pesan terkirim/i.test(r.hint);

async function run() {
  require(path.join(__dirname, 'dist', 'main', 'main.js'));
  await sleep(1800);
  check('real BrowserWindow with real preload and renderer booted',
    Boolean(islandWin) && !islandWin.isDestroyed());
  let camReady = false;
  for (let i = 0; i < 40 && !camReady; i += 1) {
    camReady = await js(`(() => {
      const b = document.getElementById('meetingCam');
      const p = document.getElementById('micPill');
      if (!b || p.hidden) return false;
      const r = b.getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return Boolean(el && el.closest('#meetingCam'));
    })()`);
    if (!camReady) await sleep(150);
  }
  check('camera capsule present and clickable', camReady);

  env.meetingApp = 'Discord'; env.focused = 'discord';
  env.focuses = []; env.shortcuts = [];
  await clickCam();
  const discordBanner = await bannerAfter((t) => /tidak punya shortcut kamera/.test(t));
  const discord = await js(`window.api.camToggle()`);
  check('Discord: no shortcut, ok:false and verified:false',
    honest(discord) && discord.code === 'no-shortcut' && discord.sent === false
    && env.shortcuts.length === 0, { discord, shortcuts: env.shortcuts });
  check('Discord: visible hint tells the user what to do',
    /tidak punya shortcut kamera/.test(discordBanner), discordBanner);
  check('no fake "camera off" claim in the UI',
    !/kamera (berhasil )?dimatikan/i.test(discordBanner), discordBanner);

  env.meetingApp = 'Zoom'; env.focused = 'chrome';
  env.focuses = []; env.shortcuts = [];
  await clickCam();
  env.focuses = []; env.shortcuts = [];
  const needFocus = await js(`window.api.camToggle()`);
  check('Zoom out of focus: one click focuses and sends the shortcut',
    honest(needFocus) && needFocus.code === 'unverified-shortcut' && needFocus.sent === true
    && needFocus.shortcut === 'alt+v' && env.shortcuts[0] === 'alt+v'
    && env.focuses.length > 0,
    { needFocus, focuses: env.focuses, shortcuts: env.shortcuts });
  const focusBanner = await bannerAfter((t) => /Shortcut kamera dikirim ke Zoom/.test(t));
  check('one-click hint is visible', /Shortcut kamera dikirim ke Zoom/.test(focusBanner), focusBanner);

  env.meetingApp = 'Zoom'; env.focused = 'zoom';
  env.focuses = []; env.shortcuts = []; env.sendOk = true;
  await clickCam();
  const sent = await js(`window.api.camToggle()`);
  check('shortcut sent but camera still unverified',
    honest(sent) && sent.code === 'unverified-shortcut' && sent.sent === true
    && sent.shortcut === 'alt+v' && env.shortcuts[0] === 'alt+v', { sent, shortcuts: env.shortcuts });
  check('sent shortcut never claims ok:true', sent.ok === false && sent.verified === false, sent);
  const sentBanner = await bannerAfter((t) => /Shortcut kamera dikirim ke Zoom/.test(t));
  check('sent-shortcut hint visible in the banner',
    /Shortcut kamera dikirim ke Zoom/.test(sentBanner) && /best effort/.test(sentBanner), sentBanner);

  env.sendOk = false;
  const failed = await js(`window.api.camToggle()`);
  check('send failure reports send-failed, ok:false',
    honest(failed) && failed.code === 'send-failed' && failed.sent === false,
    { failed, shortcuts: env.shortcuts });

  const failedChecks = results.filter((r) => !r.ok);
  console.log(`\nR7_CAM_LIVE ${results.length - failedChecks.length}/${results.length} PASS (honesty only, camera E2E NOT proven)`);
  if (failedChecks.length) console.log('FAILED: ' + failedChecks.map((f) => f.name).join(' | '));
  app.exit(failedChecks.length ? 1 : 0);
}
run().catch((err) => { console.error('R7_CAM_LIVE ERROR', err && err.stack || err); app.exit(2); });
