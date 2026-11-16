/* Probe: real DOM gap between the pill cat icon and the clock, in media mode
   (the case in the user's screenshot). Run:
     env -u ELECTRON_RUN_AS_NODE electron.exe _probe-catgap.js
   Seeds status.media=true so the cat occupies the left rail next to the clock.
*/
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const root = __dirname;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aeolia-catgap-'));
fs.writeFileSync(path.join(dir, '_qa-state.json'), JSON.stringify({
  status: { state: 'pill', media: true, mediaTitle: 'Lagu — artis', surface: 'Liquid glass',
    accent: '#6ea8ff', clock: '21:16' },
  settings: { barOrder: ['clock', 'cat', 'media', 'battery', 'mic'], islandContent: 'clock-robot',
    catGreeting: false, surface: 'Liquid glass', glassLevel: 20, accent: '#6ea8ff' },
}));
// NOTE: preload reads _qa-state.json next to itself, so seed the real one too.
fs.copyFileSync(path.join(dir, '_qa-state.json'), path.join(root, '_qa-state.json'));

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  :: ' + detail}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function measure() {
  const win = new BrowserWindow({
    width: 460, height: 70, frame: false, show: false,
    webPreferences: { preload: path.join(root, '_qa-preload.js'), contextIsolation: true,
      nodeIntegration: false, sandbox: false, backgroundThrottling: false },
  });
  await win.loadFile(path.join(root, 'dist', 'renderer', 'index.html'));
  // Force the initial paint: the preload's 30ms startup emit can race the
  // renderer's listener registration.
  await win.webContents.executeJavaScript(`window.probe.emit('status', window.probe.data().status); true`);
  await sleep(300);
  const out = await win.webContents.executeJavaScript(`(() => {
    const r = document.getElementById('island');
    const cat = document.getElementById('pillCatSlot');
    const clock = document.getElementById('clock');
    const cr = cat.getBoundingClientRect();
    const clr = clock.getBoundingClientRect();
    const pill = document.getElementById('pill').getBoundingClientRect();
    return {
      media: r.dataset.media, content: r.dataset.islandContent, rail: r.dataset.catRail,
      cat: { l: cr.left, r: cr.right, w: cr.width },
      clock: { l: clr.left, r: clr.right, w: clr.width },
      pill: { l: pill.left, r: pill.right },
      padLeft: getComputedStyle(document.getElementById('pill')).paddingLeft,
      gap: Math.round((clr.left - cr.right) * 10) / 10,
    };
  })()`);
  win.destroy();
  return out;
}

(async () => {
  try {
    await app.whenReady();
    const m = await measure();
    console.log('MEASURE', JSON.stringify(m));
    check('media state active', m.media === 'true', JSON.stringify({ media: m.media, rail: m.rail }));
    check('cat on left rail', m.rail === 'left', m.rail);
    check('gap cat->clock >= 8px (visible breathing room)', m.gap >= 8,
      `gap=${m.gap}px, catR=${m.cat.r.toFixed(1)}, clockL=${m.clock.l.toFixed(1)}, pad=${m.padLeft}`);
  } catch (e) {
    check('probe ran without throwing', false, String(e));
  } finally {
    try { fs.rmSync(path.join(root, '_qa-state.json'), { force: true }); } catch {}
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\nCATGAP ${results.length - failed}/${results.length}  FAILED=${failed}`);
    app.exit(failed ? 1 : 0);
  }
})();
