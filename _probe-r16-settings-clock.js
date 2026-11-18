/* Antislop finding 1 regression probe: the Settings Appearance live preview
   clock must stay readable on every surface. Measures the computed ink
   through a 1x1 canvas and the painted pill pixels through a 1x1 ring around
   the clock box, so gradient surfaces are judged by what is actually shown.
   Run: env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe _probe-r16-settings-clock.js
*/
const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

app.on('window-all-closed', () => {});
const root = __dirname;
const DIST = path.join(root, 'dist', 'settings');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  :: ${detail}`}`);
};

const state = {
  surface: 'Liquid glass', glassLevel: 55, accent: '#6ea8ff',
  visibleTabs: [], language: 'id',
};
let win = null;
ipcMain.handle('settings:get', () => ({ ...state }));
ipcMain.handle('settings:set', (_e, key, value) => {
  state[key] = value;
  win?.webContents.send('settings:changed', { ...state });
  return { ...state };
});
ipcMain.handle('screen:info', () => ({ screenWidth: 1920, autoScalePct: 100, islandScale: 100 }));
ipcMain.handle('extras:get', () => ({}));
ipcMain.handle('settings:close', () => {});

const measure = `(() => {
  const clock = document.querySelector('.appearance-preview .ap-clock');
  const pill = document.querySelector('.appearance-preview .ap-pill');
  if (!clock || !pill) return { error: 'preview missing' };
  const cr = clock.getBoundingClientRect();
  const pr = pill.getBoundingClientRect();
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.fillStyle = '#ff00fe';
  cx.fillStyle = getComputedStyle(clock).color;
  cx.fillRect(0, 0, 1, 1);
  const d = cx.getImageData(0, 0, 1, 1).data;
  return {
    ink: [d[0], d[1], d[2], d[3]],
    colorCss: getComputedStyle(clock).color,
    clock: { x: cr.x, y: cr.y, w: cr.width, h: cr.height },
    pill: { x: pr.x, y: pr.y, w: pr.width, h: pr.height },
    surface: document.querySelector('.appearance-preview').dataset.surface,
    dpr: devicePixelRatio,
  };
})()`;

function luminance(r, g, b) {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a, b) {
  const l1 = luminance(...a);
  const l2 = luminance(...b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

async function sample(surface) {
  await win.webContents.executeJavaScript(
    `window.settingsApi.set('surface', ${JSON.stringify(surface)}); true`);
  await sleep(260);
  const m = await win.webContents.executeJavaScript(measure);
  if (m.error) return { surface, error: m.error };
  const region = await win.webContents.capturePage({
    x: Math.floor(m.pill.x), y: Math.floor(m.pill.y),
    width: Math.ceil(m.pill.w), height: Math.ceil(m.pill.h),
  });
  const shot = nativeImage.createFromBuffer(region.toPNG());
  const size = shot.getSize();
  const bitmap = shot.toBitmap();
  const px = (x, y) => {
    const i = (Math.min(size.height - 1, Math.max(0, y)) * size.width
      + Math.min(size.width - 1, Math.max(0, x))) * 4;
    return [bitmap[i], bitmap[i + 1], bitmap[i + 2]];
  };
  const cx = m.clock.x - m.pill.x;
  const cy = m.clock.y - m.pill.y;
  const ring = [];
  const pad = 2;
  for (let x = Math.max(0, Math.floor(cx - pad)); x <= Math.min(size.width - 1, Math.ceil(cx + m.clock.w + pad)); x += 2) {
    ring.push(px(x, Math.max(0, Math.floor(cy - pad))), px(x, Math.min(size.height - 1, Math.ceil(cy + m.clock.h + pad))));
  }
  for (let y = Math.max(0, Math.floor(cy - pad)); y <= Math.min(size.height - 1, Math.ceil(cy + m.clock.h + pad)); y += 2) {
    ring.push(px(Math.max(0, Math.floor(cx - pad)), y), px(Math.min(size.width - 1, Math.ceil(cx + m.clock.w + pad)), y));
  }
  const ink = m.ink.slice(0, 3);
  const ratios = ring.map((bg) => contrast(ink, bg)).sort((a, b) => a - b);
  return {
    surface, colorCss: m.colorCss, ink, worst: ratios[0],
    median: ratios[Math.floor(ratios.length / 2)], samples: ratios.length,
  };
}

app.whenReady().then(async () => {
  win = new BrowserWindow({
    width: 920, height: 620, show: false,
    webPreferences: {
      preload: path.join(DIST, '..', 'preload', 'settings-preload.js'),
      additionalArguments: [`--aeolia-surface=${state.surface}`],
      contextIsolation: true, sandbox: false,
    },
  });
  await win.loadFile(path.join(DIST, 'settings.html'));
  await sleep(400);
  await win.webContents.executeJavaScript(`(() => {
    const b = Array.from(document.querySelectorAll('#nav button')).find((x) => x.textContent === 'Appearance');
    if (!b) throw new Error('Appearance nav missing');
    b.click(); return true;
  })()`);
  await sleep(320);

  const light = ['Liquid glass', 'Candy glass', 'Translucent'];
  for (const surface of light) {
    const r = await sample(surface);
    console.log(`MEASURE  R16_CLOCK ${surface} ${JSON.stringify(r)}`);
    check(`preview clock >= 4.5:1 on ${surface}`,
      !r.error && r.worst >= 4.5 && r.samples >= 8, JSON.stringify(r));
  }
  const dark = await sample('Black');
  console.log(`MEASURE  R16_CLOCK Black ${JSON.stringify(dark)}`);
  check('preview clock stays light on dark surfaces', dark.worst >= 4.5, JSON.stringify(dark));

  win.destroy();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`R16_SETTINGS_CLOCK ${results.length - failed}/${results.length} PASS FAILED=${failed}`);
  app.exit(failed ? 1 : 0);
}).catch((e) => { console.error(e); app.exit(1); });
