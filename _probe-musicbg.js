/* Kou - proof for the visibly coloured, cover-driven music card.
   A real iTunes lookup runs in the main process, toDeepPalette() deepens and
   saturates it, and the three hex colours are pushed through the same IPC seam
   the app uses. Chroma (mean max-min per pixel) is measured on the exact card
   rect of the 4x PNG and compared with the user's reference screenshot; text
   contrast uses the ring ruler on three synthetic desktops.

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
const REF_PATH = 'C:\\Users\\Lycaon\\.workbuddy-ai\\clipboard-images\\'
  + 'clipboard-2026-11-15T08-58-18-314Z-0263c053.png';
const REF_BOX = { x0: 80, y0: 30, x1: 590, y1: 240 };
const CHROMA_TARGET = 55;

const results = [];
const report = { palette: {}, chroma: {}, contrast: {}, backgrounds: {}, guards: {} };
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

/** Team-lead's ruler: mean of max(R,G,B) - min(R,G,B) over the card area. */
function meanChroma(img, box) {
  const size = img.getSize();
  const bmp = img.toBitmap();
  const x0 = Math.max(0, Math.round(box.x0));
  const y0 = Math.max(0, Math.round(box.y0));
  const x1 = Math.min(size.width, Math.round(box.x1));
  const y1 = Math.min(size.height, Math.round(box.y1));
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * size.width + x) * 4;
      const r = bmp[i + 2]; const g = bmp[i + 1]; const b = bmp[i];
      sum += Math.max(r, g, b) - Math.min(r, g, b);
      n += 1;
    }
  }
  return n ? +(sum / n).toFixed(2) : null;
}

function cardBoxFor(img, cardRect, pageWidth) {
  const k = img.getSize().width / pageWidth;
  return {
    x0: cardRect.x * k, y0: cardRect.y * k,
    x1: (cardRect.x + cardRect.w) * k, y1: (cardRect.y + cardRect.h) * k,
  };
}

/** Reference crop on the left, our card crop on the right, same size. */
function sideBySide(refPath, ourImg, ourBox, outName) {
  const ref = flattenOverWhite(nativeImage.createFromPath(refPath));
  const ours = flattenOverWhite(ourImg);
  const w = REF_BOX.x1 - REF_BOX.x0;
  const h = REF_BOX.y1 - REF_BOX.y0;
  const left = ref.crop({ x: REF_BOX.x0, y: REF_BOX.y0, width: w, height: h });
  const box = {
    x: Math.round(ourBox.x0), y: Math.round(ourBox.y0),
    width: Math.round(ourBox.x1 - ourBox.x0), height: Math.round(ourBox.y1 - ourBox.y0),
  };
  const right = ours.crop(box).resize({ width: w, height: h, quality: 'best' });
  const a = left.toBitmap(); const b = right.toBitmap();
  const canvas = Buffer.alloc(w * 2 * h * 4);
  for (let y = 0; y < h; y += 1) {
    a.copy(canvas, (y * w * 2) * 4, y * w * 4, (y + 1) * w * 4);
    b.copy(canvas, (y * w * 2 + w) * 4, y * w * 4, (y + 1) * w * 4);
  }
  const out = nativeImage.createFromBitmap(canvas, { width: w * 2, height: h });
  fs.writeFileSync(path.join(SHOT_DIR, outName), out.toPNG());
  return { size: [w * 2, h], left: 'referensi user', right: 'kartu dinamis' };
}

const hex = (c) => `#${[c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
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
/** `ink` is [r,g,b,a] resolved by the renderer's own 1x1 canvas, so modern
    colour syntax (oklch/relative oklch in .lyric-line.active) is measured with
    the same engine that paints it instead of a Node-side regex guess. */
function textPixelContrast(img, rect, scale, ink) {
  const size = img.getSize();
  const bmp = img.toBitmap();
  const x0 = Math.round(rect.x * scale);
  const y0 = Math.round(rect.y * scale);
  const x1 = Math.round((rect.x + rect.w) * scale);
  const y1 = Math.round((rect.y + rect.h) * scale);
  const ring = [];
  for (let y = y0 - 5; y <= y1 + 5; y += 1) {
    for (let x = x0 - 5; x <= x1 + 5; x += 1) {
      if (y < 0 || x < 0 || y >= size.height || x >= size.width) continue;
      const inside = y >= y0 && y < y1 && x >= x0 && x < x1;
      if (inside) continue;
      const i = (y * size.width + x) * 4;
      if (bmp[i + 3] < 200) continue;
      ring.push({ r: bmp[i + 2], g: bmp[i + 1], b: bmp[i] });
    }
  }
  const surface = {
    r: medianOf(ring.map((p) => p.r)), g: medianOf(ring.map((p) => p.g)),
    b: medianOf(ring.map((p) => p.b)),
  };
  ring.sort((a, b) => lum(a) - lum(b));
  const worstSurface = ring.length ? ring[Math.floor(ring.length * 0.95)] : surface;
  const resolved = Array.isArray(ink) && ink[3] >= 250
    ? { r: ink[0], g: ink[1], b: ink[2] } : null;
  if (!resolved || ring.length < 150) return { surface: hex(surface), ring: ring.length, median: null, worst: null };
  return {
    surface: hex(surface), ring: ring.length,
    median: ratio(resolved, surface), worst: ratio(resolved, worstSurface),
  };
}

const RECTS = `(() => {
  /* The browser is the colour oracle: a 1x1 canvas resolves rgb(), color(srgb)
     and oklch()/relative oklch() identically to what Chromium actually paints. */
  const resolveInk = (css) => {
    const cv = document.createElement('canvas');
    cv.width = 1; cv.height = 1;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    return Array.from(ctx.getImageData(0, 0, 1, 1).data);
  };
  const box = (sel) => {
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    const css = getComputedStyle(el).color;
    return { x: r.x, y: r.y, w: r.width, h: r.height, css, ink: resolveInk(css) };
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

  /* Real lookups, no fixture. main.ts deepens the palette before IPC. */
  const raw = await colors.fetchTrackColors(REAL_TRACK);
  const deep = colors.toDeepPalette(raw);
  report.palette[REAL_TRACK] = { raw, deep };
  console.log(`  ${REAL_TRACK}: raw ${JSON.stringify(raw)} -> deep ${JSON.stringify(deep)}`);
  check('lagu nyata: 3 hex warna dari sampul iTunes',
    Boolean(raw) && ['c1', 'c2', 'c3'].every((k) => /^#[0-9a-f]{6}$/i.test(raw[k])),
    JSON.stringify(raw));
  const unknown = await colors.fetchTrackColors(FAKE_TRACK);
  check('judul omong kosong: lookup null (kartu pakai palet fallback)',
    unknown === null && colors.toDeepPalette(unknown) === null, JSON.stringify(unknown));
  const raw2 = await colors.fetchTrackColors(REAL_TRACK_2);
  const deep2 = colors.toDeepPalette(raw2);
  report.palette[REAL_TRACK_2] = { raw: raw2, deep: deep2 };
  console.log(`  ${REAL_TRACK_2}: raw ${JSON.stringify(raw2)} -> deep ${JSON.stringify(deep2)}`);
  check('lagu kedua: palet dalam berbeda dari lagu pertama',
    Boolean(deep2) && Boolean(deep) && ['c1', 'c2', 'c3'].some((k) => deep2[k] !== deep[k]),
    JSON.stringify({ deep, deep2 }));
  const beforeRepeat = colors.colorCacheSize();
  const again = await colors.fetchTrackColors(FAKE_TRACK);
  check('hasil null ikut di-cache (tidak spam jaringan)',
    again === null && colors.colorCacheSize() === beforeRepeat,
    `size=${colors.colorCacheSize()} sebelum=${beforeRepeat}`);

  const originalFetch = electron.net.fetch;
  electron.net.fetch = () => Promise.reject(new Error('offline in probe'));
  const offline = await colors.fetchTrackColors('Offline Artist - Silent Track');
  electron.net.fetch = originalFetch;
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
  report.guards.initial = fallback.card;
  report.cardRect = fallback.cardRect;
  report.pageWidth = fallback.pageWidth;
  report.backgrounds.fallback = fallback.card.bg;
  check('awal (belum ada lookup): data-dynamic="fallback" dan kartu sudah berwarna',
    fallback.card.dynamic === 'fallback' && fallback.card.vars.every((v) => /^#[0-9a-f]{6}$/i.test(v))
      && fallback.card.bg.includes('radial-gradient'),
    JSON.stringify({ dynamic: fallback.card.dynamic, vars: fallback.card.vars }));

  /* Track 1: deep palette through the IPC seam. */
  await pushColors(REAL_TRACK, deep);
  await sleep(320);
  const dynamic = await js(RECTS);
  report.guards.dynamic = dynamic.card;
  report.backgrounds.track1 = dynamic.card.bg;
  check('lagu nyata: palet dalam lewat CSSOM, dynamic=true',
    dynamic.card.dynamic === 'true' && dynamic.card.vars.join('|')
      === `${deep.c1}|${deep.c2}|${deep.c3}`
      && dynamic.card.bg !== fallback.card.bg && dynamic.card.art !== fallback.card.art,
    JSON.stringify(dynamic.card.vars));

  const shot1 = await win.capturePage();
  const scale = shot1.getSize().width / fallback.pageWidth;
  let bigLight = null;
  for (const kind of BACKDROPS) {
    const over = compositeOver(shot1, kind);
    const big = over.resize({ width: over.getSize().width * 4, quality: 'best' });
    fs.writeFileSync(path.join(SHOT_DIR, `musicbg-rev-dynamic-${kind}-4x.png`), big.toPNG());
    if (kind === 'light') bigLight = big;
    report.chroma[`dynamic-${kind}`] = meanChroma(big, cardBoxFor(big, fallback.cardRect, fallback.pageWidth));
    const rows = {};
    for (const [name, rect] of Object.entries(dynamic.parts)) {
      rows[name] = rect ? textPixelContrast(over, rect, scale, rect.ink) : null;
    }
    report.contrast[kind] = rows;
    console.log(`  ${kind.padEnd(5)} kroma=${report.chroma[`dynamic-${kind}`]} `
      + Object.entries(rows).map(([k, v]) => `${k}=${v ? `${v.median}/${v.worst}` : 'n/a'}`).join(' '));
  }
  const measured = Object.values(report.contrast).flatMap((row) => Object.values(row)).filter(Boolean);
  const bad = measured.filter((m) => m.median === null || m.median < 4.5 || m.worst < 4.6);
  check('kartu dinamis: semua teks >= 4.5 median dan >= 4.6 cincin terburuk, 3 latar',
    measured.length >= 18 && bad.length === 0,
    `n=${measured.length} gagal=${JSON.stringify(bad)}`);

  /* A late reply for another song is ignored. */
  await pushColors(FAKE_TRACK, { c1: '#ff0000', c2: '#00ff00', c3: '#0000ff' });
  await sleep(180);
  const stale = await js(RECTS);
  check('balasan warna untuk lagu lain diabaikan (title guard)',
    stale.card.dynamic === 'true' && stale.card.vars[0] === dynamic.card.vars[0],
    JSON.stringify(stale.card.vars));

  /* Track 2: the title change must drop the old palette first. */
  await status({ mediaTitle: REAL_TRACK_2 });
  await sleep(320);
  const mid = await js(RECTS);
  report.guards.titleChange = mid.card;
  check('ganti lagu: palet lama hilang, langsung ke fallback warna',
    mid.title === REAL_TRACK_2 && mid.card.dynamic === 'fallback'
      && mid.card.vars[0] !== dynamic.card.vars[0],
    JSON.stringify({ dynamic: mid.card.dynamic, vars: mid.card.vars }));
  await pushColors(REAL_TRACK_2, deep2);
  await sleep(300);
  const track2 = await js(RECTS);
  report.backgrounds.track2 = track2.card.bg;
  report.guards.track2 = track2.card;
  check('lagu kedua: palet dalam baru terpasang',
    track2.card.dynamic === 'true' && track2.card.vars[0] === deep2.c1,
    JSON.stringify(track2.card.vars));
  const shot2 = await win.capturePage();
  const big2 = compositeOver(shot2, 'light').resize({ width: shot2.getSize().width * 4, quality: 'best' });
  fs.writeFileSync(path.join(SHOT_DIR, 'musicbg-rev-second-track-4x.png'), big2.toPNG());
  report.chroma['second-track'] = meanChroma(big2, cardBoxFor(big2, fallback.cardRect, fallback.pageWidth));

  /* Null colours restore the coloured fallback, not a bare dark panel. */
  await pushColors(REAL_TRACK_2, null);
  await sleep(240);
  const cleared = await js(RECTS);
  report.guards.nullColors = cleared.card;
  /* The fallback is title-hash keyed (renderer.ts FALLBACK_PALETTES /
     applyFallbackColors), so equality with the INITIAL fallback background is
     not the contract. What must hold: fallback marker, three valid hex vars,
     a real radial-gradient background, and a still-coloured card. */
  const shotF = await win.capturePage();
  const bigF = compositeOver(shotF, 'light').resize({ width: shotF.getSize().width * 4, quality: 'best' });
  fs.writeFileSync(path.join(SHOT_DIR, 'musicbg-rev-fallback-4x.png'), bigF.toPNG());
  report.chroma.fallback = meanChroma(bigF, cardBoxFor(bigF, fallback.cardRect, fallback.pageWidth));

  check('lookup gagal: kembali ke palet fallback berwarna',
    cleared.card.dynamic === 'fallback'
      && cleared.card.vars.every((v) => /^#[0-9a-f]{6}$/i.test(v))
      && cleared.card.bg.includes('radial-gradient')
      && report.chroma.fallback >= CHROMA_TARGET,
    JSON.stringify({ dynamic: cleared.card.dynamic, vars: cleared.card.vars,
      bg: cleared.card.bg.slice(0, 42), chroma: report.chroma.fallback }));

  const distinct = new Set([report.backgrounds.track1, report.backgrounds.track2,
    report.backgrounds.fallback]);
  check('3 lagu/state: background-image computed saling berbeda',
    distinct.size === 3,
    `track1=${report.backgrounds.track1.slice(0, 42)} | track2=${report.backgrounds.track2.slice(0, 42)}`
    + ` | fallback=${report.backgrounds.fallback.slice(0, 42)}`);

  /* Plain must stay exactly as it was, with no dynamic variables. */
  await settings({ musicCardBackground: 'plain' });
  await status({ musicCardBackground: 'plain' });
  await sleep(240);
  const plainBase = await js(RECTS);
  await pushColors(REAL_TRACK_2, deep);
  await sleep(220);
  const plain = await js(RECTS);
  report.guards.plain = plain.card;
  check('setting plain: tidak ada warna dinamis dan latar tidak berubah',
    plain.musicBg === 'plain' && plain.card.dynamic === 'false'
      && plain.card.vars.every((v) => v === '') && plain.card.bg === plainBase.card.bg,
    JSON.stringify({ dynamic: plain.card.dynamic, vars: plain.card.vars }));

  /* Chroma table: the reference and all three card states, same ruler. */
  const refImg = flattenOverWhite(nativeImage.createFromPath(REF_PATH));
  report.chroma.reference = meanChroma(refImg, REF_BOX);
  console.log(`  KROMA referensi=${report.chroma.reference} bad guy=${report.chroma['dynamic-light']}`
    + ` Levitating=${report.chroma['second-track']} fallback=${report.chroma.fallback}`);
  const cardStates = ['dynamic-light', 'second-track', 'fallback'];
  check(`kroma area kartu >= ${CHROMA_TARGET} untuk ke-3 state (ruler sama dengan referensi)`,
    cardStates.every((k) => report.chroma[k] !== null && report.chroma[k] >= CHROMA_TARGET),
    JSON.stringify(Object.fromEntries(cardStates.map((k) => [k, report.chroma[k]]))));
  report.compare = sideBySide(REF_PATH, bigLight,
    cardBoxFor(bigLight, fallback.cardRect, fallback.pageWidth), 'musicbg-rev-compare.png');

  check('tidak ada error konsol', consoleErrors.length === 0, JSON.stringify(consoleErrors));
  fs.writeFileSync(path.join(SHOT_DIR, 'musicbg-metrics.json'), JSON.stringify(report, null, 2), 'utf8');
  win.destroy();
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
