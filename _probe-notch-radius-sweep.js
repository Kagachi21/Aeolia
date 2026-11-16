/* QA Yan - throwaway: does radius 8 match the reference corner curve better
   than 5? Sweeps 5/6/7/8 px by appending an override to a PINNED COPY of the
   stylesheet (temp dir only - src/ and dist/ are never touched), then measures
   the painted corner per row with the alpha >= 16 ruler the gate asked for.
 *
 * Reference rows y10..y13 = 1 / 2 / 3 / 5 px (measured from the notch's own
 * left edge on the user's screenshot).
 */
const { app, BrowserWindow, nativeImage, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execSync } = require('node:child_process');

const root = __dirname;
const SHOT_DIR = path.join(root, '.superpowers', 'shots');
const STATE_PATH = path.join(root, '_qa-state.json');
const REF_SERIES = { 10: 1, 11: 2, 12: 3, 13: 5 };
const RADII = [5, 6, 7, 8];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (win, code) => win.webContents.executeJavaScript(code);

/* alpha >= 16 means "something was painted here", which is the geometric
   coverage of the corner. The near-black threshold (alpha > 128) shrinks it. */
function paintedRows(img) {
  const { width, height } = img.getSize();
  const buf = img.toBitmap();
  const rows = [];
  for (let y = 0; y < height; y++) {
    let l = -1; let r = -1; let n = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (buf[i + 3] >= 16) { n++; if (l < 0) l = x; r = x; }
    }
    rows.push({ y, l, r, n });
  }
  return { width, height, rows };
}

app.whenReady().then(async () => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const CSS_REF = process.env.AEOLIA_CSS_REF || 'HEAD';
  const snapDir = path.join(os.tmpdir(), `aeolia-radius-${Date.now()}`);
  fs.cpSync(path.join(root, 'dist', 'renderer'), snapDir, { recursive: true });
  const base = execSync(`git show ${CSS_REF}:src/renderer/styles.css`, { cwd: root });
  fs.writeFileSync(path.join(snapDir, 'index.html'),
    execSync(`git show ${CSS_REF}:src/renderer/index.html`, { cwd: root }));

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

  const display = screen.getPrimaryDisplay();
  const win = new BrowserWindow({
    width: 64, height: 39, frame: false, show: false, transparent: true, hasShadow: false,
    thickFrame: false, resizable: false, movable: false, useContentSize: true,
    backgroundColor: '#00000000', paintWhenInitiallyHidden: true,
    webPreferences: { preload: path.join(root, '_qa-preload.js'), contextIsolation: true,
      nodeIntegration: false, sandbox: false, backgroundThrottling: false },
  });
  win.setMinimumSize(1, 1);
  win.setMaximumSize(4000, 4000);
  win.setBounds({ x: 928, y: display.bounds.y, width: 64, height: 39 });
  win.showInactive();
  await sleep(300);

  const out = [];
  for (const radius of RADII) {
    fs.writeFileSync(path.join(snapDir, 'styles.css'),
      `${base}\n#island[data-state="mini"] { border-radius: 0 0 ${radius}px ${radius}px !important; }\n`);
    await win.loadFile(path.join(snapDir, 'index.html'));
    await sleep(260);
    await js(win, `window.probe.emit('settings', ${JSON.stringify({
      visibleTabs: ['web'], miniMode: 'clock', islandScale: 100, islandStyle: 'dynamic',
      edgeMargin: 4, islandPosition: 'center', monitor: 'main',
    })}); true`);
    await js(win, `window.probe.emit('status', ${JSON.stringify({
      state: 'mini', miniMode: 'clock', surface: 'Black', meeting: false, media: false,
      mediaTitle: '', hiddenUntilHover: false, scaleEffective: 100, visibleTabs: ['web'],
    })}); true`);
    await sleep(420);
    await win.capturePage();
    await sleep(160);
    const img = await win.capturePage();
    fs.writeFileSync(path.join(SHOT_DIR, `radius-sweep-${radius}.png`), img.toPNG());
    const px = paintedRows(img);
    const got = {};
    for (const y of [10, 11, 12, 13]) {
      const row = px.rows[y];
      got[y] = row && row.l >= 0 ? row.l : null;
    }
    let err = 0;
    for (const y of [10, 11, 12, 13]) err += Math.abs((got[y] == null ? 99 : got[y]) - REF_SERIES[y]);
    out.push({ radius, got, err });
    console.log(`radius ${radius}px  y10..y13 = ${[10, 11, 12, 13].map((y) => got[y]).join('/')}  `
      + `vs acuan 1/2/3/5  total selisih ${err} px  (alpha>=16)`);
  }

  const best = out.slice().sort((a, b) => a.err - b.err)[0];
  console.log(`\nTERBAIK: radius ${best.radius}px, selisih ${best.err} px`);
  for (const r of out) console.log(`  ${r.radius}px -> ${r.err} px`);

  win.destroy();
  try { fs.rmSync(snapDir, { recursive: true, force: true }); } catch { /* electron holds files */ }
  if (previousState === null) fs.rmSync(STATE_PATH, { force: true });
  else fs.writeFileSync(STATE_PATH, previousState, 'utf8');
  app.exit(0);
});
