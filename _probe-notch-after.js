/* QA Yan - notch shape AFTER the 64x14 fix (throwaway probe, NOT product).
 *
 * One ruler for everything: near-black pixel scan (r,g,b < 40, alpha > 128) on
 * a light composite, exactly like the earlier notch-ref-report.txt run.
 *
 * Settings come from the REAL loader (dist/main/settings.js) reading a COPY of
 * the user's real settings.json (which still says mini 112x26), so the numbers
 * below include the migration, not just hand made geometry. Nothing in
 * %APPDATA% is written.
 *
 * Variants: islandStyle dynamic, notched, and miniMode cat (strip may be 26 px
 * tall, width must stay 64).
 *
 * Run: env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe _probe-notch-after.js
 */
const { app, BrowserWindow, nativeImage, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

app.commandLine.appendSwitch('force-device-scale-factor', '1');

const root = __dirname;
const SHOT_DIR = path.join(root, '.superpowers', 'shots');
const STATE_PATH = path.join(root, '_qa-state.json');
const REF = 'C:\\Users\\Lycaon\\.workbuddy-ai\\blobs\\10\\10222b5a0f389ae8df1ac4361527560b36050e6df0c7f2e61949bb46e5923e27.png';
const USER_DATA = path.join(process.env.APPDATA || '', 'Aeolia Island');
const LIGHT = { r: 238, g: 241, b: 245 };

const out = [];
const say = (s) => { out.push(s); console.log(s); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (win, code) => win.webContents.executeJavaScript(code);

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
    miniH: cs.getPropertyValue('--mini-h').trim(),
    islandScale: cs.getPropertyValue('--island-scale').trim(),
    rect: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
    win: [window.innerWidth, window.innerHeight],
    text: String(isl.innerText || '').replace(/\\s+/g, ' ').trim(),
  };
})()`;

const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok: Boolean(ok), detail });
  say(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  :: ' + detail}`);
};

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });

  /* Keep the pre-fix report as evidence before anything is overwritten. */
  for (const [from, to] of [['notch-ref-report.txt', 'notch-ref-report-before.txt'],
    ['notch-ref-metrics.json', 'notch-ref-metrics-before.json']]) {
    const src = path.join(SHOT_DIR, from);
    const dst = path.join(SHOT_DIR, to);
    if (fs.existsSync(src) && !fs.existsSync(dst)) fs.copyFileSync(src, dst);
  }

  /* ---------- settings: REAL loader on a COPY of the user's real file -------- */
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aeolia-notch-after-'));
  app.setPath('userData', tmp);
  const userSettingsRaw = JSON.parse(fs.readFileSync(path.join(USER_DATA, 'settings.json'), 'utf8'));
  fs.copyFileSync(path.join(USER_DATA, 'settings.json'), path.join(tmp, 'settings.json'));
  const settingsMod = require(path.join(root, 'dist', 'main', 'settings.js'));
  const s = settingsMod.loadSettings();
  const { boundsFor } = require(path.join(root, 'dist', 'main', 'bounds.js'));
  say('== SETTINGS SOURCE ==');
  say(`user file ${path.join(USER_DATA, 'settings.json')} mini ${JSON.stringify(userSettingsRaw.mini)}`);
  say(`loadSettings() mini ${JSON.stringify(s.mini)} islandStyle ${s.islandStyle} miniMode ${s.miniMode} islandScale ${JSON.stringify(s.islandScale)}`);
  check('migrasi: settings.json user (112x26) terbaca 64x14 oleh loader asli',
    s.mini.width === 64 && s.mini.height === 14, JSON.stringify(s.mini));

  const display = screen.getPrimaryDisplay();
  say(`primary display bounds ${JSON.stringify(display.bounds)} scaleFactor ${display.scaleFactor}`);

  /* ---------- reference image ---------- */
  const ref = scanBlack(nativeImage.createFromPath(REF));
  say('== REFERENCE (user screenshot) ==');
  say(`image ${ref.size.width}x${ref.size.height}`);
  say(`near-black bbox ${JSON.stringify(ref.bbox)}`);

  /* ---------- live notch, three variants ---------- */
  let previousState = null;
  try { previousState = fs.readFileSync(STATE_PATH, 'utf8'); } catch { previousState = null; }
  fs.writeFileSync(STATE_PATH, JSON.stringify({
    status: { state: 'mini', miniMode: 'clock', surface: 'Black', accent: '#e9eef7',
      cardWidth: 360, visibleTabs: ['web'], media: false, mediaTitle: '',
      hiddenUntilHover: false, meeting: false, scaleEffective: 100 },
    settings: { surface: 'Black', accent: '#e9eef7', cardWidth: 360, visibleTabs: ['web'],
      islandStyle: 'dynamic', islandContent: 'clock-robot', miniMode: 'clock',
      miniTrigger: 'fullscreen', islandPosition: 'center', monitor: 'main',
      edgeMargin: 4, islandScale: 100, glassLevel: 55 },
    card: { lastTab: 'music', notices: [], clips: [], sites: [], shelf: [], tasks: [] },
  }, null, 2), 'utf8');

  const miniB = boundsFor('mini', { ...s, islandStyle: 'dynamic' });
  const miniN = boundsFor('mini', { ...s, islandStyle: 'notched' });
  say('== BOUNDS ==');
  say(`boundsFor mini dynamic ${JSON.stringify(miniB)}`);
  say(`boundsFor mini notched ${JSON.stringify(miniN)}`);
  check('boundsFor mini (dynamic) = 64x14', miniB.width === 64 && miniB.height === 14, `${miniB.width}x${miniB.height}`);
  check('boundsFor mini (notched) = 64x14', miniN.width === 64 && miniN.height === 14, `${miniN.width}x${miniN.height}`);
  check('mini tetap menempel di atas (y = display.y)', miniB.y === display.bounds.y && miniN.y === display.bounds.y,
    JSON.stringify({ dynamic: miniB.y, notched: miniN.y, displayY: display.bounds.y }));

  const win = makeWindow(miniB.width, miniB.height);
  /* Pin CSS + markup to a commit: dist/renderer is shared with other seats, so a
     concurrent rebuild would swap the stylesheet between variants. */
  const CSS_REF = process.env.AEOLIA_CSS_REF || 'HEAD';
  const snapDir = path.join(os.tmpdir(), `aeolia-notch-${Date.now()}`);
  fs.cpSync(path.join(root, 'dist', 'renderer'), snapDir, { recursive: true });
  const gitShow = (p) => require('node:child_process').execSync(`git show ${CSS_REF}:${p}`, { cwd: root });
  fs.writeFileSync(path.join(snapDir, 'styles.css'), gitShow('src/renderer/styles.css'));
  fs.writeFileSync(path.join(snapDir, 'index.html'), gitShow('src/renderer/index.html'));
  const hashOf = (p) => require('node:crypto').createHash('sha1')
    .update(fs.readFileSync(p)).digest('hex').slice(0, 12);
  say(`== PROVENANCE ==`);
  say(`css pinned to git ${CSS_REF}; styles.css ${hashOf(path.join(snapDir, 'styles.css'))} index.html ${hashOf(path.join(snapDir, 'index.html'))} renderer.js ${hashOf(path.join(snapDir, 'renderer.js'))}`);
  say(`git HEAD ${require('node:child_process').execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim()}`);
  await win.loadFile(path.join(snapDir, 'index.html'));
  win.showInactive();
  await sleep(360);

  const live = {};
  const variants = [
    { key: 'dynamic', style: 'dynamic', mode: 'clock', bounds: miniB, wantH: 14 },
    { key: 'notched', style: 'notched', mode: 'clock', bounds: miniN, wantH: 14 },
    { key: 'cat', style: 'dynamic', mode: 'cat', bounds: miniB, wantH: 26 },
  ];
  for (const v of variants) {
    win.setBounds(v.bounds);
    await js(win, `window.probe.emit('settings', ${JSON.stringify({
      surface: 'Black', islandStyle: v.style, miniMode: v.mode, islandScale: 100,
      edgeMargin: 4, islandPosition: 'center', monitor: 'main', visibleTabs: ['web'],
    })}); true`);
    await js(win, `window.probe.emit('status', ${JSON.stringify({
      state: 'mini', miniMode: v.mode, surface: 'Black', meeting: false, media: false,
      mediaTitle: '', hiddenUntilHover: false, scaleEffective: 100, visibleTabs: ['web'],
    })}); true`);
    await sleep(520);
    const m = await js(win, MEASURE);
    const actual = win.getBounds();
    const img = await win.capturePage();
    const flat = flattenOverLight(img);
    fs.writeFileSync(path.join(SHOT_DIR, `notch-after-${v.key}-light.png`), flat.toPNG());
    fs.writeFileSync(path.join(SHOT_DIR, `notch-after-${v.key}-light-4x.png`),
      flat.resize({ width: flat.getSize().width * 4, quality: 'best' }).toPNG());
    fs.writeFileSync(path.join(SHOT_DIR, `notch-after-${v.key}-raw.png`), img.toPNG());
    const scan = scanBlack(flat);
    const arcRows = scan.rows.filter((r) => r.n > 0);
    const last = arcRows[arcRows.length - 1];
    const first = arcRows[0];
    live[v.key] = {
      measure: m, window: actual, capture: scan.size, bbox: scan.bbox,
      rows: scan.rows, radius: m.radius,
      bottomInsetL: last ? last.l : null,
      bottomInsetR: last ? scan.size.width - 1 - last.r : null,
      row0Inset: first ? first.l : null,
    };
    say(`-- variant ${v.key} (islandStyle=${v.style}, miniMode=${v.mode}) --`);
    say(`window bounds ${JSON.stringify(actual)} (floor: Electron min height 39)`);
    say(`#island rect ${JSON.stringify(m.rect)} radius ${m.radius} --mini-h ${m.miniH} --island-scale ${m.islandScale} text="${m.text}"`);
    say(`capture ${scan.size.width}x${scan.size.height} near-black bbox ${JSON.stringify(scan.bbox)}`);
    if (last) say(`bottom row y=${last.y} insetL=${live[v.key].bottomInsetL} insetR=${live[v.key].bottomInsetR}`);
    check(`${v.key}: strip ${v.key === 'cat' ? '64x26' : '64x14'} +-2`,
      scan.bbox && Math.abs(scan.bbox.width - 64) <= 2 && Math.abs(scan.bbox.height - v.wantH) <= 2,
      scan.bbox ? `${scan.bbox.width}x${scan.bbox.height}` : 'no black pixels');
    check(`${v.key}: menempel di atas (topGap 0)`, scan.bbox && scan.bbox.topGap === 0,
      scan.bbox ? `topGap ${scan.bbox.topGap}` : '-');
    check(`${v.key}: inset bawah ~5 px tiap sisi (radius, gambar di-flatten)`,
      last && Math.abs(live[v.key].bottomInsetL - 5) <= 2 && Math.abs(live[v.key].bottomInsetR - 5) <= 2,
      last ? `L ${live[v.key].bottomInsetL} R ${live[v.key].bottomInsetR}` : '-');

    /* The reference PNG is already composited over a window, so the honest
       comparison is the RAW capture (no flattening step of my own): both are
       "what the pixel looks like", just one has alpha. Flattening lifts the
       antialiased corner pixels above the near-black threshold and inflates
       every inset by ~2 px, which is why the two rulers disagreed. */
    const scanRaw = scanBlack(img);
    const rawRows = scanRaw.rows.filter((r) => r.n > 0);
    const rawOrigin = rawRows.length ? rawRows[0].l : 0;
    const rawSeries = rawRows.slice(-5).map((r) => r.l - rawOrigin);
    const refRows = ref.rows.filter((r) => r.n > 0);
    const refOrigin = refRows.length ? refRows[0].l : 0;
    const refSeries = refRows.slice(-5).map((r) => r.l - refOrigin);
    const rowErr = rawSeries.reduce((s, val, i) => s + Math.abs(val - (refSeries[i] == null ? 99 : refSeries[i])), 0);
    live[v.key].insetSeriesRaw = rawSeries;
    live[v.key].insetSeriesRef = refSeries;
    say(`inset per baris (raw, 5 baris terakhir) live ${JSON.stringify(rawSeries)} vs acuan ${JSON.stringify(refSeries)} total selisih ${rowErr} px`);
    check(`${v.key}: kurva sudut sama dengan acuan (raw, selisih <=1 px/baris)`,
      rawSeries.length === refSeries.length && rowErr <= 2,
      `live ${JSON.stringify(rawSeries)} vs acuan ${JSON.stringify(refSeries)} err ${rowErr}px`);
    check(`${v.key}: hanya ${v.mode === 'cat' ? 'kucing' : 'jam'} yang terlukis`,
      v.mode === 'cat' ? m.text === '' : /^\d{1,2}:\d{2}$/.test(m.text),
      JSON.stringify(m.text));
  }

  /* ---------- delta tables ---------- */
  const beforePath = path.join(SHOT_DIR, 'notch-ref-metrics-before.json');
  const before = fs.existsSync(beforePath) ? JSON.parse(fs.readFileSync(beforePath, 'utf8')) : null;
  say('== DELTA (reference vs AFTER) ==');
  const b = ref.bbox;
  for (const key of ['dynamic', 'notched', 'cat']) {
    const l = live[key].bbox;
    if (!l) { say(`${key}: no black pixels`); continue; }
    say(`${key}: width ${b.width} -> ${l.width} (${l.width - b.width >= 0 ? '+' : ''}${l.width - b.width})`
      + ` | height ${b.height} -> ${l.height} (${l.height - b.height >= 0 ? '+' : ''}${l.height - b.height})`
      + ` | topGap ${b.topGap} -> ${l.topGap}`
      + ` | bottomInsetL ${b.bottomGap === 36 ? 5 : '?'} -> ${live[key].bottomInsetL}`);
  }
  if (before && before.live) {
    say('== DELTA (BEFORE vs AFTER) ==');
    for (const key of ['dynamic', 'notched']) {
      const bf = before.live[key] && before.live[key].bbox;
      const af = live[key].bbox;
      if (!bf || !af) continue;
      say(`${key}: ${bf.width}x${bf.height} -> ${af.width}x${af.height}`
        + ` | window ${JSON.stringify(before.live[key].window)} -> ${JSON.stringify(live[key].window)}`);
    }
  }

  fs.writeFileSync(path.join(SHOT_DIR, 'notch-ref-report-after.txt'), out.join('\n'), 'utf8');
  fs.writeFileSync(path.join(SHOT_DIR, 'notch-ref-metrics-after.json'),
    JSON.stringify({ settingsFromUserFile: userSettingsRaw.mini, migrated: s.mini,
      reference: { size: ref.size, bbox: ref.bbox }, bounds: { dynamic: miniB, notched: miniN }, live }, null, 2), 'utf8');

  const failed = checks.filter((c) => !c.ok);
  say(`\nPROBE_NOTCH_AFTER ${checks.length - failed.length}/${checks.length} PASS`);
  if (failed.length) say('FAILED: ' + failed.map((f) => f.name).join(' | '));

  win.destroy();
  /* Electron keeps cache files open under userData, so the temp dir may refuse
     to go away; the probe result does not depend on the cleanup. */
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* locked by Electron */ }
  if (previousState === null) fs.rmSync(STATE_PATH, { force: true });
  else fs.writeFileSync(STATE_PATH, previousState, 'utf8');
  return failed.length;
}

app.on('window-all-closed', (event) => event.preventDefault());
app.whenReady().then(async () => {
  let code = 1;
  try {
    code = await main();
  } catch (err) {
    console.log('PROBE_NOTCH_AFTER ERROR ' + String((err && err.stack) || err));
    app.exit(1);
    return;
  }
  app.exit(code ? 1 : 0);
});
