/* QA Yan - throwaway: does data-empty="true" only dim the Wave strip, or does
   it eat the wave? Gate item 5.
 *
 * Renders the music card twice from a PINNED stylesheet (git ref, temp copy -
 * src/ and dist/ are never edited): once with a lyric timeline, once with no
 * lyrics at all (which is what sets data-empty). Then reads the computed style
 * and scans the painted strip, so "dimmed" and "still there" are both numbers
 * rather than an opinion.
 */
const { app, BrowserWindow, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execSync } = require('node:child_process');

const root = __dirname;
const SHOT_DIR = path.join(root, '.superpowers', 'shots');
const STATE_PATH = path.join(root, '_qa-state.json');
const LIGHT = { r: 238, g: 241, b: 245 };
const { boundsFor } = require(path.join(root, 'dist', 'main', 'bounds.js'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (win, code) => win.webContents.executeJavaScript(code);

const MEASURE = `(() => {
  const p = document.getElementById('musicProgress');
  const cs = getComputedStyle(p);
  const wave = p.querySelector('.mp-wave');
  const track = p.querySelector('.mp-wave-track');
  const fill = p.querySelector('.mp-wave-fill');
  const b = p.getBoundingClientRect();
  const vis = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none';
  return {
    empty: p.dataset.empty,
    style: p.dataset.style,
    opacity: cs.opacity,
    rect: { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) },
    wavePresent: !!wave,
    waveVisible: vis(wave),
    trackStroke: track ? getComputedStyle(track).stroke : null,
    fillStroke: fill ? getComputedStyle(fill).stroke : null,
    pct: cs.getPropertyValue('--mp-pct').trim(),
    times: (document.querySelector('.music-times') || {}).innerText || '',
  };
})()`;

/** Peak luma per column inside the strip box, on the flattened capture.
 *  The card reference is sampled from rows just ABOVE the strip: using the
 *  darkest strip column as "background" would compare the stroke with itself. */
function stripScan(img, rect) {
  const size = img.getSize();
  const buf = img.toBitmap();
  const x0 = Math.round(rect.x);
  const x1 = Math.round(rect.x + rect.w) - 1;
  const y0 = Math.max(0, Math.round(rect.y));
  const y1 = Math.min(size.height - 1, Math.round(rect.y + rect.h) - 1);
  const lumaAt = (x, y) => {
    const i = (y * size.width + x) * 4;
    return 0.299 * buf[i + 2] + 0.587 * buf[i + 1] + 0.114 * buf[i];
  };
  const cols = [];
  for (let x = x0; x <= x1; x++) {
    let m = 0;
    for (let y = y0; y <= y1; y++) {
      const l = lumaAt(x, y);
      if (l > m) m = l;
    }
    cols.push(m);
  }
  /* Card luma: rows above the strip, same x span, median of the column values. */
  const cardVals = [];
  for (let y = Math.max(0, y0 - 10); y <= Math.max(0, y0 - 4); y++) {
    for (let x = x0; x <= x1; x++) cardVals.push(lumaAt(x, y));
  }
  cardVals.sort((a, b) => a - b);
  const card = Math.round(cardVals[Math.floor(cardVals.length / 2)] || 0);
  const peak = Math.max(...cols);
  /* The played part is only the left slice, so the right third isolates the
     track stroke - that is the bit that must survive data-empty. */
  const right = cols.slice(Math.round(cols.length * 0.66));
  const rightPeak = Math.max(...right);
  const inked = cols.filter((v) => v > card + 4).length;
  return { peak: Math.round(peak), card, rightPeak: Math.round(rightPeak),
    rightDelta: Math.round(rightPeak - card), inked, total: cols.length };
}

function flattenOver(img, bg) {
  const size = img.getSize();
  const src = img.toBitmap();
  const out = Buffer.alloc(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const a = src[i + 3] / 255;
    out[i] = Math.min(255, Math.round(src[i] + bg.b * (1 - a)));
    out[i + 1] = Math.min(255, Math.round(src[i + 1] + bg.g * (1 - a)));
    out[i + 2] = Math.min(255, Math.round(src[i + 2] + bg.r * (1 - a)));
    out[i + 3] = 255;
  }
  return nativeImage.createFromBitmap(out, { width: size.width, height: size.height });
}

app.whenReady().then(async () => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const CSS_REF = process.env.AEOLIA_CSS_REF || 'HEAD';
  const snapDir = path.join(os.tmpdir(), `aeolia-waveempty-${Date.now()}`);
  fs.cpSync(path.join(root, 'dist', 'renderer'), snapDir, { recursive: true });
  fs.writeFileSync(path.join(snapDir, 'styles.css'), execSync(`git show ${CSS_REF}:src/renderer/styles.css`, { cwd: root }));
  fs.writeFileSync(path.join(snapDir, 'index.html'), execSync(`git show ${CSS_REF}:src/renderer/index.html`, { cwd: root }));

  let previousState = null;
  try { previousState = fs.readFileSync(STATE_PATH, 'utf8'); } catch { previousState = null; }
  fs.writeFileSync(STATE_PATH, JSON.stringify({
    status: { state: 'open', accent: '#e9eef7', surface: 'Liquid glass', glassLevel: 20,
      cardWidth: 360, visibleTabs: ['music'], miniMode: 'clock', media: true,
      mediaTitle: 'Kavi Rao - Neon Harbor', meeting: false, scaleEffective: 100,
      openAction: 'music' },
    settings: { accent: '#e9eef7', surface: 'Liquid glass', glassLevel: 20, cardWidth: 360,
      visibleTabs: ['music'], islandStyle: 'dynamic', islandContent: 'clock-robot',
      barOrder: ['clock', 'cat', 'battery', 'media', 'mic'], miniMode: 'clock',
      miniTrigger: 'fullscreen', islandPosition: 'center', monitor: 'main',
      edgeMargin: 4, islandScale: 100, musicProgress: 'Wave' },
    card: { lastTab: 'music', notices: [], clips: [], sites: [], shelf: [], tasks: [] },
  }, null, 2), 'utf8');

  const openB = boundsFor('open', { islandScale: 100, monitor: 'main', islandPosition: 'center',
    edgeMargin: 4, islandStyle: 'dynamic', cardWidth: 360,
    pill: { width: 150, height: 36 }, mini: { width: 64, height: 14 }, open: { width: 360, height: 92 } });

  const win = new BrowserWindow({
    width: openB.width, height: 400, frame: false, show: false, transparent: true,
    hasShadow: false, thickFrame: false, resizable: false, movable: false,
    useContentSize: true, backgroundColor: '#00000000', paintWhenInitiallyHidden: true,
    webPreferences: { preload: path.join(root, '_qa-preload.js'), contextIsolation: true,
      nodeIntegration: false, sandbox: false, backgroundThrottling: false },
  });
  win.setMinimumSize(1, 1);
  win.setMaximumSize(4000, 4000);
  win.setBounds({ x: openB.x, y: 0, width: openB.width, height: 400 });
  win.showInactive();
  await win.loadFile(path.join(snapDir, 'index.html'));
  await sleep(340);
  await js(win, `window.probe.emit('settings', ${JSON.stringify({
    surface: 'Liquid glass', glassLevel: 20, accent: '#e9eef7', cardWidth: 360,
    visibleTabs: ['music'], miniMode: 'clock', islandScale: 100, musicProgress: 'Wave',
  })}); true`);
  await js(win, `window.probe.emit('status', ${JSON.stringify({
    state: 'open', openAction: 'music', visibleTabs: ['music'], media: true,
    mediaTitle: 'Kavi Rao - Neon Harbor', miniMode: 'clock', surface: 'Liquid glass',
    glassLevel: 20, accent: '#e9eef7', meeting: false, scaleEffective: 100,
  })}); true`);
  await sleep(400);
  await js(win, `document.querySelector('.tab[data-tab="music"]').click(); true`);
  await sleep(320);
  await js(win, `window.probe.emit('lyrics', { title: 'Kavi Rao - Neon Harbor', lrc: '[00:01.00] satu\\n[00:04.00] dua' }); true`);
  await sleep(1100);
  const fit = async () => {
    const h = await js(win, `(() => { const c = window.probe.calls().filter((x) => x.kind === 'setCardHeight');
      return c.length ? c[c.length - 1].payload : null; })()`);
    if (typeof h === 'number' && h > 40) {
      win.setBounds({ x: openB.x, y: 0, width: openB.width, height: Math.round(h) });
      await sleep(320);
    }
  };
  await fit();
  await win.capturePage();
  await sleep(200);

  const withLyric = await js(win, MEASURE);
  const shotA = flattenOver(await win.capturePage(), LIGHT);
  fs.writeFileSync(path.join(SHOT_DIR, 'wave-empty-false.png'), shotA.toPNG());
  const scanA = stripScan(shotA, withLyric.rect);

  /* No lyric at all -> hasLyric false -> data-empty="true". */
  await js(win, `window.probe.emit('lyrics', { title: '', lrc: '' }); true`);
  await sleep(900);
  await win.capturePage();
  await sleep(200);
  const noLyric = await js(win, MEASURE);
  const shotB = flattenOver(await win.capturePage(), LIGHT);
  fs.writeFileSync(path.join(SHOT_DIR, 'wave-empty-true.png'), shotB.toPNG());
  const scanB = stripScan(shotB, noLyric.rect);

  const checks = [];
  const check = (name, ok, detail) => {
    checks.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  :: ${detail}`);
  };
  console.log(`dengan lirik: ${JSON.stringify({ empty: withLyric.empty, opacity: withLyric.opacity, pct: withLyric.pct, ...scanA })}`);
  console.log(`tanpa lirik : ${JSON.stringify({ empty: noLyric.empty, opacity: noLyric.opacity, pct: noLyric.pct, ...scanB })}`);

  check('kontrol: dengan lirik data-empty="false" dan strip penuh (opacity 1)',
    withLyric.empty === 'false' && Number(withLyric.opacity) === 1 && scanA.peak > 180,
    JSON.stringify({ empty: withLyric.empty, opacity: withLyric.opacity, peak: scanA.peak }));

  check('data-empty="true" saat tanpa lirik',
    noLyric.empty === 'true', JSON.stringify({ empty: noLyric.empty, pct: noLyric.pct }));

  check('data-empty meredupkan strip tepat 0,45 (bukan 0, bukan 1)',
    Math.abs(Number(noLyric.opacity) - 0.45) <= 0.01,
    JSON.stringify({ opacity: noLyric.opacity }));

  check('gelombang TIDAK dihilangkan (SVG masih ada & terlihat)',
    noLyric.wavePresent === true && noLyric.waveVisible === true,
    JSON.stringify({ present: noLyric.wavePresent, visible: noLyric.waveVisible, style: noLyric.style }));

  check('goresan track masih terlukis saat data-empty (tidak hilang)',
    scanB.rightDelta > 4 && scanB.inked >= Math.round(scanB.total * 0.5),
    JSON.stringify({ rightPeak: scanB.rightPeak, card: scanB.card, delta: scanB.rightDelta,
      inked: scanB.inked, total: scanB.total }));

  check('track ikut meredup (bukan hanya fill)',
    scanA.rightDelta > 4 && scanB.rightDelta < scanA.rightDelta,
    JSON.stringify({ deltaPenuh: scanA.rightDelta, deltaRedup: scanB.rightDelta,
      penuh: scanA.rightPeak, redup: scanB.rightPeak, card: scanA.card }));

  check('puncak terang turun ke ~0,45 dari strip penuh',
    scanB.peak < scanA.peak * 0.62 && scanB.peak > scanA.peak * 0.3,
    JSON.stringify({ penuh: scanA.peak, redup: scanB.peak, rasio: +(scanB.peak / scanA.peak).toFixed(2) }));

  const failed = checks.filter((c) => !c.ok);
  console.log(`\nPROBE_WAVE_EMPTY ${checks.length - failed.length}/${checks.length} PASS`);

  win.destroy();
  try { fs.rmSync(snapDir, { recursive: true, force: true }); } catch { /* electron holds files */ }
  if (previousState === null) fs.rmSync(STATE_PATH, { force: true });
  else fs.writeFileSync(STATE_PATH, previousState, 'utf8');
  app.exit(failed.length ? 1 : 0);
});
