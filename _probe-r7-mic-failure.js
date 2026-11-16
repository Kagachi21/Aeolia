/* NEGATIVE MOCK, not proof of success. Injects a failing PowerShell executor
   and checks that the pill cannot pretend the microphone changed.
   Plain node: executor contract only. Electron: full UI state check.
   Run: node _probe-r7-mic-failure.js
        electron.exe _probe-r7-mic-failure.js */
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const electronModule = require('electron');
const inElectron = Boolean(electronModule && electronModule.BrowserWindow);

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  :: ' + JSON.stringify(detail)}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mic = require('./dist/main/micMute.js');
mic.setMuteExecutor(async () => 'error');

function finish() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\nR7_MIC_FAILURE ${results.length - failed.length}/${results.length} PASS (negative mock)`);
  if (failed.length) console.log('FAILED: ' + failed.map((f) => f.name).join(' | '));
  return failed.length ? 1 : 0;
}

(async () => {
  check('mocked helper failure yields null state', await mic.getMicMuted() === null);
  check('mocked helper failure yields null toggle', await mic.toggleMicMute() === null);
  if (!inElectron) process.exit(finish());

  const { app, BrowserWindow } = electronModule;
  console.log('NEGATIVE MOCK UI CHECK: no OS state is proven here.');
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'aeolia-r7-micfail-')));
  process.env.ISLAND_FORCE_STATE = 'pill';
  process.env.ISLAND_OPEN_SETTINGS = '0';

  let islandWin = null;
  app.on('browser-window-created', (_e, win) => { if (!islandWin) islandWin = win; });
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === './micMute') return mic;
    if (request === './activeWindow') {
      return {
        getActiveWindow: () => ({ process: 'discord', exe: 'Discord.exe', title: 'Discord',
          maximized: false, fullscreen: false, rect: { x: 0, y: 0, width: 1920, height: 1080 } }),
        getWindowTitles: () => ['Discord'], isBusyProcess: () => false, BROWSERS: new Set(), browserShouldShrink: () => false, browserTabCount: () => 0,
        focusProcessWindow: () => false,
      };
    }
    if (request === './extras') {
      return {
        getExtras: () => ({ meeting: true, meetingApp: 'Discord', online: true, weather: null,
          weatherError: '', calendarEvents: [], calendarError: '', lastDownload: '', resumeOffer: false }),
        isMeeting: () => true, registerExtras: () => {}, dismissResumeOffer: () => {},
        disposeExtras: () => {}, openPath: () => {}, pickFile: () => '', pickFolder: () => '',
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  require(path.join(__dirname, 'dist', 'main', 'main.js'));
  await sleep(1800);
  const js = (code) => islandWin.webContents.executeJavaScript(code);
  await js(`(() => {
    const b = document.getElementById('meetingMic');
    const r = b.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const el = document.elementFromPoint(cx, cy) || b;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true,
      view: window, clientX: cx, clientY: cy }));
    return true;
  })()`);
  await sleep(300);
  for (let i = 0; i < 60; i += 1) {
    const banner = await js(`document.querySelector('#banner:not([hidden]) #bnBody')?.textContent || ''`);
    if (/Mikrofon tidak bisa dikontrol/.test(banner)) break;
    await sleep(150);
  }
  const ui = await js(`(() => {
    const r = document.getElementById('island');
    const b = document.getElementById('meetingMic');
    return { muted: r.dataset.micMuted, pressed: b.getAttribute('aria-pressed'),
      hasMutedClass: b.classList.contains('muted'),
      banner: document.querySelector('#banner:not([hidden]) #bnBody')?.textContent || '' };
  })()`);
  check('helper failure shows unknown state', ui.muted === 'unknown', ui);
  check('helper failure uses mixed aria-pressed', ui.pressed === 'mixed', ui);
  check('helper failure does not paint a fake muted colour', ui.hasMutedClass === false, ui);
  check('helper failure shows a visible hint', /Mikrofon tidak bisa dikontrol/.test(ui.banner), ui.banner);
  app.exit(finish());
})().catch((err) => {
  console.error('R7_MIC_FAILURE ERROR', err && err.stack || err);
  process.exit(2);
});
