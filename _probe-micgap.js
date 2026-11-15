/* Kou - proof that the meeting capsules sit next to the island body.
   Captures the real compiled renderer at the exact 572x39 window the user
   screenshot came from (pill 150 + BANNER_EXTRA 250 + MIC_PILL_EXTRA 172),
   for four positions in both joining and on states. The gap is taken from the
   PAINTED capsule pixels, not the DOM box of a hidden button: during joining
   the cam button is still in the flex row even though it is invisible.

   Run: env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe _probe-micgap.js
*/
const { app, BrowserWindow, nativeImage, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const root = __dirname;
const SHOT_DIR = path.join(root, '.superpowers', 'shots');
const { boundsFor } = require(path.join(root, 'dist', 'main', 'bounds.js'));

const PILL = { width: 150, height: 36 };
const MIC_EXTRA = 172;
const BANNER_EXTRA = 250;
const POSITIONS = ['center', 'left', 'right', 'right-side'];
const STATES = ['joining', 'on'];

const results = [];
const report = { captures: {} };
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  :: ' + detail}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pillSettings = (pos) => ({
  islandScale: 100, monitor: 'main', islandPosition: pos, edgeMargin: 4,
  islandStyle: 'dynamic', cardWidth: 420,
  pill: { width: PILL.width, height: PILL.height },
  mini: { width: 64, height: 14 }, open: { width: 420, height: 92 },
});

const MEASURE = `(() => {
  const island = document.getElementById('island');
  const layer = document.getElementById('micPill');
  const mic = document.getElementById('meetingMic');
  const cam = document.getElementById('meetingCam');
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { left: +r.left.toFixed(2), right: +r.right.toFixed(2), width: +r.width.toFixed(2) };
  };
  const visible = (el) => Number(getComputedStyle(el).opacity) > 0.5
    && getComputedStyle(el).display !== 'none' && box(el).width > 0;
  return {
    innerWidth: window.innerWidth, innerHeight: window.innerHeight,
    pos: island.dataset.pos, micState: island.dataset.mic,
    body: box(island), layer: box(layer), mic: box(mic), cam: box(cam),
    micVisible: visible(mic), camVisible: visible(cam),
    layerHidden: layer.hidden, layerDisplay: getComputedStyle(layer).display,
    extra: getComputedStyle(island).getPropertyValue('--mic-extra').trim(),
    banner: island.dataset.banner,
  };
})()`;

function flattenOverWhite(img) {
  const size = img.getSize();
  const src = img.toBitmap();
  const out = Buffer.alloc(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const a = src[i + 3] / 255;
    out[i] = Math.min(255, Math.round(src[i] + 255 * (1 - a)));
    out[i + 1] = Math.min(255, Math.round(src[i + 1] + 255 * (1 - a)));
    out[i + 2] = Math.min(255, Math.round(src[i + 2] + 255 * (1 - a)));
    out[i + 3] = 255;
  }
  return nativeImage.createFromBitmap(out, { width: size.width, height: size.height });
}

/** Opaque painted columns inside the reserved strip, at mid height. */
function paintedSpan(img, x0, x1, pageWidth) {
  const size = img.getSize();
  const bmp = img.toBitmap();
  const k = size.width / pageWidth;
  const y = Math.round(size.height / 2);
  let first = -1;
  let last = -1;
  for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(pageWidth - 1, Math.ceil(x1)); x += 1) {
    const px = Math.round(x * k);
    const a = bmp[(y * size.width + px) * 4 + 3];
    if (a >= 160) {
      if (first < 0) first = x;
      last = x;
    }
  }
  return { first, last, width: last - first + 1 };
}

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const win = new BrowserWindow({
    width: PILL.width + MIC_EXTRA + BANNER_EXTRA, height: 39,
    frame: false, show: false, transparent: true, hasShadow: false,
    useContentSize: true, backgroundColor: '#00000000', paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: path.join(root, '_qa-preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
      backgroundThrottling: false,
    },
  });
  await win.loadFile(path.join(root, 'dist', 'renderer', 'index.html'));
  win.showInactive();
  await sleep(320);
  const js = (code) => win.webContents.executeJavaScript(code);
  const status = (pos, meeting) => js(`window.probe.emit('status', ${JSON.stringify({
    state: 'pill', meeting, meetingMicButton: true, media: false, mediaTitle: '',
    miniMode: 'clock', scaleEffective: 100, accent: '#e9eef7', surface: 'Black',
    word: false, hiddenUntilHover: false, islandPosition: pos,
    glassLevel: 20, islandStyle: 'dynamic', visibleTabs: null, openAction: 'last',
  })}); true`);

  for (const pos of POSITIONS) {
    const bounds = boundsFor('pill', pillSettings(pos), undefined, undefined, MIC_EXTRA, BANNER_EXTRA);
    await js(`window.probe.emit('settings', ${JSON.stringify({ islandPosition: pos })}); true`);
    win.setBounds(bounds);
    await status(pos, false);
    await sleep(300);

    /* Rising edge: joining appears at once and settles after 1.4 s. */
    await status(pos, true);
    for (const state of STATES) {
      await sleep(state === 'joining' ? 380 : 1250);
      const m = await js(MEASURE);
      const shot = await win.capturePage();
      const name = `micgap-${pos}-${state}`;
      fs.writeFileSync(path.join(SHOT_DIR, `${name}.png`), shot.toPNG());
      fs.writeFileSync(path.join(SHOT_DIR, `${name}-white.png`), flattenOverWhite(shot).toPNG());
      fs.writeFileSync(path.join(SHOT_DIR, `${name}-4x.png`),
        flattenOverWhite(shot).resize({ width: shot.getSize().width * 4, quality: 'best' }).toPNG());

      const rightSide = pos === 'right' || pos === 'right-side';
      const strip = rightSide ? [0, m.body.left - 1] : [m.body.right + 1, m.innerWidth - 1];
      const painted = paintedSpan(shot, strip[0], strip[1], m.innerWidth);
      const gap = rightSide
        ? +(m.body.left - (painted.last + 1)).toFixed(1)
        : +(painted.first - m.body.right).toFixed(1);
      const overlap = rightSide
        ? painted.last >= m.body.left
        : painted.first <= m.body.right;
      const clipped = painted.first < 0
        || painted.last > m.innerWidth - 1
        || painted.first < strip[0] - 1 || painted.last > strip[1] + 1;
      const domCaps = [m.micVisible ? m.mic : null, m.camVisible ? m.cam : null].filter(Boolean);
      const domEdge = rightSide
        ? Math.max(...domCaps.map((c) => c.right))
        : Math.min(...domCaps.map((c) => c.left));

      report.captures[name] = {
        pos, state: m.micState, wantState: state,
        window: [shot.getSize().width, shot.getSize().height],
        pageWidth: m.innerWidth, extra: m.extra,
        body: [m.body.left, m.body.right], layer: [m.layer.left, m.layer.right],
        mic: [m.mic.left, m.mic.right], cam: [m.cam.left, m.cam.right],
        visible: { mic: m.micVisible, cam: m.camVisible },
        painted: [painted.first, painted.last], paintedWidth: painted.width,
        gap, domEdge, overlap, clipped,
      };
      console.log(`  ${name.padEnd(26)} body=[${m.body.left},${m.body.right}]`
        + ` painted=[${painted.first},${painted.last}] gap=${gap}`
        + ` visible(mic/cam)=${m.micVisible}/${m.camVisible} state=${m.micState}`);

      check(`${name}: state ${state} benar dan layer tampil`,
        m.micState === state && m.layerDisplay === 'flex' && m.layerHidden === false,
        `micState=${m.micState} display=${m.layerDisplay} hidden=${m.layerHidden}`);
      check(`${name}: celah kapsul ke badan island 8..12 px`,
        gap >= 8 && gap <= 12, `gap=${gap} painted=${painted.first}..${painted.last}`);
      check(`${name}: tidak tumpang tindih, tidak terpotong`,
        !overlap && !clipped, `overlap=${overlap} clipped=${clipped}`
        + ` body=${m.body.left}..${m.body.right} painted=${painted.first}..${painted.last}`);
    }
  }

  fs.writeFileSync(path.join(SHOT_DIR, 'micgap-metrics.json'), JSON.stringify(report, null, 2), 'utf8');
  win.destroy();
}

app.on('window-all-closed', (event) => event.preventDefault());
app.whenReady().then(async () => {
  try { await main(); } catch (err) {
    check('probe selesai tanpa exception', false, String((err && err.stack) || err));
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\nPROBE_MICGAP ${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) console.log('FAILED: ' + failed.map((f) => f.name).join(' | '));
  app.exit(failed.length ? 1 : 0);
});
