/* QA Yan - visual proof for the user's outstanding asks (throwaway probe,
   NOT part of the product). Renders the REAL compiled renderer
   (dist/renderer/index.html) in a transparent BrowserWindow placed where the
   REAL boundsFor() puts it, drives the real preload seam, then measures the
   DOM and captures PNGs into .superpowers/shots/.

   The captures are flattened over a light wallpaper tone because the user
   asked for proof "on a light background": a dark leftover card or a stray
   banner would be impossible to miss there. The untouched alpha capture is
   saved beside each shot as <name>-raw.png.

   Run: env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe _probe-asks.js
*/
const { app, BrowserWindow, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execSync } = require('node:child_process');

const root = __dirname;
const SHOT_DIR = path.join(root, '.superpowers', 'shots');
const STATE_PATH = path.join(root, '_qa-state.json');
const { boundsFor } = require(path.join(root, 'dist', 'main', 'bounds.js'));

/* Light wallpaper tone the shots are composited on (#eef1f5). */
const LIGHT = { r: 238, g: 241, b: 245 };

const ALL_TABS = [
  'web', 'notifications', 'shelf', 'clipboard', 'music', 'today', 'sholat',
  'timer', 'reminders', 'water', 'capture', 'controls', 'deck', 'calls',
];

/* Mirrors the defaults in src/main/settings.ts so the probe uses the product
   geometry instead of hand made numbers. */
const BASE_SETTINGS = {
  islandScale: 100, monitor: 'main', islandPosition: 'center', edgeMargin: 4,
  islandStyle: 'dynamic', cardWidth: 360,
  pill: { width: 150, height: 36 },
  mini: { width: 150, height: 32 },
  open: { width: 360, height: 200 },
};

/* Baseline handed to _qa-preload.js through _qa-state.json. The original file
   is restored when the probe ends, so running the suites afterwards is safe. */
const BASELINE = {
  status: {
    state: 'mini', accent: '#e9eef7', surface: 'Black', cardWidth: 360,
    visibleTabs: [...ALL_TABS], miniMode: 'clock', meetingMicButton: true,
    media: false, mediaTitle: '', word: false, hiddenUntilHover: false,
    openAction: 'last', meeting: false, scaleEffective: 100,
  },
  settings: {
    accent: '#e9eef7', surface: 'Black', cardWidth: 360, visibleTabs: [...ALL_TABS],
    islandStyle: 'dynamic', islandContent: 'clock-robot',
    barOrder: ['clock', 'cat', 'battery', 'media', 'mic'],
    catGreeting: true, catIdleCenter: true, miniMode: 'clock',
    islandPosition: 'center', monitor: 'main', edgeMargin: 4, islandScale: 100,
    glassLevel: 55, meetingAuto: false, meetingMicButton: true,
  },
  card: { lastTab: 'music', notices: [], clips: [], sites: [], shelf: [], tasks: [] },
};

const results = [];
const metricsLog = {};
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  :: ' + detail}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (win, code) => win.webContents.executeJavaScript(code);

function makeWindow(width, height) {
  return new BrowserWindow({
    width, height, frame: false, show: false, transparent: true, hasShadow: false,
    useContentSize: true, backgroundColor: '#00000000', paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: path.join(root, '_qa-preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
      backgroundThrottling: false,
    },
  });
}

/** Composite the transparent capture onto the light wallpaper tone. */
function flattenOverLight(img) {
  const size = img.getSize();
  const src = img.toBitmap();            // BGRA, premultiplied
  const out = Buffer.alloc(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const a = src[i + 3] / 255;
    out[i] = Math.min(255, Math.round(src[i] + LIGHT.b * (1 - a)));
    out[i + 1] = Math.min(255, Math.round(src[i + 1] + LIGHT.g * (1 - a)));
    out[i + 2] = Math.min(255, Math.round(src[i + 2] + LIGHT.r * (1 - a)));
    out[i + 3] = 255;
  }
  return nativeImage.createFromBitmap(out, { width: size.width, height: size.height });
}

async function shot(win, name) {
  const img = await win.capturePage();
  fs.writeFileSync(path.join(SHOT_DIR, `${name}.png`), flattenOverLight(img).toPNG());
  fs.writeFileSync(path.join(SHOT_DIR, `${name}-raw.png`), img.toPNG());
  return { img, path: path.join(SHOT_DIR, `${name}.png`), size: img.getSize() };
}

/* Where does the painted progress actually stop? Scans every column of the
   progress box and takes the brightest pixel in it (the stroke wobbles, so a
   single row has gaps). Used to check the Wave mask against the DOM value
   instead of trusting style.width on an element that is display:none. */
function paintedEdge(img, rect) {
  const size = img.getSize();
  const buf = img.toBitmap();                 // BGRA
  const x0 = Math.round(rect.x);
  const x1 = Math.round(rect.x + rect.w) - 1;
  const y0 = Math.max(0, Math.round(rect.y));
  const y1 = Math.min(size.height - 1, Math.round(rect.y + rect.h) - 1);
  const colMax = [];
  for (let x = x0; x <= x1; x++) {
    let m = 0;
    for (let y = y0; y <= y1; y++) {
      const i = (y * size.width + x) * 4;
      const luma = 0.299 * buf[i + 2] + 0.587 * buf[i + 1] + 0.114 * buf[i];
      if (luma > m) m = luma;
    }
    colMax.push(m);
  }
  const hi = Math.max(...colMax);
  const lo = Math.min(...colMax);
  const mid = (hi + lo) / 2;
  let edge = -1;
  for (let i = 0; i < colMax.length; i++) if (colMax[i] < mid) { edge = i; break; }
  const edgeX = edge < 0 ? x1 : x0 + edge;
  return {
    box: { x0, x1, y0, y1 },
    bright: Math.round(hi), dim: Math.round(lo), threshold: Math.round(mid),
    edgeX,
    pct: +(((edgeX - x0) / rect.w) * 100).toFixed(2),
    noEdge: edge < 0,
  };
}

/** Everything the notch claims to show, read from the live DOM. */
const NOTCH = `(() => {
  const island = document.getElementById('island');
  const clock = document.getElementById('miniClock');
  const date = document.getElementById('miniDate');
  const catSlot = document.getElementById('miniCatSlot');
  const banner = document.getElementById('banner');
  const mic = document.getElementById('micPill');
  const flat = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
  /* innerText falls back to textContent for an element that is not rendered,
     so "is it on screen" has to be asked separately. */
  const rendered = (el) => (el && el.getClientRects().length ? flat(el.innerText) : '');
  const shown = (el) => {
    if (!el) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05
      && el.getBoundingClientRect().width > 0;
  };
  return {
    state: island.dataset.state, miniMode: island.dataset.miniMode,
    islandText: flat(island.innerText),
    clockText: flat(clock.textContent), clockShown: shown(clock),
    dateShown: shown(date), catShown: shown(catSlot),
    bannerHidden: banner.hidden, bannerDisplay: getComputedStyle(banner).display,
    bannerText: rendered(banner), bannerRawText: flat(banner.textContent),
    micHidden: mic.hidden, micDisplay: getComputedStyle(mic).display,
    micText: rendered(mic), micRawText: flat(mic.textContent),
    size: [window.innerWidth, window.innerHeight],
  };
})()`;

/** Music card geometry, so the layout claims are numbers and not opinions. */
const MUSIC = `(() => {
  const card = document.getElementById('musicCard');
  const art = document.getElementById('musicArt');
  const title = document.getElementById('musicTitle');
  const sub = document.getElementById('musicSub');
  const now = card.querySelector('.music-now');
  const transport = card.querySelector('.music-transport');
  const progress = document.getElementById('musicProgress');
  const times = card.querySelector('.music-times');
  const vol = card.querySelector('.music-volrow');
  const panel = document.querySelector('.panel.active');
  const box = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) };
  };
  const flat = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
  return {
    activePanel: panel ? panel.dataset.panel : null,
    playing: card.dataset.playing,
    title: flat(title.textContent), sub: flat(sub.textContent),
    titleShown: getComputedStyle(title).display !== 'none',
    artClass: art.className,
    artGradient: getComputedStyle(art).backgroundImage.slice(0, 120),
    artBadge: getComputedStyle(art, '::after').content,
    timesText: flat(times.innerText),
    fillWidth: document.getElementById('musicFill').style.width,
    fillColor: getComputedStyle(document.getElementById('musicFill')).backgroundColor,
    fillDisplay: getComputedStyle(document.getElementById('musicFill')).display,
    progressStyle: progress.dataset.style,
    wavePresent: !!progress.querySelector('.mp-wave'),
    wavePct: (() => {
      const wrap = progress.querySelector('.mp-wave-fillwrap');
      return wrap ? getComputedStyle(wrap).getPropertyValue('--mp-pct').trim() : null;
    })(),
    waveMask: (() => {
      const wrap = progress.querySelector('.mp-wave-fillwrap');
      if (!wrap) return null;
      const cs = getComputedStyle(wrap);
      return (cs.webkitMaskImage || cs.maskImage || '').slice(0, 90);
    })(),
    waveWrap: (() => {
      const wrap = progress.querySelector('.mp-wave-fillwrap');
      return wrap ? box(wrap) : null;
    })(),
    lyricLines: flat(document.getElementById('lyricLines').innerText).slice(0, 60),
    lyricState: flat(document.getElementById('lyricState').textContent),
    rows: { card: box(card), now: box(now), title: box(title), sub: box(sub),
      transport: box(transport), progress: box(progress), times: box(times), vol: box(vol) },
    panelOverflow: panel ? panel.scrollHeight - panel.clientHeight : null,
    size: [window.innerWidth, window.innerHeight],
  };
})()`;

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  /* The preload reads the baseline synchronously, so it has to be on disk
     before the first BrowserWindow is created. */
  let previousState = null;
  try { previousState = fs.readFileSync(STATE_PATH, 'utf8'); } catch { previousState = null; }
  fs.writeFileSync(STATE_PATH, JSON.stringify(BASELINE, null, 2), 'utf8');

  const miniBounds = boundsFor('mini', BASE_SETTINGS);
  /* Pin the CSS and markup to a commit. dist/renderer is a shared working
     directory: another seat rebuilding it mid-run would silently swap the
     stylesheet under the capture, and these PNGs are meant to prove a specific
     revision. Compiled JS still comes from dist. */
  const REF = process.env.AEOLIA_ASKS_REF || 'HEAD';
  const snapDir = path.join(os.tmpdir(), `aeolia-asks-${Date.now()}`);
  fs.cpSync(path.join(root, 'dist', 'renderer'), snapDir, { recursive: true });
  const gitShow = (p) => execSync(`git show ${REF}:${p}`, { cwd: root });
  fs.writeFileSync(path.join(snapDir, 'styles.css'), gitShow('src/renderer/styles.css'));
  fs.writeFileSync(path.join(snapDir, 'index.html'), gitShow('src/renderer/index.html'));
  const hashOf = (p) => require('node:crypto').createHash('sha1')
    .update(fs.readFileSync(p)).digest('hex').slice(0, 12);
  metricsLog.provenance = {
    ref: REF,
    gitHead: execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim(),
    snapshotDir: snapDir,
    stylesCss: hashOf(path.join(snapDir, 'styles.css')),
    indexHtml: hashOf(path.join(snapDir, 'index.html')),
    rendererJs: hashOf(path.join(snapDir, 'renderer.js')),
  };
  const win = makeWindow(miniBounds.width, miniBounds.height);
  await win.loadFile(path.join(snapDir, 'index.html'));
  /* elementFromPoint / real paint need a rendered window; showInactive never
     takes focus from the user. */
  win.showInactive();
  win.setBounds(miniBounds);
  await sleep(420);

  const status = (extra) => js(win, `window.probe.emit('status', ${JSON.stringify(extra)}); true`);
  const settings = (extra) => js(win, `window.probe.emit('settings', ${JSON.stringify(extra)}); true`);

  /* ---------------- ask 1: notch shows ONLY the clock ---------------- */
  await settings({ miniMode: 'clock' });
  await status({ state: 'mini', miniMode: 'clock', meeting: false, media: false, mediaTitle: '', scaleEffective: 100 });
  await sleep(420);
  const clockShot = await shot(win, 'asks-notch-clock');
  const clockReport = await js(win, NOTCH);
  metricsLog.notchClock = clockReport;
  check('asks-notch-clock: state mini + miniMode clock',
    clockReport.state === 'mini' && clockReport.miniMode === 'clock',
    JSON.stringify({ state: clockReport.state, miniMode: clockReport.miniMode }));
  check('asks-notch-clock: jam tampil (HH:MM)',
    clockReport.clockShown === true && /^\d{1,2}:\d{2}$/.test(clockReport.clockText),
    JSON.stringify(clockReport.clockText));
  check('asks-notch-clock: hanya jam di notch (tanpa banner/meeting/teks lain)',
    clockReport.islandText === clockReport.clockText
      && clockReport.bannerText === '' && clockReport.micText === '',
    JSON.stringify({ islandText: clockReport.islandText, bannerText: clockReport.bannerText, micText: clockReport.micText }));
  check('asks-notch-clock: banner & micPill tidak terlukis',
    clockReport.bannerHidden === true && clockReport.bannerDisplay === 'none'
      && clockReport.micDisplay === 'none',
    JSON.stringify({ banner: clockReport.bannerDisplay, mic: clockReport.micDisplay }));
  check('asks-notch-clock: kucing TIDAK tampil di mode clock',
    clockReport.catShown === false && clockReport.dateShown === false,
    JSON.stringify({ cat: clockReport.catShown, date: clockReport.dateShown }));

  /* ---------------- ask 2: notch shows ONLY the cat ---------------- */
  await settings({ miniMode: 'cat' });
  await status({ state: 'mini', miniMode: 'cat' });
  await sleep(420);
  await shot(win, 'asks-notch-cat');
  const catReport = await js(win, NOTCH);
  metricsLog.notchCat = catReport;
  check('asks-notch-cat: miniMode cat -> kucing tampil',
    catReport.miniMode === 'cat' && catReport.catShown === true, JSON.stringify({ mode: catReport.miniMode, cat: catReport.catShown }));
  check('asks-notch-cat: jam & tanggal disembunyikan',
    catReport.clockShown === false && catReport.dateShown === false,
    JSON.stringify({ clock: catReport.clockShown, date: catReport.dateShown }));
  check('asks-notch-cat: tidak ada teks sama sekali di notch',
    catReport.islandText === '' && catReport.bannerText === '' && catReport.micText === '',
    JSON.stringify({ islandText: catReport.islandText }));

  /* ---------------- ask 3: music card ---------------- */
  const openBase = boundsFor('open', BASE_SETTINGS);
  win.setBounds({ x: openBase.x, y: openBase.y, width: openBase.width, height: openBase.height });
  await settings({ miniMode: 'clock', visibleTabs: ['music'] });
  await status({ state: 'open', miniMode: 'clock', visibleTabs: ['music'], media: false, mediaTitle: '', scaleEffective: 100 });
  await sleep(320);
  await js(win, `document.querySelector('.tab[data-tab="music"]').click(); true`);
  await sleep(260);
  await js(win, `window.probe.emit('lyrics', { title: 'Kavi Rao - Neon Harbor', lrc: '[00:01.00] satu\\n[00:04.00] dua' }); true`);
  await status({ state: 'open', media: true, mediaTitle: 'Kavi Rao - Neon Harbor' });
  await sleep(1400);
  /* The renderer asks the main process for the card height; use the value it
     measured so the shot shows the card the app would actually draw. */
  const cardHeight = await js(win, `(() => { const c = window.probe.calls().filter((x) => x.kind === 'setCardHeight');
    return c.length ? c[c.length - 1].payload : null; })()`);
  if (typeof cardHeight === 'number' && cardHeight > 0) {
    win.setBounds({ x: openBase.x, y: openBase.y, width: openBase.width, height: Math.round(cardHeight) });
  }
  await sleep(500);
  const musicShot = await shot(win, 'asks-music');
  const musicReport = await js(win, MUSIC);
  metricsLog.music = { ...musicReport, cardHeight };
  const rows = musicReport.rows;
  check('asks-music: panel musik aktif, judul & artis terpisah dua baris',
    musicReport.activePanel === 'music' && musicReport.title === 'Neon Harbor'
      && musicReport.sub === 'Kavi Rao' && rows.sub.y >= rows.title.y + rows.title.h - 1,
    JSON.stringify({ panel: musicReport.activePanel, title: musicReport.title, sub: musicReport.sub }));
  check('asks-music: album art gradien + badge not',
    /g[0-5]/.test(musicReport.artClass) && musicReport.artGradient.includes('gradient')
      && musicReport.artBadge.includes('\u266A'),
    JSON.stringify({ artClass: musicReport.artClass, badge: musicReport.artBadge, bg: musicReport.artGradient.slice(0, 60) }));
  check('asks-music: transport di kanan baris judul (bukan baris sendiri)',
    rows.transport && rows.now && rows.transport.x > rows.title.x
      && Math.abs((rows.transport.y + rows.transport.h / 2) - (rows.now.y + rows.now.h / 2)) <= 3
      && Math.abs((rows.transport.x + rows.transport.w) - (rows.now.x + rows.now.w)) <= 2,
    JSON.stringify({ now: rows.now, transport: rows.transport }));
  check('asks-music: strip progres terisi dari timeline lirik (nilai data)',
    rows.progress && rows.progress.w > 100 && musicReport.fillWidth !== '0%'
      && musicReport.fillWidth !== '',
    JSON.stringify({ fill: musicReport.fillWidth, style: musicReport.progressStyle, w: rows.progress && rows.progress.w }));

  /* The Wave style paints an SVG line masked to --mp-pct and hides #musicFill,
     so style.width alone would "pass" while nothing is drawn. Measure both the
     DOM mask and the pixels that actually landed on screen. */
  const wavePct = parseFloat(musicReport.wavePct);
  const dataPct = parseFloat(musicReport.fillWidth);
  const waveShot = flattenOverLight(musicShot.img);
  const edge = rows.progress ? paintedEdge(waveShot, rows.progress) : null;
  metricsLog.wavePaint = { wavePct: musicReport.wavePct, dataPct, edge };
  check('asks-music: Wave dilukis SVG, #musicFill tidak dilukis',
    musicReport.progressStyle === 'Wave' && musicReport.wavePresent === true
      && musicReport.fillDisplay === 'none' && !!musicReport.waveWrap,
    JSON.stringify({ style: musicReport.progressStyle, svg: musicReport.wavePresent,
      fillDisplay: musicReport.fillDisplay, wrap: musicReport.waveWrap }));
  /* The mask must be a hard cut at --mp-pct: both gradient stops carry the same
     percentage. A soft fade would show a blurred "played" edge and a wrong
     percentage would desync the line from the lyric timeline. */
  const maskStops = (musicReport.waveMask || '').match(/[\d.]+%/g) || [];
  const maskCut = maskStops.length >= 2
    && maskStops.every((s) => Math.abs(parseFloat(s) - wavePct) <= 0.1);
  check('asks-music: mask Wave memakai --mp-pct = lebar data (#musicFill)',
    Number.isFinite(wavePct) && Number.isFinite(dataPct)
      && Math.abs(wavePct - dataPct) <= 0.5
      && /linear-gradient/.test(musicReport.waveMask || '') && maskCut,
    JSON.stringify({ pct: musicReport.wavePct, data: musicReport.fillWidth,
      stops: maskStops, mask: musicReport.waveMask }));
  check('asks-music: piksel gelombang berhenti di --mp-pct (+-2%)',
    !!edge && !edge.noEdge && Math.abs(edge.pct - wavePct) <= 2,
    JSON.stringify({ measured: edge && edge.pct, dom: wavePct,
      edgeX: edge && edge.edgeX, box: edge && edge.box, bright: edge && edge.bright, dim: edge && edge.dim }));
  check('asks-music: waktu kiri + sisa waktu kanan',
    /^0:\d{2}\s+-\d:\d{2}$/.test(musicReport.timesText),
    JSON.stringify(musicReport.timesText));
  check('asks-music: volume di baris sendiri di bawah waktu',
    rows.vol && rows.times && rows.vol.y >= rows.times.y + rows.times.h - 1,
    JSON.stringify({ times: rows.times, vol: rows.vol }));
  check('asks-music: kartu tidak terpotong (panel tanpa overflow)',
    musicReport.panelOverflow !== null && musicReport.panelOverflow <= 1,
    JSON.stringify({ overflow: musicReport.panelOverflow, height: cardHeight, window: musicReport.size }));
  metricsLog.musicShotSize = musicShot.size;

  /* ---------------- ask 4: notice while in the notch ---------------- */
  win.setBounds(miniBounds);
  await settings({ miniMode: 'clock' });
  await status({ state: 'mini', miniMode: 'clock', meeting: false, media: false, mediaTitle: '' });
  await sleep(360);
  await js(win, `window.probe.emit('card', { notices: [{ id: 'qa1', app: 'Telegram', title: 'Obet', body: 'halo', at: Date.now() }] }); true`);
  await sleep(900);
  await shot(win, 'asks-banner-mini');
  const bannerReport = await js(win, NOTCH);
  metricsLog.bannerMini = bannerReport;
  check('asks-banner-mini: banner TIDAK tampil di notch (teks Obet/halo absen)',
    bannerReport.state === 'mini' && bannerReport.bannerHidden === true
      && bannerReport.bannerDisplay === 'none'
      && !bannerReport.islandText.includes('Obet') && !bannerReport.islandText.includes('halo'),
    JSON.stringify({ state: bannerReport.state, banner: bannerReport.bannerDisplay, islandText: bannerReport.islandText }));
  check('asks-banner-mini: notch tetap hanya jam',
    bannerReport.islandText === bannerReport.clockText && bannerReport.clockShown === true,
    JSON.stringify(bannerReport.islandText));

  /* Meeting in the notch: the capsules belong to the pill state only, so the
     notch must not show Mic/Cam text either. */
  await status({ state: 'mini', meeting: true, meetingMicButton: true });
  await sleep(700);
  const meetMini = await js(win, NOTCH);
  metricsLog.meetingMini = meetMini;
  check('asks-banner-mini: rapat saat notch tidak memunculkan teks Mic/Cam',
    meetMini.micDisplay === 'none' && !meetMini.islandText.includes('Mic')
      && !meetMini.islandText.includes('Cam'),
    JSON.stringify({ mic: meetMini.micDisplay, islandText: meetMini.islandText }));

  fs.writeFileSync(path.join(SHOT_DIR, 'asks-metrics.json'), JSON.stringify(metricsLog, null, 2), 'utf8');
  win.destroy();
  if (previousState === null) fs.rmSync(STATE_PATH, { force: true });
  else fs.writeFileSync(STATE_PATH, previousState, 'utf8');
}

app.on('window-all-closed', (event) => event.preventDefault());

app.whenReady().then(async () => {
  try {
    await main();
  } catch (err) {
    check('probe selesai tanpa exception', false, String((err && err.stack) || err));
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\nPROBE_ASKS ${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) console.log('FAILED: ' + failed.map((f) => f.name).join(' | '));
  app.exit(failed.length ? 1 : 0);
});
