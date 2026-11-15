/* Kou - proof for the dynamic album colour music card.
   A real iTunes lookup runs in the main process, its three hex colours are
   pushed through the same IPC seam the app uses, and the resulting CSSOM
   variables, computed background and text contrast are all measured from the
   painted window. Fallback (unknown song, offline, plain setting) and the
   stale-title guard are exercised with the same renderer instance.

   Run: env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe _probe-musicbg.js
*/
const electron = require('electron');
const { app, BrowserWindow, nativeImage, screen } = electron;
const path = require('node:path');
const fs = require('node:fs');

const root = __dirname;
const SHOT_DIR = path.join(root, '.superpowers', 'shots');
const { boundsFor } = require(path.join(root, 'dist', 'main', 'bounds.js'));
const colors = require(path.join(root, 'dist', 'main', 'musicColors.js'));

const CARD = { width: 420, height: 92 };
const REAL_TRACK = 'Billie Eilish - bad guy';
const REAL_TRACK_2 = 'Dua Lipa - Levitating';
const FAKE_TRACK = 'Kavi Rao - Neon Harbor';
const LRC = '[00:00.00] satu\n[00:04.00] dua\n[00:08.00] tiga';
const BACKDROPS = ['light', 'dark', 'busy'];

const results = [];
const report = { palette: {}, contrast: {}, guards: {} };
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  :: ' + detail}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function settingsFor() {
  return {
    islandScale: 100, monitor: 'main', islandPosition: 'center', edgeMargin: 4,
    islandStyle: 'dynamic', cardWidth: CARD.width,
    pill: { width: 150, height: 36 }, mini: { width: 64, height: 14 },
    open: { width: CARD.width, height: CARD.height },
  };
}

/* ------------------------------------------------------------- pixel tools */
function backdrop(kind, w, h) {
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const t = y / Math.max(1, h - 1);
      let r; let g; let b;
      if (kind === 'light') { r = 247 - 15 * t; g = 248 - 14 * t; b = 250 - 12 * t; }
      else if (kind === 'dark') { r = 15 + 12 * t; g = 17 + 14 * t; b = 20 + 16 * t; }
      else {
        const cell = (Math.floor(x / 8) + Math.floor(y / 8)) % 2;
        r = cell ? 220 - 60 * t : 30 + 40 * t;
        g = cell ? 90 + 90 * t : 180 - 40 * t;
        b = cell ? 60 + 120 * (1 - t) : 210 - 30 * t;
      }
      const i = (y * w + x) * 4;
      buf[i] = Math.round(b); buf[i + 1] = Math.round(g); buf[i + 2] = Math.round(r); buf[i + 3] = 255;
    }
  }
  return buf;
}

function compositeOver(img, kind) {
  const size = img.getSize();
  const src = img.toBitmap();
  const dst = backdrop(kind, size.width, size.height);
  const out = Buffer.alloc(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const a = src[i + 3] / 255;
    out[i] = Math.min(255, Math.round(src[i] + dst[i] * (1 - a)));
    out[i + 1] = Math.min(255, Math.round(src[i + 1] + dst[i + 1] * (1 - a)));
    out[i + 2] = Math.min(255, Math.round(src[i + 2] + dst[i + 2] * (1 - a)));
    out[i + 3] = 255;
  }
  return nativeImage.createFromBitmap(out, { width: size.width, height: size.height });
}

const hex = (c) => `#${[c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const parseRgb = (css) => {
  const s = String(css || '');
  const m = /rgba?\(([^)]+)\)/.exec(s);
  if (m) {
    const p = m[1].split(',').map((v) => Number(v.trim()));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  const c = /color\(srgb\s+([^)]+)\)/.exec(s);
  if (c) {
    const p = c[1].trim().split(/[\s/]+/).map((v) => Number(v));
    return { r: Math.round(p[0] * 255), g: Math.round(p[1] * 255), b: Math.round(p[2] * 255), a: 1 };
  }
  return null;
};
const lum = (c) => {
  const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
};
const ratio = (a, b) => +((Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)).toFixed(2);
const medianOf = (v) => {
  if (!v.length) return 0;
  const s = v.slice().sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/** Ring median + brightest 5% ring pixel, the same ruler as the glass audit. */
function textPixelContrast(img, rect, scale, textCss) {
  const size = img.getSize();
  const bmp = img.toBitmap();
  const x0 = Math.round(rect.x * scale);
  const y0 = Math.round(rect.y * scale);
  const x1 = Math.round((rect.x + rect.w) * scale);
  const y1 = Math.round((rect.y + rect.h) * scale);
  const ring = [];
  const glyph = [];
  for (let y = y0 - 5; y <= y1 + 5; y += 1) {
    for (let x = x0 - 5; x <= x1 + 5; x += 1) {
      if (y < 0 || x < 0 || y >= size.height || x >= size.width) continue;
      const i = (y * size.width + x) * 4;
      if (bmp[i + 3] < 200) continue;
      const p = { r: bmp[i + 2], g: bmp[i + 1], b: bmp[i] };
      if (y >= y0 && y < y1 && x >= x0 && x < x1) glyph.push(p); else ring.push(p);
    }
  }
  const surface = {
    r: medianOf(ring.map((p) => p.r)), g: medianOf(ring.map((p) => p.g)),
    b: medianOf(ring.map((p) => p.b)),
  };
  ring.sort((a, b) => lum(a) - lum(b));
  const worstSurface = ring.length ? ring[Math.floor(ring.length * 0.95)] : surface;
  const ink = parseRgb(textCss);
  if (!ink || ring.length < 150) return { surface: hex(surface), ring: ring.length, median: null, worst: null };
  return {
    surface: hex(surface), ring: ring.length,
    median: ratio(ink, surface), worst: ratio(ink, worstSurface),
  };
}

/** Mean per-pixel chroma = max(R,G,B)-min(R,G,B) over the card body, the same
    ruler used to reject the first (washed-out) attempt. A card painted as a
    neutral dark panel scores <20; an album-coloured card scores >=55. */
function cardChroma(img, rect, scale) {
  const size = img.getSize();
  const bmp = img.toBitmap();
  const x0 = Math.round(rect.x * scale), y0 = Math.round(rect.y * scale);
  const x1 = Math.min(size.width, Math.round((rect.x + rect.w) * scale));
  const y1 = Math.min(size.height, Math.round((rect.y + rect.h) * scale));
  let sum = 0, n = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * size.width + x) * 4;
      if (bmp[i + 3] < 200) continue;
      const r = bmp[i + 2], g = bmp[i + 1], b = bmp[i];
      sum += Math.max(r, g, b) - Math.min(r, g, b);
      n += 1;
    }
  }
  return { chroma: n ? +(sum / n).toFixed(1) : 0, pixels: n };
}

const RECTS = `(() => {
  const box = (sel) => {
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    return { x: r.x, y: r.y, w: r.width, h: r.height, css: getComputedStyle(el).color };
  };
  const card = document.getElementById('musicCard');
  const cs = getComputedStyle(card);
  const cardBox = card.getBoundingClientRect();
  return {
    card: {
      dynamic: card.dataset.dynamic, bg: cs.backgroundImage,
      vars: ['--mc-1', '--mc-2', '--mc-3'].map((v) => card.style.getPropertyValue(v)),
      art: getComputedStyle(document.getElementById('musicArt')).backgroundImage,
    },
    cardRect: { x: cardBox.x, y: cardBox.y, w: cardBox.width, h: cardBox.height },
    pageWidth: window.innerWidth,
    parts: {
      judul: box('#musicTitle'), artis: box('#musicSub'),
      waktuKiri: box('#musicTimeCur'), waktuKanan: box('#musicTimeEnd'),
      lirikIdle: box('.lyric-line:not(.active)'), lirikAktif: box('.lyric-line.active'),
    },
    title: document.getElementById('mediaTrack').dataset.title,
    musicBg: document.getElementById('island').dataset.musicBg,
  };
})()`;

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });

  /* A real lookup, no fixture: the same code pollMedia() calls. */
  const palette = await colors.fetchTrackColors(REAL_TRACK);
  report.palette[REAL_TRACK] = palette;
  console.log(`  real palette ${JSON.stringify(palette)}`);
  check('lagu nyata: 3 hex warna dari sampul iTunes',
    Boolean(palette) && ['c1', 'c2', 'c3'].every((k) => /^#[0-9a-f]{6}$/i.test(palette[k])),
    JSON.stringify(palette));
  const unknown = await colors.fetchTrackColors(FAKE_TRACK);
  report.palette[FAKE_TRACK] = unknown;
  check('judul omong kosong: lookup null (fallback hash)', unknown === null, JSON.stringify(unknown));
  const second = await colors.fetchTrackColors(REAL_TRACK_2);
  report.palette[REAL_TRACK_2] = second;
  console.log(`  second palette ${JSON.stringify(second)}`);
  check('lagu kedua: palet berbeda (warna mengikuti sampul, bukan hash)',
    Boolean(second) && Boolean(palette)
      && ['c1', 'c2', 'c3'].some((k) => second[k] !== palette[k]),
    JSON.stringify({ first: palette, second }));
  const beforeRepeat = colors.colorCacheSize();
  const again = await colors.fetchTrackColors(FAKE_TRACK);
  check('hasil null ikut di-cache (tidak spam jaringan)', again === null
    && colors.colorCacheSize() === beforeRepeat,
  `size=${colors.colorCacheSize()} sebelum=${beforeRepeat}`);

  /* Offline: make net.fetch reject, exactly what _qa-features.js does. */
  const originalFetch = electron.net.fetch;
  electron.net.fetch = () => Promise.reject(new Error('offline in probe'));
  const offline = await colors.fetchTrackColors('Offline Artist - Silent Track');
  electron.net.fetch = originalFetch;
  report.palette.offline = offline;
  check('offline: fetch gagal -> null tanpa throw', offline === null, JSON.stringify(offline));

  const win = new BrowserWindow({
    width: CARD.width, height: CARD.height, frame: false, show: false, transparent: true,
    hasShadow: false, useContentSize: true, backgroundColor: '#00000000',
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: path.join(root, '_qa-preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
      backgroundThrottling: false,
    },
  });
  const consoleErrors = [];
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 3) consoleErrors.push(message);
  });
  await win.loadFile(path.join(root, 'dist', 'renderer', 'index.html'));
  const area = screen.getPrimaryDisplay().workArea;
  win.setPosition(Math.round(area.x + area.width - CARD.width - 8),
    Math.round(area.y + area.height - CARD.height - 8));
  win.showInactive();
  await sleep(320);
  const js = (code) => win.webContents.executeJavaScript(code);
  const base = {
    state: 'open', meeting: false, media: true, mediaTitle: REAL_TRACK, word: false,
    miniMode: 'clock', scaleEffective: 100, accent: '#6ea8ff', surface: 'Liquid glass',
    glassLevel: 20, islandStyle: 'dynamic', islandPosition: 'center',
    visibleTabs: ['music'], hiddenUntilHover: false, openAction: 'last',
    musicCardBackground: 'album', musicCardProgress: 'Wave',
  };
  const status = (extra) => js(`window.probe.emit('status', ${JSON.stringify({ ...base, ...extra })}); true`);
  const settings = (extra) => js(`window.probe.emit('settings', ${JSON.stringify({
    surface: 'Liquid glass', glassLevel: 20, accent: '#6ea8ff', cardWidth: CARD.width,
    visibleTabs: ['music'], miniMode: 'clock', islandStyle: 'dynamic', islandContent: 'clock-robot',
    islandPosition: 'center', monitor: 'main', edgeMargin: 4, islandScale: 100,
    musicCardBackground: 'album', musicCardProgress: 'Wave', lyricsText: LRC,
    ...extra,
  })}); true`);
  const pushColors = (title, value) => js(`window.probe.emit('musicColors', ${JSON.stringify({
    title, colors: value,
  })}); true`);

  await settings({});
  await sleep(160);
  win.setBounds(boundsFor('open', settingsFor(), CARD.height));
  await status({});
  await sleep(260);
  await js(`document.querySelector('.tab[data-tab="music"]').click(); true`);
  await sleep(220);
  await js(`window.probe.emit('lyrics', { title: ${JSON.stringify(REAL_TRACK)}, lrc: ${JSON.stringify(LRC)} }); true`);
  await sleep(1250);
  const wanted = await js(`(() => {
    const c = window.probe.calls().filter((x) => x.kind === 'setCardHeight');
    return c.length ? c[c.length - 1].payload : null;
  })()`);
  if (typeof wanted === 'number' && wanted > 40) {
    win.setBounds(boundsFor('open', settingsFor(), Math.round(wanted)));
    await sleep(320);
  }

  const fallback = await js(RECTS);
  report.cardRect = fallback.cardRect;
  report.pageWidth = fallback.pageWidth;
  report.guards.fallbackBefore = fallback.card;
  check('awal: lagu jalan langsung pakai palet fallback (tidak panel abu-abu)',
    fallback.card.dynamic === 'fallback' && fallback.card.vars.length === 3
      && fallback.card.vars.every((v) => /^#[0-9a-f]{6}$/i.test(v)),
    JSON.stringify(fallback.card));

  /* Drive the real palette through the IPC seam. */
  await pushColors(REAL_TRACK, colors.toDeepPalette(palette));
  await sleep(320);
  const dynamic = await js(RECTS);
  report.guards.dynamic = dynamic.card;
  check('lagu nyata: 3 variabel CSSOM terisi dan dynamic true',
    dynamic.card.dynamic === 'true' && dynamic.card.vars.length === 3
      && dynamic.card.vars.every((v) => /^#[0-9a-f]{6}$/i.test(v)),
    JSON.stringify(dynamic.card.vars));
  check('background computed berubah dari fallback',
    dynamic.card.bg !== fallback.card.bg && dynamic.card.bg.includes('radial-gradient'),
    `fallback=${fallback.card.bg.slice(0, 70)} | dynamic=${dynamic.card.bg.slice(0, 70)}`);
  check('music-art memakai gradient warna sampul',
    dynamic.card.art !== getArtFallback(fallback) && dynamic.card.art.includes('linear-gradient'),
    dynamic.card.art.slice(0, 90));

  /* Stale reply for a different song must be ignored. */
  await pushColors(FAKE_TRACK, { c1: '#ff0000', c2: '#00ff00', c3: '#0000ff' });
  await sleep(180);
  const stale = await js(RECTS);
  report.guards.stale = stale.card;
  check('balasan warna untuk lagu lain diabaikan (title guard)',
    stale.card.dynamic === 'true' && stale.card.vars[0] === dynamic.card.vars[0],
    JSON.stringify(stale.card.vars));

  /* Contrast of the dynamic card on three desktops. */
  const shot = await win.capturePage();
  const scale = shot.getSize().width / (await js('window.innerWidth'));
  for (const kind of BACKDROPS) {
    const over = compositeOver(shot, kind);
    fs.writeFileSync(path.join(SHOT_DIR, `musicbg-dynamic-${kind}-4x.png`),
      over.resize({ width: over.getSize().width * 4, quality: 'best' }).toPNG());
    const rows = {};
    for (const [name, rect] of Object.entries(dynamic.parts)) {
      if (!rect) { rows[name] = null; continue; }
      rows[name] = textPixelContrast(over, rect, scale, rect.css);
    }
    report.contrast[kind] = rows;
    console.log(`  ${kind.padEnd(5)} ` + Object.entries(rows)
      .map(([k, v]) => `${k}=${v ? `${v.median}/${v.worst}` : 'n/a'}`).join(' '));
  }
  const measured = Object.values(report.contrast).flatMap((row) => Object.values(row)).filter(Boolean);
  const bad = measured.filter((m) => m.median === null || m.median < 4.5 || m.worst < 4.6);
  check('kartu dinamis: semua teks >= 4.5 median dan >= 4.6 cincin terburuk, 3 latar',
    measured.length >= 18 && bad.length === 0,
    `n=${measured.length} gagal=${JSON.stringify(bad)}`);

  /* The rejected first attempt kept AA contrast but painted a grey panel
     (card chroma 7.5). Guard the actual point of the feature: the card must
     visibly carry the album colour, not merely survive the contrast check. */
  const chroma = cardChroma(compositeOver(shot, 'light'), dynamic.cardRect, scale);
  report.chroma = chroma;
  check('kartu benar-benar berwarna (chroma >= 55, bukan panel abu-abu)',
    chroma.pixels >= 1000 && chroma.chroma >= 55, JSON.stringify(chroma));

  /* A second real song: changing the title must drop the old glow before the
     new lookup lands, then the new palette has to be the one that paints. */
  await status({ mediaTitle: REAL_TRACK_2 });
  await sleep(320);
  const mid = await js(RECTS);
  report.guards.titleChangeClears = mid.card;
  check('ganti lagu: palet fallback lagu baru dipasang, warna lama tak terbawa',
    mid.title === REAL_TRACK_2 && mid.card.dynamic === 'fallback'
      && mid.card.vars.every((v) => /^#[0-9a-f]{6}$/i.test(v))
      && mid.card.vars[0] !== dynamic.card.vars[0],
    JSON.stringify({ title: mid.title, dynamic: mid.card.dynamic, vars: mid.card.vars }));
  if (second) {
    const deepSecond = colors.toDeepPalette(second);
    await pushColors(REAL_TRACK_2, deepSecond);
    await sleep(300);
    const track2 = await js(RECTS);
    report.guards.secondTrack = track2.card;
    check('lagu kedua: palet baru terpasang di kartu',
      track2.card.dynamic === 'true' && track2.card.vars[0] === deepSecond.c1,
      JSON.stringify(track2.card.vars));
    const shot2 = await win.capturePage();
    fs.writeFileSync(path.join(SHOT_DIR, 'musicbg-second-track-4x.png'),
      compositeOver(shot2, 'light')
        .resize({ width: shot2.getSize().width * 4, quality: 'best' }).toPNG());
  }

  /* Unknown song: null colours clear the glow. */
  await pushColors(REAL_TRACK_2, null);
  await sleep(220);
  const cleared = await js(RECTS);
  report.guards.nullColors = cleared.card;
  check('lookup gagal: tetap berwarna lewat palet fallback hash',
    cleared.card.dynamic === 'fallback' && cleared.card.vars.length === 3
      && cleared.card.vars.every((v) => /^#[0-9a-f]{6}$/i.test(v)),
    JSON.stringify(cleared.card.vars));
  const fallbackShot = await win.capturePage();
  fs.writeFileSync(path.join(SHOT_DIR, 'musicbg-fallback-4x.png'),
    compositeOver(fallbackShot, 'light')
      .resize({ width: fallbackShot.getSize().width * 4, quality: 'best' }).toPNG());

  /* Plain background must stay exactly as it was. */
  await settings({ musicCardBackground: 'plain' });
  await status({ musicCardBackground: 'plain' });
  await sleep(240);
  await pushColors(REAL_TRACK_2, palette);
  await sleep(240);
  const plain = await js(RECTS);
  report.guards.plain = plain.card;
  check('setting plain: tidak ada warna dinamis sama sekali',
    plain.musicBg === 'plain' && plain.card.dynamic === 'false'
      && plain.card.vars.every((v) => v === '') && !plain.card.bg.includes('radial-gradient'),
    JSON.stringify({ musicBg: plain.musicBg, dynamic: plain.card.dynamic, bg: plain.card.bg.slice(0, 60) }));

  check('tidak ada error konsol', consoleErrors.length === 0, JSON.stringify(consoleErrors));
  fs.writeFileSync(path.join(SHOT_DIR, 'musicbg-metrics.json'), JSON.stringify(report, null, 2), 'utf8');
  win.destroy();
}

function getArtFallback(fallback) {
  return fallback.card.art;
}

app.on('window-all-closed', (event) => event.preventDefault());
app.whenReady().then(async () => {
  try { await main(); } catch (err) {
    check('probe selesai tanpa exception', false, String((err && err.stack) || err));
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\nPROBE_MUSICBG ${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) console.log('FAILED: ' + failed.map((f) => f.name).join(' | '));
  app.exit(failed.length ? 1 : 0);
});
