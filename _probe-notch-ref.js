/* QA Yan - notch reference vs live (throwaway probe, NOT part of the product).
 *
 * 1. Scans the user's "this was correct" notch screenshot for near-black pixels
 *    (r,g,b < 40) and reports the bounding box + the corner-arc insets.
 * 2. Renders the repo build's mini notch at islandScale 100 for
 *    islandStyle 'dynamic' and 'notched', measures the window bounds and the
 *    live #island rect, and runs the same near-black scan on the capture so
 *    the two are measured with one ruler.
 *
 * Run: env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe _probe-notch-ref.js
 */
const { app, BrowserWindow, nativeImage, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

app.commandLine.appendSwitch('force-device-scale-factor', '1');

const root = __dirname;
const SHOT_DIR = path.join(root, '.superpowers', 'shots');
const STATE_PATH = path.join(root, '_qa-state.json');
const REF = 'C:\\Users\\Lycaon\\.workbuddy-ai\\blobs\\10\\10222b5a0f389ae8df1ac4361527560b36050e6df0c7f2e61949bb46e5923e27.png';
const AFTER_HTML = path.join(root, 'dist', 'renderer', 'index.html');
const { boundsFor } = require(path.join(root, 'dist', 'main', 'bounds.js'));
const { dropThickFrame } = require(path.join(root, 'dist', 'main', 'thinFrame.js'));

const ALL_TABS = ['web', 'notifications', 'shelf', 'clipboard', 'music', 'today',
  'sholat', 'timer', 'reminders', 'water', 'capture', 'controls', 'deck', 'calls'];
const BASE_SETTINGS = {
  islandScale: 100, monitor: 'main', islandPosition: 'center', edgeMargin: 4,
  islandStyle: 'dynamic', cardWidth: 360,
  pill: { width: 150, height: 36 }, mini: { width: 112, height: 26 }, open: { width: 360, height: 92 },
};
const LIGHT = { r: 238, g: 241, b: 245 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (win, code) => win.webContents.executeJavaScript(code);
const out = [];
const say = (s) => { out.push(s); console.log(s); };

/** Bounding box of near-black pixels plus the left/right inset per row. */
function scanBlack(img, threshold) {
  const t = threshold == null ? 40 : threshold;
  const { width, height } = img.getSize();
  const buf = img.toBitmap();
  let minX = width; let maxX = -1; let minY = height; let maxY = -1; let count = 0;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    let l = width; let r = -1;
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const b = buf[i]; const g = buf[i + 1]; const rr = buf[i + 2]; const a = buf[i + 3];
      if (a > 128 && rr < t && g < t && b < t) {
        count += 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (x < l) l = x;
        if (x > r) r = x;
      }
    }
    rows.push({ y, l, r, n: r < 0 ? 0 : r - l + 1 });
  }
  const bbox = count ? {
    left: minX, top: minY, right: maxX, bottom: maxY,
    width: maxX - minX + 1, height: maxY - minY + 1, pixels: count,
    topGap: minY, bottomGap: height - 1 - maxY,
  } : null;
  return { size: { width, height }, bbox, rows };
}

function flattenOverLight(img) {
  const size = img.getSize();
  const src = img.toBitmap();
  const dst = Buffer.alloc(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const a = src[i + 3] / 255;
    dst[i] = Math.min(255, Math.round(src[i] + LIGHT.b * (1 - a)));
    dst[i + 1] = Math.min(255, Math.round(src[i + 1] + LIGHT.g * (1 - a)));
    dst[i + 2] = Math.min(255, Math.round(src[i + 2] + LIGHT.r * (1 - a)));
    dst[i + 3] = 255;
  }
  return nativeImage.createFromBitmap(dst, size);
}

function makeWindow(width, height) {
  const win = new BrowserWindow({
    width, height, frame: false, show: false, transparent: true, hasShadow: false,
    thickFrame: false, resizable: false, movable: false, minimizable: false,
    maximizable: false, fullscreenable: false, useContentSize: true,
    backgroundColor: '#00000000', paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: path.join(root, '_qa-preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
      backgroundThrottling: false,
    },
  });
  win.setMinimumSize(1, 1);
  win.setMaximumSize(4000, 4000);
  dropThickFrame(win);
  win.setBounds({ x: 0, y: 0, width, height });
  return win;
}

const MEASURE = `(() => {
  const isl = document.getElementById('island');
  const cs = getComputedStyle(isl);
  const r = isl.getBoundingClientRect();
  return {
    state: isl.dataset.state, miniMode: isl.dataset.miniMode, style: isl.dataset.islandStyle,
    surface: isl.dataset.surface,
    radius: cs.borderRadius, bg: cs.backgroundColor,
    rect: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
    win: [window.innerWidth, window.innerHeight],
    text: String(isl.innerText || '').replace(/\\s+/g, ' ').trim(),
  };
})()`;

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });

  /* ---------- 1. reference image ---------- */
  const refImg = nativeImage.createFromPath(REF);
  const ref = scanBlack(refImg);
  say('== REFERENCE ==');
  say(`file ${REF}`);
  say(`image ${ref.size.width}x${ref.size.height}`);
  say(`near-black bbox ${JSON.stringify(ref.bbox)}`);
  const arc = ref.rows.filter((r) => r.n > 0);
  if (arc.length) {
    const first = arc[0]; const last = arc[arc.length - 1];
    say(`row0   y=${first.y} l=${first.l} r=${first.r} insetL=${first.l} width=${first.n}`);
    for (const row of arc.slice(-4)) say(`rowEnd y=${row.y} l=${row.l} r=${row.r} insetL=${row.l} width=${row.n}`);
    say(`bottom row insetL=${last.l} insetR=${ref.size.width - 1 - last.r} (= radius if the arc is not clipped)`);
    const widths = arc.map((r) => r.n);
    say(`max row width=${Math.max(...widths)} min row width=${Math.min(...widths)}`);
  }

  /* ---------- 2. live notch ---------- */
  let previousState = null;
  try { previousState = fs.readFileSync(STATE_PATH, 'utf8'); } catch { previousState = null; }
  fs.writeFileSync(STATE_PATH, JSON.stringify({
    status: { state: 'mini', miniMode: 'clock', surface: 'Black', accent: '#e9eef7',
      cardWidth: 360, visibleTabs: [...ALL_TABS], media: false, mediaTitle: '',
      hiddenUntilHover: false, meeting: false, scaleEffective: 100 },
    settings: { surface: 'Black', accent: '#e9eef7', cardWidth: 360, visibleTabs: [...ALL_TABS],
      islandStyle: 'dynamic', islandContent: 'clock-robot', miniMode: 'clock',
      miniTrigger: 'fullscreen', islandPosition: 'center', monitor: 'main',
      edgeMargin: 4, islandScale: 100, glassLevel: 55 },
    card: { lastTab: 'music', notices: [], clips: [], sites: [], shelf: [], tasks: [] },
  }, null, 2), 'utf8');

  const miniB = boundsFor('mini', { ...BASE_SETTINGS, islandStyle: 'dynamic' });
  const miniN = boundsFor('mini', { ...BASE_SETTINGS, islandStyle: 'notched' });
  const display = screen.getPrimaryDisplay();
  const win = makeWindow(miniB.width, miniB.height);
  await win.loadFile(AFTER_HTML);
  win.showInactive();
  await sleep(320);

  say('== LIVE (repo build) ==');
  say(`primary display bounds ${JSON.stringify(display.bounds)} scaleFactor ${display.scaleFactor}`);
  say(`boundsFor mini dynamic ${JSON.stringify(miniB)}  notched ${JSON.stringify(miniN)}`);

  const live = {};
  for (const style of ['dynamic', 'notched']) {
    const target = style === 'notched' ? miniN : miniB;
    win.setBounds(target);
    await js(win, `window.probe.emit('settings', ${JSON.stringify({
      surface: 'Black', islandStyle: style, miniMode: 'clock', islandScale: 100,
      edgeMargin: 4, islandPosition: 'center', monitor: 'main', visibleTabs: [...ALL_TABS],
    })}); true`);
    await js(win, `window.probe.emit('status', ${JSON.stringify({
      state: 'mini', miniMode: 'clock', surface: 'Black', meeting: false, media: false,
      mediaTitle: '', hiddenUntilHover: false, scaleEffective: 100, visibleTabs: [...ALL_TABS],
    })}); true`);
    await sleep(520);
    const m = await js(win, MEASURE);
    const actual = win.getBounds();
    const img = await win.capturePage();
    const flat = flattenOverLight(img);
    fs.writeFileSync(path.join(SHOT_DIR, `notch-ref-live-${style}-light.png`), flat.toPNG());
    fs.writeFileSync(path.join(SHOT_DIR, `notch-ref-live-${style}-light-4x.png`),
      flat.resize({ width: flat.getSize().width * 4, quality: 'best' }).toPNG());
    const scan = scanBlack(flat);
    live[style] = { measure: m, window: actual, capture: scan.size, bbox: scan.bbox, rows: scan.rows };
    say(`-- islandStyle=${style} --`);
    say(`window bounds ${JSON.stringify(actual)} y-gap-from-screen-top=${actual.y - display.bounds.y}`);
    say(`#island rect ${JSON.stringify(m.rect)} radius ${m.radius} surface=${m.surface} text="${m.text}"`);
    say(`capture ${scan.size.width}x${scan.size.height} near-black bbox ${JSON.stringify(scan.bbox)}`);
    const arcRows = scan.rows.filter((r) => r.n > 0);
    if (arcRows.length) {
      const last = arcRows[arcRows.length - 1];
      say(`bottom row insetL=${last.l} insetR=${scan.size.width - 1 - last.r}`);
    }
  }

  /* ---------- 3. delta table ---------- */
  say('== DELTA (reference vs live) ==');
  const b = ref.bbox;
  for (const style of ['dynamic', 'notched']) {
    const l = live[style].bbox;
    say(`${style}: width ${b.width} -> ${l.width} (${l.width - b.width >= 0 ? '+' : ''}${l.width - b.width})`
      + ` | height ${b.height} -> ${l.height} (${l.height - b.height >= 0 ? '+' : ''}${l.height - b.height})`
      + ` | topGap ${b.topGap} -> ${l.topGap}`
      + ` | radius ${ref.rows.filter((r) => r.n > 0).slice(-1)[0].l} -> ${live[style].rows.filter((r) => r.n > 0).slice(-1)[0].l}`);
  }

  fs.writeFileSync(path.join(SHOT_DIR, 'notch-ref-report.txt'), out.join('\n'), 'utf8');
  fs.writeFileSync(path.join(SHOT_DIR, 'notch-ref-metrics.json'),
    JSON.stringify({ reference: { size: ref.size, bbox: ref.bbox, rows: ref.rows }, live }, null, 2), 'utf8');

  win.destroy();
  if (previousState === null) fs.rmSync(STATE_PATH, { force: true });
  else fs.writeFileSync(STATE_PATH, previousState, 'utf8');
}

app.on('window-all-closed', (event) => event.preventDefault());
app.whenReady().then(async () => {
  try {
    await main();
    console.log('\nPROBE_NOTCH_REF OK');
  } catch (err) {
    console.log('PROBE_NOTCH_REF ERROR ' + String((err && err.stack) || err));
    app.exit(1);
    return;
  }
  app.exit(0);
});
