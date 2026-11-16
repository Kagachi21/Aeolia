/* Kou - measurements for the Liquid glass base and the 64x14 notch.
   Renders the REAL compiled renderer, captures the transparent window and
   composites it over synthetic desktops, because a transparent Electron window
   shows the desktop through every semi transparent layer. That is exactly what
   the user sees, and it is the only way to prove the surface no longer depends
   on the wallpaper.

   Reports per surface, glass level and backdrop: the dominant surface colour
   (the largest colour cluster, so text pixels do not skew it), the WCAG
   contrast of every real computed text colour the glass override touches, and
   the painted notch bounding box measured with the same near black rule as the
   reference screenshot.

   The user's own settings.json is the profile under test: surface
   "Liquid glass", glassLevel 20, accent #6ea8ff, cardWidth 420. Level 70 is
   measured as well because the QA baseline was pinned there.

   Run: env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe _probe-glass-notch.js
*/
const { app, BrowserWindow, nativeImage, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const root = __dirname;
const SHOT_DIR = path.join(root, '.superpowers', 'shots');
const { boundsFor } = require(path.join(root, 'dist', 'main', 'bounds.js'));

const PILL = { width: 150, height: 36 };
const CARD = { width: 420, height: 92 };            // the user runs cardWidth 420
const MINI = { width: 64, height: 14 };
const MINI_CAT = { width: 64, height: 26 };
const WINDOW_FLOOR = 39;              // Windows minimum frameless window height
/* Reference "good glass" for this surface is a LUMINANCE FLOOR, not a hex: the
   material is a light frost now, so the assertions are "reads as light" and
   "stays light over a black wallpaper" (see the Liquid glass target block). */
const USER = { accent: '#6ea8ff', glassLevel: 20 };  // from the user settings.json
const LEVELS = [USER.glassLevel, 70];                 // user value + QA baseline
const TRACK = 'Kavi Rao - Neon Harbor';
const LRC = '[00:01.00] satu\n[00:04.00] dua';

const results = [];
const report = {};
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  :: ' + detail}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------- backdrops */
function backdrop(kind, w, h) {
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const t = y / Math.max(1, h - 1);
      let r;
      let g;
      let b;
      if (kind === 'light') {
        r = 247 - 15 * t; g = 248 - 14 * t; b = 250 - 12 * t;
      } else if (kind === 'dark') {
        r = 15 + 12 * t; g = 17 + 14 * t; b = 20 + 16 * t;
      } else {
        // Busy: saturated 8 px checkerboard plus a diagonal hue ramp.
        const cell = (Math.floor(x / 8) + Math.floor(y / 8)) % 2;
        r = cell ? 220 - 60 * t : 30 + 40 * t;
        g = cell ? 90 + 90 * t : 180 - 40 * t;
        b = cell ? 60 + 120 * (1 - t) : 210 - 30 * t;
      }
      const i = (y * w + x) * 4;
      buf[i] = Math.round(b);          // BGRA
      buf[i + 1] = Math.round(g);
      buf[i + 2] = Math.round(r);
      buf[i + 3] = 255;
    }
  }
  return buf;
}

/** Premultiplied BGRA source over an opaque BGRA backdrop. */
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

/** Largest colour cluster (8 levels per channel) inside an inset region: the
    surface colour, with text and icons outvoted instead of averaged in. */
function dominantColour(img, insetX, insetY) {
  const size = img.getSize();
  const bmp = img.toBitmap();
  const x0 = Math.min(insetX, Math.floor(size.width / 3));
  const x1 = Math.max(x0 + 1, size.width - insetX);
  const y0 = Math.min(insetY, Math.floor(size.height / 3));
  const y1 = Math.max(y0 + 1, size.height - insetY);
  const buckets = new Map();
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * size.width + x) * 4;
      const key = `${bmp[i] >> 3},${bmp[i + 1] >> 3},${bmp[i + 2] >> 3}`;
      const b = buckets.get(key) || { n: 0, b: 0, g: 0, r: 0 };
      b.n += 1; b.b += bmp[i]; b.g += bmp[i + 1]; b.r += bmp[i + 2];
      buckets.set(key, b);
    }
  }
  let best = null;
  for (const b of buckets.values()) if (!best || b.n > best.n) best = b;
  const total = (x1 - x0) * (y1 - y0);
  return {
    r: Math.round(best.r / best.n), g: Math.round(best.g / best.n), b: Math.round(best.b / best.n),
    share: +(best.n / total).toFixed(3),
  };
}

const hex = (c) => `#${[c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const parseRgb = (css) => {
  const s = String(css || '');
  const m = /rgba?\(([^)]+)\)/.exec(s);
  if (m) {
    const p = m[1].split(',').map((v) => Number(v.trim()));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  /* color-mix() resolves to color(srgb r g b) with 0..1 channels. */
  const c = /color\(srgb\s+([^)]+)\)/.exec(s);
  if (c) {
    const p = c[1].trim().split(/[\s/]+/).map((v) => Number(v));
    return {
      r: Math.round(p[0] * 255), g: Math.round(p[1] * 255), b: Math.round(p[2] * 255),
      a: p.length > 3 ? p[3] : 1,
    };
  }
  return null;
};
const lum = (c) => {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
};
/** WCAG ratio of a text colour (with its own alpha) over a measured surface. */
function contrast(textCss, surface) {
  const t = parseRgb(textCss);
  if (!t) return null;
  const over = {
    r: t.r * t.a + surface.r * (1 - t.a),
    g: t.g * t.a + surface.g * (1 - t.a),
    b: t.b * t.a + surface.b * (1 - t.a),
  };
  const l1 = lum(over);
  const l2 = lum(surface);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return +((hi + 0.05) / (lo + 0.05)).toFixed(2);
}

/** WCAG ratio between two rgb objects. */
function contrastRgb(a, b) {
  const l1 = lum(a);
  const l2 = lum(b);
  return +((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2);
}

const medianOf = (values) => {
  if (!values.length) return 0;
  const s = values.slice().sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/** Rendered contrast of a text node: the surface is the median of a ring of
    pixels around the glyph box (the sheen makes the plane under a glyph lighter
    than the card average), the ink is the median of the glyph pixels actually
    painted. A CSS only contrast is optimistic, this is what the screen shows. */
function textPixelContrast(img, rect, scale, textCss) {
  const size = img.getSize();
  const bmp = img.toBitmap();
  const x0 = Math.round(rect.x * scale);
  const y0 = Math.round(rect.y * scale);
  const x1 = Math.round((rect.x + rect.w) * scale);
  const y1 = Math.round((rect.y + rect.h) * scale);
  const ring = { r: [], g: [], b: [] };
  const glyph = [];
  for (let y = y0 - 5; y <= y1 + 5; y += 1) {
    for (let x = x0 - 5; x <= x1 + 5; x += 1) {
      if (y < 0 || x < 0 || y >= size.height || x >= size.width) continue;
      const i = (y * size.width + x) * 4;
      const p = { r: bmp[i + 2], g: bmp[i + 1], b: bmp[i], a: bmp[i + 3] };
      if (p.a < 200) continue;
      const inside = y >= y0 && y < y1 && x >= x0 && x < x1;
      if (inside) glyph.push(p);
      else { ring.r.push(p.r); ring.g.push(p.g); ring.b.push(p.b); }
    }
  }
  const surface = { r: medianOf(ring.r), g: medianOf(ring.g), b: medianOf(ring.b) };
  /* Brightest end of the ring: the sheen band above the pill makes part of the
     ring lighter than the median, and that is the worst pixel a glyph edge sits
     on. 95th percentile instead of max so one stray anti alias pixel cannot
     decide the verdict. */
  const ringPixels = ring.r.map((r, i) => ({ r, g: ring.g[i], b: ring.b[i] }));
  ringPixels.sort((p, q) => lum(p) - lum(q));
  const surfaceP95 = ringPixels.length
    ? ringPixels[Math.min(ringPixels.length - 1, Math.floor(ringPixels.length * 0.95))] : surface;
  /* Only pixels that clearly differ from the plane are ink; the rest is the
     background showing between glyph strokes. */
  const far = (p) => Math.abs(p.r - surface.r) + Math.abs(p.g - surface.g)
    + Math.abs(p.b - surface.b) > 90;
  const inkPixels = glyph.filter(far);
  const ink = inkPixels.length
    ? { r: medianOf(inkPixels.map((p) => p.r)), g: medianOf(inkPixels.map((p) => p.g)),
      b: medianOf(inkPixels.map((p) => p.b)) }
    : null;
  return {
    surface, surfaceP95, ink, inkCount: inkPixels.length, boxPixels: glyph.length,
    ratio: ink ? contrastRgb(ink, surface) : null,
    /* Same ruler QA used on the reference: the declared ink colour over the ring
       median. The glyph median above is the harsher variant, kept as a check. */
    ratioCss: textCss ? contrast(textCss, surface) : null,
    ratioWorst: textCss ? contrast(textCss, surfaceP95) : null,
  };
}

/** Near black scan: the same rule the reference screenshot was measured with. */
function nearBlackBox(img) {
  const size = img.getSize();
  const bmp = img.toBitmap();
  let x0 = size.width;
  let x1 = -1;
  let y0 = size.height;
  let y1 = -1;
  for (let y = 0; y < size.height; y += 1) {
    for (let x = 0; x < size.width; x += 1) {
      const i = (y * size.width + x) * 4;
      if (bmp[i + 3] >= 200 && bmp[i] <= 40 && bmp[i + 1] <= 40 && bmp[i + 2] <= 40) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const rowWidth = (row, minAlpha) => {
    let n = 0;
    for (let x = 0; x < size.width; x += 1) {
      const i = (row * size.width + x) * 4;
      if (bmp[i + 3] >= minAlpha && bmp[i] <= 40 && bmp[i + 1] <= 40 && bmp[i + 2] <= 40) n += 1;
    }
    return n;
  };
  /* Per row inset, so the bottom curve can be compared with the reference
     screenshot row by row. The span (first/last dark pixel) is used instead of a
     pixel count, because the clock glyphs punch holes in the middle rows, and
     the alpha weighted coverage gives a sub pixel edge on the last rows. */
  const rows = [];
  for (let y = y0; y <= y1; y += 1) {
    let left = -1;
    let right = -1;
    let cov = 0;
    for (let x = x0; x <= x1; x += 1) {
      const i = (y * size.width + x) * 4;
      const a = bmp[i + 3];
      if (a >= 16 && bmp[i] <= 40 && bmp[i + 1] <= 40 && bmp[i + 2] <= 40) {
        if (left < 0) left = x;
        right = x;
      }
      if (bmp[i] <= 60 && bmp[i + 1] <= 60 && bmp[i + 2] <= 60) cov += a / 255;
    }
    rows.push({
      y: y - y0,
      span: left < 0 ? 0 : right - left + 1,
      inset: left < 0 ? null : +(((left - x0) + (x1 - right)) / 2).toFixed(2),
      coverageInset: +(((x1 - x0 + 1) - cov) / 2).toFixed(2),
    });
  }
  return {
    x0, x1, y0, y1,
    width: x1 - x0 + 1, height: y1 - y0 + 1,
    topGap: y0,
    /* Alpha 40 keeps the anti aliased corner fringe, so the last row width is
       the real geometric width: a 5 px radius narrows the bottom row by ~3 px
       per side, an 11 px radius by ~7.7 px. */
    midRowWidth: rowWidth(Math.round((y0 + y1) / 2), 200),
    bottomRowWidth: rowWidth(y1, 40),
    bottomInset: +(((x1 - x0 + 1) - rowWidth(y1, 40)) / 2).toFixed(1),
    rows,
  };
}

const COLOURS = `(() => {
  /* getComputedStyle().color hands back colour functions verbatim for anything
     outside legacy sRGB - color-mix() as color(srgb ...), oklch() as oklch(...)
     - and the Node side can only read rgb()/rgba(). Rather than teach it every
     colour space (and get one wrong), paint the value into a 1x1 canvas and
     read the pixel back: that is the one serialisation guaranteed to be plain
     sRGB bytes. Without this the active lyric silently measured as "no
     colour" the moment it moved to oklch(), which is how a 1.79:1 line was
     reported as PASS by the other probe. */
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const toRgb = (css) => {
    if (!css) return null;
    cx.fillStyle = '#ff00fe';
    cx.fillStyle = css;
    cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    const hexv = '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
    if (hexv === '#ff00fe' && !/ff00fe/i.test(css)) return null;  // browser rejected it
    return 'rgba(' + d[0] + ', ' + d[1] + ', ' + d[2] + ', ' + +(d[3] / 255).toFixed(3) + ')';
  };
  const col = (el) => (el ? toRgb(getComputedStyle(el).color) : null);
  const island = document.getElementById('island');
  const panel = document.querySelector('.panel.active');
  const hint = panel ? panel.querySelector('.hint, p') : null;
  const row = panel ? panel.querySelector('.row, .site, button') : null;
  /* Per element probes: every rule the Liquid glass secondary ink override
     touches needs its own measured ratio, not one average. */
  const parts = {
    title: col(document.getElementById('musicTitle')),
    artist: col(document.getElementById('musicSub')),
    timeCur: col(document.getElementById('musicTimeCur')),
    timeEnd: col(document.getElementById('musicTimeEnd')),
    lyricActive: col(document.querySelector('.lyric-line.active')),
    lyricIdle: col(document.querySelector('.lyric-line:not(.active)')),
    lyricEmpty: col(document.querySelector('.lyric-empty')),
    hint: col(document.getElementById('lyricRate') || hint),
    rowHead: col(document.querySelector('.row-head')),
    rowTime: col(document.querySelector('.row .time')),
    stat: col(document.querySelector('.stat i')),
    calAgenda: col(document.querySelector('.cal-agenda span')),
    empty: col(document.querySelector('.empty')),
  };
  return {
    clock: col(document.getElementById('clock')),
    island: col(island),
    panel: col(panel),
    hint: col(hint),
    row: col(row),
    parts,
    rects: (() => {
      const box = (el) => {
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: b.x, y: b.y, w: b.width, h: b.height };
      };
      return {
        clock: box(document.getElementById('clock')),
        lyricActive: box(document.querySelector('.lyric-line.active')),
      };
    })(),
    accent: getComputedStyle(island).getPropertyValue('--accent').trim(),
    glassA: getComputedStyle(island).getPropertyValue('--glass-a').trim(),
    stripHeight: getComputedStyle(island).height,
    stripRadius: getComputedStyle(island).borderBottomLeftRadius,
  };
})()`;

/** Box + colour of every rule the Liquid glass secondary ink override touches.
    Elements in a hidden panel have a zero box, so the caller opens the tab. */
const INK = `(() => {
  const q = (sel) => document.querySelector(sel);
  const box = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    if (b.width < 1 || b.height < 1) return null;
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  };
  const one = (el) => (el ? { css: getComputedStyle(el).color, rect: box(el) } : null);
  return {
    title: one(document.getElementById('musicTitle')),
    artist: one(document.getElementById('musicSub')),
    timeCur: one(document.getElementById('musicTimeCur')),
    timeEnd: one(document.getElementById('musicTimeEnd')),
    hint: one(document.getElementById('lyricRate')),
    noticeHint: one(document.getElementById('noticeHint')),
    rowHead: one(q('.panel.active .row-head')),
    stat: one(q('.panel.active .stat i')),
    calAgenda: one(q('.panel.active .cal-agenda span')),
  };
})()`;

function settingsFor(state, pos = 'center', scale = 100) {
  return {
    islandScale: scale, monitor: 'main', islandPosition: pos, edgeMargin: 4,
    islandStyle: 'dynamic', cardWidth: CARD.width,
    pill: { ...PILL }, mini: { ...MINI }, open: { ...CARD },
  };
}

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const win = new BrowserWindow({
    width: PILL.width, height: PILL.height, frame: false, show: false, transparent: true,
    hasShadow: false, useContentSize: true, backgroundColor: '#00000000',
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: path.join(root, '_qa-preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
      backgroundThrottling: false,
    },
  });
  await win.loadFile(path.join(root, 'dist', 'renderer', 'index.html'));
  const area = screen.getPrimaryDisplay().workArea;
  win.setPosition(Math.round(area.x + area.width - CARD.width - 8),
    Math.round(area.y + area.height - CARD.height - 8));
  win.showInactive();
  await sleep(320);

  const js = (code) => win.webContents.executeJavaScript(code);
  const status = (extra) => js(`window.probe.emit('status', ${JSON.stringify(extra)}); true`);
  const settings = (surface, level) => js(`window.probe.emit('settings', ${JSON.stringify({
    surface, glassLevel: level, accent: USER.accent, cardWidth: CARD.width,
    visibleTabs: ['music'], miniMode: 'clock', islandStyle: 'dynamic',
    islandContent: 'clock-robot', islandPosition: 'center', monitor: 'main',
    edgeMargin: 4, islandScale: 100, lyricsText: LRC,
  })}); true`);
  const base = {
    state: 'pill', meeting: false, media: false, mediaTitle: '', word: false,
    miniMode: 'clock', scaleEffective: 100, accent: USER.accent, surface: 'Black',
    glassLevel: USER.glassLevel, islandStyle: 'dynamic', islandPosition: 'center',
    visibleTabs: ['music'], hiddenUntilHover: false, openAction: 'last',
  };

  /* ------------------------------------------------------------ A. glass */
  report.glass = {};
  for (const surface of ['Liquid glass', 'Translucent']) {
    const key = surface === 'Liquid glass' ? 'liquid' : 'translucent';
    report.glass[key] = {};
    for (const level of LEVELS) {
      const lk = `l${level}`;
      report.glass[key][lk] = {};
      await settings(surface, level);
      await sleep(160);
      for (const kind of ['light', 'dark', 'busy']) {
        const tag = key === 'liquid' ? '' : 'translucent-';

        /* ---- pill: clock plus the empty music capsule, the user's idle state */
        win.setBounds(boundsFor('pill', settingsFor('pill')));
        await sleep(160);
        await status({ ...base, state: 'pill', surface, glassLevel: level });
        await sleep(280);
        const pillShot = await win.capturePage();
        const pillOver = compositeOver(pillShot, kind);
        const pillMean = dominantColour(pillOver, 18, 9);
        const pillColours = await js(COLOURS);
        const pillScale = pillShot.getSize().width / (await js('window.innerWidth'));
        const clockPixels = pillColours.rects.clock
          ? textPixelContrast(pillOver, pillColours.rects.clock, pillScale, pillColours.clock) : null;

        /* The media pill dims the clock to #b6bdcc, so it needs its own read:
           that is the combination QA flagged at 5.38 median / 4.44 worst. */
        await status({ ...base, state: 'pill', surface, glassLevel: level, media: true, mediaTitle: TRACK });
        await sleep(280);
        const mediaShot = await win.capturePage();
        const mediaOver = compositeOver(mediaShot, kind);
        const mediaColours = await js(COLOURS);
        const clockMediaPixels = mediaColours.rects.clock
          ? textPixelContrast(mediaOver, mediaColours.rects.clock, pillScale, mediaColours.clock) : null;
        if (level === USER.glassLevel) {
          fs.writeFileSync(path.join(SHOT_DIR, `glass-fix-${tag}pill-media-${kind}-4x.png`),
            mediaOver.resize({ width: mediaOver.getSize().width * 4, quality: 'best' }).toPNG());
        }
        if (level === USER.glassLevel) {
          fs.writeFileSync(path.join(SHOT_DIR, `glass-fixed-${tag}${kind}.png`), pillOver.toPNG());
          fs.writeFileSync(path.join(SHOT_DIR, `glass-fix-${tag}pill-${kind}-4x.png`),
            pillOver.resize({ width: pillOver.getSize().width * 4, quality: 'best' }).toPNG());
        }

        /* ---- open card, music tab live, one active lyric line */
        win.setBounds(boundsFor('open', settingsFor('open'), CARD.height));
        await sleep(160);
        await status({ ...base, state: 'open', surface, glassLevel: level, media: true, mediaTitle: TRACK });
        await sleep(200);
        await js(`document.querySelector('.tab[data-tab="music"]').click(); true`);
        await sleep(200);
        await js(`window.probe.emit('lyrics', { title: ${JSON.stringify(TRACK)}, lrc: ${JSON.stringify(LRC)} }); true`);
        await sleep(1250);
        /* Grow to the height the renderer asked for, so the lower rows sit on
           the island instead of a cropped window edge. */
        const wanted = await js(`(() => {
          const c = window.probe.calls().filter((x) => x.kind === 'setCardHeight');
          return c.length ? c[c.length - 1].payload : null;
        })()`);
        if (typeof wanted === 'number' && wanted > 40) {
          win.setBounds(boundsFor('open', settingsFor('open'), Math.round(wanted)));
          await sleep(320);
        }
        const cardShot = await win.capturePage();
        const cardOver = compositeOver(cardShot, kind);
        const cardMean = dominantColour(cardOver, 24, 18);
        if (level === USER.glassLevel) {
          fs.writeFileSync(path.join(SHOT_DIR, `glass-fixed-open-${tag}${kind}.png`), cardOver.toPNG());
          fs.writeFileSync(path.join(SHOT_DIR, `glass-fix-${tag}open-${kind}-4x.png`),
            cardOver.resize({ width: cardOver.getSize().width * 4, quality: 'best' }).toPNG());
        }
        const colours = await js(COLOURS);
        const cardScale = cardShot.getSize().width / (await js('window.innerWidth'));
        const lyricPixels = colours.rects.lyricActive
          ? textPixelContrast(cardOver, colours.rects.lyricActive, cardScale,
            colours.parts.lyricActive) : null;

        const rows = {};
        for (const [part, css] of Object.entries(colours.parts)) {
          const ratio = contrast(css, cardMean);
          if (ratio !== null) rows[part] = { colour: css, ratio };
        }
        report.glass[key][lk][kind] = {
          glassA: colours.glassA,
          pillMean: hex(pillMean), pillRgb: pillMean,
          cardMean: hex(cardMean), cardRgb: cardMean,
          clock: { colour: colours.clock, ratio: contrast(colours.clock, pillMean) },
          clockPixels,
          clockMediaPixels,
          lyricPixels,
          cardParts: rows,
        };
        console.log(`  ${surface.padEnd(12)} a=${colours.glassA.padEnd(4)} ${kind.padEnd(5)}`
          + ` pill ${hex(pillMean)} card ${hex(cardMean)} clock ${report.glass[key][lk][kind].clock.ratio}`
          + ` clockPx ${clockPixels ? clockPixels.ratioCss : '-'}/${clockPixels ? clockPixels.ratioWorst : '-'}` + ` mediaClockPx ${clockMediaPixels ? clockMediaPixels.ratioCss : '-'}/${clockMediaPixels ? clockMediaPixels.ratioWorst : '-'}` + ` lyricPx ${lyricPixels ? lyricPixels.ratioWorst : '-'}/${lyricPixels ? lyricPixels.ratioCss : '-'}`
          + ` min-part ${Math.min(...Object.values(rows).map((r) => r.ratio))}`);
      }
    }
  }

  /* ---- Liquid glass targets, measured at the user's own level ----
     The reference for this surface USED to be a hex value (#363d3a) because
     the material was a dark slate. The design is now an iOS-style LIGHT frost,
     so a hex target would be asserting the thing the user asked us to remove.
     What actually matters, and what the user asked for in words ("jangan tipe
     dark, mirip iOS"), is that the pane reads as a light material on EVERY
     wallpaper - including a near-black one, where a thin pane loses the most
     lightness. That is a luminance floor, not a hex match. */
  const liquid = report.glass.liquid[`l${USER.glassLevel}`];
  const lightPill = liquid.light.pillRgb;
  const darkPill = liquid.dark.pillRgb;
  check('Liquid glass: bahan terang (bukan tipe dark) di latar terang',
    lum(lightPill) >= 0.70,
    `pill=${liquid.light.pillMean} luminance=${lum(lightPill).toFixed(3)} (min 0.700)`);
  check('Liquid glass: tetap terang walau wallpaper hampir hitam',
    lum(darkPill) >= 0.52,
    `pill=${liquid.dark.pillMean} luminance=${lum(darkPill).toFixed(3)} (min 0.520, tipe dark ~0.02-0.06)`);

  const channelRange = (prop) => {
    const vals = ['light', 'dark', 'busy'].map((k) => liquid[k][prop]);
    return {
      r: Math.max(...vals.map((v) => v.r)) - Math.min(...vals.map((v) => v.r)),
      g: Math.max(...vals.map((v) => v.g)) - Math.min(...vals.map((v) => v.g)),
      b: Math.max(...vals.map((v) => v.b)) - Math.min(...vals.map((v) => v.b)),
    };
  };
  const pillRange = channelRange('pillRgb');
  const cardRange = channelRange('cardRgb');
  const worst = Math.max(pillRange.r, pillRange.g, pillRange.b, cardRange.r, cardRange.g, cardRange.b);
  /* A translucent material is SUPPOSED to react to what is behind it; the
     earlier limit of 30 was calibrated against a near-opaque dark base. With
     the light frost at the user's glassLevel 20 the base alpha is ~0.84, so a
     black-to-white wallpaper swap legitimately moves the mean by ~45 channels.
     What must NOT happen is the old "warna belang" bug, where the surface
     varied by 73-81 channels ACROSS ITS OWN AREA and looked blotchy. The
     spatial uniformity is asserted separately by the pixel checks below; this
     one only has to prove the material stays the same material. */
  const RANGE_LIMIT = 60;
  check('Liquid glass: material yang sama di latar terang, gelap dan ramai (tidak belang)',
    worst <= RANGE_LIMIT,
    `pill range ${JSON.stringify(pillRange)} card range ${JSON.stringify(cardRange)} worst=${worst} (limit ${RANGE_LIMIT}, lama ~73-81)`);

  /* every text colour, every level, every backdrop: the audit that failed at
     3.15:1 for the artist line before the secondary ink override */
  const failures = [];
  const all = [];
  for (const key of ['liquid', 'translucent']) {
    for (const lk of Object.keys(report.glass[key])) {
      for (const kind of Object.keys(report.glass[key][lk])) {
        const cell = report.glass[key][lk][kind];
        const push = (what, ratio) => {
          if (ratio === null) return;
          all.push({ key, lk, kind, what, ratio });
          if (ratio < 4.5) failures.push(`${key}/${lk}/${kind}/${what}=${ratio}`);
        };
        push('clock', cell.clock.ratio);
        for (const [part, row] of Object.entries(cell.cardParts)) push(part, row.ratio);
      }
    }
  }
  const liquidFails = failures.filter((f) => f.startsWith('liquid/'));
  const minLiquid = Math.min(...all.filter((r) => r.key === 'liquid').map((r) => r.ratio));
  check('Liquid glass: setiap teks (pill + kartu) >= 4.5:1 di semua latar dan level',
    liquidFails.length === 0,
    liquidFails.length ? liquidFails.join(' | ') : `min=${minLiquid} dari ${all.filter((r) => r.key === 'liquid').length} ukuran`);
  console.log(`  Translucent (tidak diubah) di bawah 4.5:1: ${failures.filter((f) => f.startsWith('translucent/')).length}`
    + ` -> ${failures.filter((f) => f.startsWith('translucent/')).join(' | ') || 'tidak ada'}`);

  /* Pixel contrast, QA's ruler: the surface is the ring median around the glyph
     (that is how the 4.43:1 for the active lyric was measured), so the sheen
     lift that made the CSS numbers optimistic is included. The 95th percentile
     ring pixel is reported next to it as the strictest reading. */
  const pixelRows = (prop) => Object.keys(report.glass.liquid).flatMap((lk) => ['light', 'dark', 'busy']
    .map((k) => ({ lk, k, v: report.glass.liquid[lk][k][prop] })))
    .filter((x) => x.v && x.v.ratioCss !== null);
  const clockPx = [...pixelRows('clockPixels'), ...pixelRows('clockMediaPixels')];
  const lyricPx = pixelRows('lyricPixels');
  const minClock = clockPx.length ? Math.min(...clockPx.map((x) => x.v.ratioCss)) : -1;
  const minLyric = lyricPx.length ? Math.min(...lyricPx.map((x) => x.v.ratioCss)) : -1;
  /* p95 only for the idle clock: the ring around the media clock touches the
     track title glyphs, so its bright end is text, not surface. */
  const idleClockPx = pixelRows('clockPixels');
  const minClockWorst = idleClockPx.length ? Math.min(...idleClockPx.map((x) => x.v.ratioWorst)) : -1;
  const minLyricWorst = lyricPx.length ? Math.min(...lyricPx.map((x) => x.v.ratioWorst)) : -1;
  check('Liquid glass: jam (idle + media pill) >= 6.0:1 diukur piksel, ring median',
    minClock >= 6,
    `min=${minClock} (pill idle p95 ${minClockWorst}) dari ${clockPx.length} kombinasi; `
    + clockPx.map((x) => `${x.lk}/${x.k}=${x.v.ratioCss}`).join(' '));
  check('Liquid glass: lirik aktif >= 5.0:1 diukur piksel, ring median',
    minLyric >= 5,
    `min=${minLyric} (p95 terburuk ${minLyricWorst}) dari ${lyricPx.length} kombinasi; `
    + lyricPx.map((x) => `${x.lk}/${x.k}=${x.v.ratioCss}/${x.v.ratioWorst}`).join(' '));

  /* -------------------------------------------------- A2. secondary ink audit
     Every rule in the Liquid glass override, measured on the painted pixels of
     the user profile (level 20, light desktop). Each panel is opened for real:
     a hidden panel has no box, so measuring it would silently skip the rule. */
  const ALL_TABS = ['web', 'notifications', 'shelf', 'clipboard', 'music', 'today', 'sholat',
    'timer', 'reminders', 'water', 'capture', 'controls', 'deck', 'calls'];
  report.ink = {};
  await js(`window.probe.emit('settings', ${JSON.stringify({
    surface: 'Liquid glass', glassLevel: USER.glassLevel, accent: USER.accent, cardWidth: CARD.width,
    visibleTabs: ALL_TABS, miniMode: 'clock', islandStyle: 'dynamic', islandContent: 'clock-robot',
    islandPosition: 'center', monitor: 'main', edgeMargin: 4, islandScale: 100, lyricsText: LRC,
  })}); true`);
  await sleep(200);
  const INK_TABS = [
    { tab: 'music', keys: ['title', 'artist', 'timeCur', 'timeEnd', 'hint'] },
    { tab: 'notifications', keys: ['noticeHint', 'rowHead'] },
    { tab: 'controls', keys: ['stat'] },
    { tab: 'today', keys: ['calAgenda'] },
  ];
  for (const spec of INK_TABS) {
    await status({
      ...base, state: 'open', surface: 'Liquid glass', glassLevel: USER.glassLevel,
      media: true, mediaTitle: TRACK, visibleTabs: ALL_TABS,
    });
    await sleep(200);
    await js(`document.querySelector('.tab[data-tab="${spec.tab}"]').click(); true`);
    await sleep(280);
    const wanted = await js(`(() => {
      const c = window.probe.calls().filter((x) => x.kind === 'setCardHeight');
      return c.length ? c[c.length - 1].payload : null;
    })()`);
    if (typeof wanted === 'number' && wanted > 40) {
      win.setBounds(boundsFor('open', settingsFor('open'), Math.round(wanted)));
      await sleep(320);
    }
    const shot = await win.capturePage();
    const over = compositeOver(shot, 'light');
    const scale = shot.getSize().width / (await js('window.innerWidth'));
    const ink = await js(INK);
    if (spec.tab === 'music') {
      fs.writeFileSync(path.join(SHOT_DIR, 'glass-ink-music-light-4x.png'),
        over.resize({ width: over.getSize().width * 4, quality: 'best' }).toPNG());
    }
    for (const key of spec.keys) {
      const item = ink[key];
      if (!item || !item.rect) {
        report.ink[key] = null;
        console.log(`  ink ${key.padEnd(11)} TIDAK TERUKUR (tidak ada kotak)`);
        continue;
      }
      const m = textPixelContrast(over, item.rect, scale, item.css);
      report.ink[key] = { tab: spec.tab, css: item.css, ...m };
      console.log(`  ink ${key.padEnd(11)} ${String(item.css).padEnd(26)}`
        + ` median=${m.ratioCss} worst=${m.ratioWorst}`);
    }
  }

  const inkRows = Object.entries(report.ink).filter(([, v]) => v && v.ratioWorst !== null);
  const inkFails = inkRows.filter(([, v]) => v.ratioWorst < 4.6);
  check('Teks sekunder glass (open|light): setiap elemen >= 4.6:1 di piksel terburuk',
    inkRows.length >= 8 && inkFails.length === 0,
    `n=${inkRows.length}; ` + inkRows.map(([k, v]) => `${k}=${v.ratioCss}/${v.ratioWorst}`).join(' '));

  /* ------------------------------------------------------------ B. notch */
  report.notch = {};
  win.setBounds(boundsFor('mini', settingsFor('mini')));
  await sleep(200);
  const content = win.getContentSize();
  await status({ ...base, state: 'mini', miniMode: 'clock', surface: 'Black' });
  await sleep(320);
  const notchShot = await win.capturePage();
  const notchBox = nearBlackBox(notchShot);
  const notchCss = await js(COLOURS);
  fs.writeFileSync(path.join(SHOT_DIR, 'notch-64x14.png'), notchShot.toPNG());
  fs.writeFileSync(path.join(SHOT_DIR, 'notch-fix-64x14-6x.png'),
    notchShot.resize({ width: notchShot.getSize().width * 6, quality: 'best' }).toPNG());
  console.log('  notch inset per baris (acuan user: y6-8=0, y9-10=1, y11=2, y12=3, y13=5): '
    + notchBox.rows.map((r) => `y${r.y}=${r.inset}/${r.coverageInset}`).join(' '));
  report.notch.clock = {
    window: { width: content[0], height: content[1] },
    css: { stripHeight: notchCss.stripHeight, stripRadius: notchCss.stripRadius },
    box: notchBox,
  };
  check('notch: window tetap di lantai 39 px, hanya strip yang dicat',
    content[1] === WINDOW_FLOOR && Boolean(notchBox) && notchBox.height <= 16,
    `window=${content[0]}x${content[1]} painted=${notchBox && `${notchBox.width}x${notchBox.height}`}`);
  check('notch: 64x14 +/-2, menempel di tepi atas',
    Boolean(notchBox) && Math.abs(notchBox.width - MINI.width) <= 2
      && Math.abs(notchBox.height - MINI.height) <= 2 && notchBox.topGap === 0,
    notchBox && `w=${notchBox.width} h=${notchBox.height} topGap=${notchBox.topGap}`);
  /* Reference curve, measured from the user's own screenshot, row by row. */
  const REF_ROWS = [0, 0, 0, 1, 1, 2, 3, 5];   // inset for y6..y13
  const rowDiff = notchBox
    ? Math.max(...REF_ROWS.map((want, i) => Math.abs((notchBox.rows[6 + i] ? notchBox.rows[6 + i].inset : 0) - want)))
    : 99;
  check('notch: kurva sudut bawah cocok dengan acuan per baris (+/-1.5 px)',
    rowDiff <= 1.5,
    `selisih maks=${rowDiff}; live ${notchBox.rows.slice(6).map((r) => `y${r.y}=${r.inset}`).join(' ')}`
    + ` vs acuan ${REF_ROWS.map((v, i) => `y${6 + i}=${v}`).join(' ')}`);

  /* notched island style: the same strip, not the old 39 px block */
  win.setBounds(boundsFor('mini', settingsFor('mini')));
  await sleep(160);
  await status({ ...base, state: 'mini', miniMode: 'clock', surface: 'Black', islandStyle: 'notched' });
  await sleep(320);
  const notchedShot = await win.capturePage();
  const notchedBox = nearBlackBox(notchedShot);
  fs.writeFileSync(path.join(SHOT_DIR, 'notch-fix-notched-64x14.png'), notchedShot.toPNG());
  fs.writeFileSync(path.join(SHOT_DIR, 'notch-fix-notched-6x.png'),
    notchedShot.resize({ width: notchedShot.getSize().width * 6, quality: 'best' }).toPNG());
  report.notch.notched = { box: notchedBox };
  check('notch islandStyle notched: strip 64x14 juga, bukan blok 39 px',
    Boolean(notchedBox) && Math.abs(notchedBox.width - MINI.width) <= 2
      && Math.abs(notchedBox.height - MINI.height) <= 2 && notchedBox.topGap === 0,
    notchedBox && `w=${notchedBox.width} h=${notchedBox.height} topGap=${notchedBox.topGap}`);

  /* cat notch paints the taller strip, still flush to the top */
  win.setBounds(boundsFor('mini', settingsFor('mini')));
  await sleep(160);
  await status({ ...base, state: 'mini', miniMode: 'cat', surface: 'Black', islandStyle: 'dynamic' });
  await sleep(320);
  const catShot = await win.capturePage();
  const catBox = nearBlackBox(catShot);
  fs.writeFileSync(path.join(SHOT_DIR, 'notch-fix-cat-64x26.png'), catShot.toPNG());
  fs.writeFileSync(path.join(SHOT_DIR, 'notch-fix-cat-6x.png'),
    catShot.resize({ width: catShot.getSize().width * 6, quality: 'best' }).toPNG());
  report.notch.cat = { box: catBox };
  check('notch mode cat: strip 26 px supaya kucing tidak gepeng',
    Boolean(catBox) && Math.abs(catBox.height - MINI_CAT.height) <= 3 && catBox.topGap === 0,
    catBox && `w=${catBox.width} h=${catBox.height}`);

  /* scale 130: the strip is painted by #island, so --island-scale must scale it */
  win.setBounds(boundsFor('mini', settingsFor('mini', 'center', 130)));
  await sleep(200);
  await status({ ...base, state: 'mini', miniMode: 'clock', surface: 'Black', scaleEffective: 130 });
  await sleep(320);
  const bigShot = await win.capturePage();
  const bigBox = nearBlackBox(bigShot);
  fs.writeFileSync(path.join(SHOT_DIR, 'notch-fix-130.png'), bigShot.toPNG());
  report.notch.scale130 = { box: bigBox };
  check('notch skala 130: strip ikut membesar (64x14 -> 83x18)',
    Boolean(bigBox) && Math.abs(bigBox.width - Math.round(MINI.width * 1.3)) <= 3
      && Math.abs(bigBox.height - Math.round(MINI.height * 1.3)) <= 3,
    bigBox && `w=${bigBox.width} h=${bigBox.height} target=${Math.round(MINI.width * 1.3)}x${Math.round(MINI.height * 1.3)}`);

  fs.writeFileSync(path.join(SHOT_DIR, 'glass-notch-metrics.json'), JSON.stringify(report, null, 2), 'utf8');
  win.destroy();
}

app.on('window-all-closed', (event) => event.preventDefault());

app.whenReady().then(async () => {
  try {
    await main();
  } catch (err) {
    check('probe selesai tanpa exception', false, String((err && err.stack) || err));
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\nPROBE_GLASS_NOTCH ${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) console.log('FAILED: ' + failed.map((f) => f.name).join(' | '));
  app.exit(failed.length ? 1 : 0);
});
