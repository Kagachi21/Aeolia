/* QA Yan - glass contrast AFTER the "liquid glass basis stabil" fix.
 * Clone of _probe-contrast.js (the BEFORE baseline generator) with exactly two
 * differences, so BEFORE and AFTER are measured by the same ruler:
 *   1. CSS + markup are pinned to the WORKING TREE (src/renderer/), because the
 *      fix lives there; the BEFORE run pinned them to git HEAD.
 *   2. Only the repo profile is measured (the installed 90045ec build is the
 *      old shipped app, not part of a BEFORE-vs-AFTER comparison), and the
 *      output goes to glass-contrast-after.json / .txt.
 *
 * A. For surface "Liquid glass" in state pill and open, on three backgrounds
 *    (light / dark / busy): mean surface colour, and per-element WCAG contrast
 *    of the real text colour against the surface sampled FROM THE CAPTURE
 *    (median of the pixels behind the text box, not the CSS background).
 * B. Whether the pill actually reacts to a playing track: is the title a
 *    running marquee or static truncation, does data-media flip, is the
 *    visualiser animating, does it return to the clock when playback stops.
 *
 * The repo build is snapshotted to a temp dir first, so a concurrent rebuild
 * by the engineer cannot change the numbers half way through the run.
 *
 * Run: env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe _probe-contrast-after.js
 */
const { app, BrowserWindow, nativeImage, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');

app.commandLine.appendSwitch('force-device-scale-factor', '1');

const root = __dirname;
const SHOT_DIR = path.join(root, '.superpowers', 'shots');
const STATE_PATH = path.join(root, '_qa-state.json');
const INSTALLED_HTML = 'C:\\Users\\Lycaon\\AppData\\Local\\Programs\\Aeolia Island\\resources\\app\\dist\\renderer\\index.html';
const { boundsFor } = require(path.join(root, 'dist', 'main', 'bounds.js'));
const { dropThickFrame } = require(path.join(root, 'dist', 'main', 'thinFrame.js'));

const ALL_TABS = ['web', 'notifications', 'shelf', 'clipboard', 'music', 'today',
  'sholat', 'timer', 'reminders', 'water', 'capture', 'controls', 'deck', 'calls'];
const BASE_SETTINGS = {
  islandScale: 100, monitor: 'main', islandPosition: 'center', edgeMargin: 4,
  islandStyle: 'dynamic', cardWidth: 360,
  pill: { width: 150, height: 36 }, mini: { width: 112, height: 26 }, open: { width: 360, height: 92 },
};
const GLASS = { surface: 'Liquid glass', glassLevel: 70, accent: '#e9eef7' };
/* Smallest surface ring (in pixels) a ratio is allowed to be built on. The
   tightest real ring here is the 11.5 px time label at ~300 px; anything under
   this is a degenerate sample, not a measurement. */
const MIN_RING = 150;
/* The values actually on this machine (settings.json: Liquid glass, level 20,
   accent #6ea8ff). The repo profile above keeps the BEFORE/AFTER comparison
   comparable; this one answers "what does the user see". */
const USER_GLASS = { surface: 'Liquid glass', glassLevel: 20, accent: '#6ea8ff' };

const BG = {
  light: () => ({ r: 238, g: 241, b: 245 }),
  dark: () => ({ r: 17, g: 19, b: 24 }),
  busy: (x, y) => ((((x / 12) | 0) + ((y / 12) | 0)) % 2
    ? { r: 232, g: 76, b: 61 }
    : { r: 32, g: 122, b: 214 }),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (win, code) => win.webContents.executeJavaScript(code);
const log = [];
const say = (s) => { log.push(s); console.log(s); };

/* ---------- WCAG ---------- */
const lin = (c) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const luminance = ({ r, g, b }) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => {
  const la = luminance(a); const lb = luminance(b);
  return +(((Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05))).toFixed(2);
};
const rgbCss = ({ r, g, b }) => `rgb(${r},${g},${b})`;

function flattenBuffer(img, bgFn) {
  const size = img.getSize();
  const src = img.toBitmap();
  const out = Buffer.alloc(src.length);
  for (let i = 0, p = 0; i < src.length; i += 4, p += 1) {
    const a = src[i + 3] / 255;
    const x = p % size.width;
    const y = (p / size.width) | 0;
    const bg = bgFn(x, y);
    out[i] = Math.min(255, Math.round(src[i] + bg.b * (1 - a)));
    out[i + 1] = Math.min(255, Math.round(src[i + 1] + bg.g * (1 - a)));
    out[i + 2] = Math.min(255, Math.round(src[i + 2] + bg.r * (1 - a)));
    out[i + 3] = 255;
  }
  return { buf: out, size };
}

const meanOver = (flat, rect) => {
  const { width, height } = flat.size;
  const x0 = Math.max(0, Math.round(rect.x));
  const y0 = Math.max(0, Math.round(rect.y));
  const x1 = Math.min(width - 1, Math.round(rect.x + rect.w) - 1);
  const y1 = Math.min(height - 1, Math.round(rect.y + rect.h) - 1);
  let r = 0; let g = 0; let b = 0; let n = 0;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const i = (y * width + x) * 4;
      b += flat.buf[i]; g += flat.buf[i + 1]; r += flat.buf[i + 2]; n += 1;
    }
  }
  if (!n) return null;
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n), samples: n };
};

/** Surface behind a text box, sampled from a glyph-free ring around it.
 *  Returns luminance percentiles so a textured (translucent over busy)
 *  surface is reported as a range instead of a fake single colour. */
const surfaceRing = (flat, rect, pad) => {
  const { width, height } = flat.size;
  const x0 = Math.max(0, Math.floor(rect.x - pad));
  const y0 = Math.max(0, Math.floor(rect.y - pad));
  const x1 = Math.min(width - 1, Math.ceil(rect.x + rect.w + pad));
  const y1 = Math.min(height - 1, Math.ceil(rect.y + rect.h + pad));
  const ix0 = Math.floor(rect.x); const iy0 = Math.floor(rect.y);
  const ix1 = Math.ceil(rect.x + rect.w); const iy1 = Math.ceil(rect.y + rect.h);
  const lums = [];
  const rs = []; const gs = []; const bs = [];
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (x >= ix0 && x <= ix1 && y >= iy0 && y <= iy1) continue; // skip the glyph box
      const i = (y * width + x) * 4;
      const px = { r: flat.buf[i + 2], g: flat.buf[i + 1], b: flat.buf[i] };
      lums.push(luminance(px));
      rs.push(px.r); gs.push(px.g); bs.push(px.b);
    }
  }
  if (!lums.length) return null;
  const at = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
  const sorted = lums.slice().sort((a, b) => a - b);
  const med = (arr) => arr.slice().sort((a, b) => a - b)[Math.floor(arr.length / 2)];
  return {
    ringSamples: lums.length,
    l10: +at(sorted, 0.1).toFixed(4),
    l50: +at(sorted, 0.5).toFixed(4),
    l90: +at(sorted, 0.9).toFixed(4),
    uniformity: +(at(sorted, 0.9) - at(sorted, 0.1)).toFixed(4),
    medianRgb: rgbCss({ r: med(rs), g: med(gs), b: med(bs) }),
  };
};

const ratioFromLum = (lt, ls) => +(((Math.max(lt, ls) + 0.05) / (Math.min(lt, ls) + 0.05))).toFixed(2);

/* Text boxes + their computed colour + effective opacity, read from the DOM. */
const TEXT_BOXES = `(ids) => {
  const flat = (s) => String(s == null ? '' : s).replace(/\\s+/g, ' ').trim();
  const effOpacity = (el) => {
    let o = 1;
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const v = parseFloat(getComputedStyle(n).opacity);
      if (!Number.isNaN(v)) o *= v;
    }
    return +o.toFixed(3);
  };
  /* getComputedStyle().color hands back the colour function verbatim for
     anything outside legacy sRGB: color(srgb ...) after color-mix(), oklch()
     for the active lyric. A hand-written parser has to know every colour space
     and can silently fall back to black. Paint into a 1x1 canvas instead: the
     browser resolves any computed colour to plain sRGB bytes, and a sentinel
     that survives means the value was rejected. Anything still unparsed is a
     hard failure further down, never a reported ratio. */
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const parseColor = (css) => {
    const s = String(css || '').trim();
    if (!s) return { r: null, g: null, b: null, a: 1, format: 'unparsed' };
    cx.fillStyle = '#ff00fe';
    cx.fillStyle = s;
    cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    const rejected = d[0] === 255 && d[1] === 0 && d[2] === 254 && !/ff00fe/i.test(s);
    if (rejected) return { r: null, g: null, b: null, a: 1, format: 'unparsed' };
    return { r: d[0], g: d[1], b: d[2], a: +(d[3] / 255).toFixed(3), format: 'canvas' };
  };
  const one = (label, el) => {
    if (!el) return { label, missing: true };
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const c = parseColor(cs.color);
    return {
      label, text: flat(el.innerText || el.textContent),
      rect: { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) },
      colorCss: cs.color,
      colorFormat: c.format,
      colorParsed: c.r !== null,
      color: { r: c.r, g: c.g, b: c.b },
      alpha: c.a,
      fontSize: cs.fontSize, fontWeight: cs.fontWeight,
      opacityChain: effOpacity(el),
      visible: b.width > 0 && b.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden',
    };
  };
  const out = [];
  for (const [label, sel] of ids) {
    const el = document.querySelector(sel);
    out.push(one(label, el));
  }
  return out;
}`;

const PILL_TEXT = [['track title', '#mediaTrack'], ['clock', '#clock']];
const OPEN_TEXT = [
  ['music title', '#musicTitle'],
  ['artist', '#musicSub'],
  ['active lyric', '.lyric-line.active'],
  ['idle lyric', '.lyric-line:not(.active)'],
  ['time label', '#musicTimeCur'],
];

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

const hashOf = (file) => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 12);

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });

  /* Freeze the repo build so a concurrent rebuild cannot move the numbers.
     CSS and markup are pinned to the COMMIT that carries the glass fix, so the
     AFTER numbers stay tied to a reviewable revision even while the working
     tree keeps changing; the compiled JS comes from dist. */
  const CSS_REF = process.env.AEOLIA_CSS_REF || 'HEAD';
  const snapDir = path.join(os.tmpdir(), `aeolia-renderer-${Date.now()}`);
  fs.cpSync(path.join(root, 'dist', 'renderer'), snapDir, { recursive: true });
  const gitShow = (p) => require('node:child_process').execSync(`git show ${CSS_REF}:${p}`, { cwd: root });
  fs.writeFileSync(path.join(snapDir, 'styles.css'), gitShow('src/renderer/styles.css'));
  fs.writeFileSync(path.join(snapDir, 'index.html'), gitShow('src/renderer/index.html'));
  /* A candidate fix can be measured without touching the product: the override
     is appended to the TEMP stylesheet only, and the run writes its own files
     so it can never be mistaken for the shipped build. */
  const appendFile = process.env.AEOLIA_CSS_APPEND_FILE;
  const outSuffix = process.env.AEOLIA_OUT_SUFFIX || '';
  if (appendFile) {
    fs.appendFileSync(path.join(snapDir, 'styles.css'), `\n${fs.readFileSync(appendFile, 'utf8')}\n`);
    say(`== OVERRIDE KANDIDAT ==\n${fs.readFileSync(appendFile, 'utf8').trim()}\n`);
  }
  const profiles = {
    head: { html: path.join(snapDir, 'index.html'), label: `AFTER (CSS ${CSS_REF})`, glass: GLASS },
    user: { html: path.join(snapDir, 'index.html'), label: `AFTER profil user (level ${USER_GLASS.glassLevel})`, glass: USER_GLASS },
  };
  const provenance = {
    headSnapshotDir: snapDir,
    cssSource: `git ${CSS_REF}:src/renderer/styles.css + index.html`,
    head: {
      stylesCss: hashOf(path.join(snapDir, 'styles.css')),
      rendererJs: hashOf(path.join(snapDir, 'renderer.js')),
      indexHtml: hashOf(path.join(snapDir, 'index.html')),
    },
    gitHead: require('node:child_process').execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim(),
  };

  let previousState = null;
  try { previousState = fs.readFileSync(STATE_PATH, 'utf8'); } catch { previousState = null; }
  fs.writeFileSync(STATE_PATH, JSON.stringify({
    status: { state: 'pill', surface: GLASS.surface, glassLevel: GLASS.glassLevel, accent: '#e9eef7',
      cardWidth: 360, visibleTabs: [...ALL_TABS], miniMode: 'clock', media: true,
      mediaTitle: 'Kavi Rao - Neon Harbor', hiddenUntilHover: false, meeting: false, scaleEffective: 100 },
    settings: { surface: GLASS.surface, glassLevel: GLASS.glassLevel, accent: '#e9eef7', cardWidth: 360,
      visibleTabs: [...ALL_TABS], islandStyle: 'dynamic', islandContent: 'clock-robot',
      miniMode: 'clock', miniTrigger: 'fullscreen', islandPosition: 'center', monitor: 'main',
      edgeMargin: 4, islandScale: 100, pillLyrics: false },
    card: { lastTab: 'music', notices: [], clips: [], sites: [], shelf: [], tasks: [] },
  }, null, 2), 'utf8');

  const pillB = boundsFor('pill', BASE_SETTINGS);
  const openB = boundsFor('open', BASE_SETTINGS);
  const win = makeWindow(pillB.width, pillB.height);
  const result = { provenance, generatedAt: new Date().toISOString(), surfaces: {}, pillReaction: {} };
  const unparsed = [];
  const weakRings = [];
  const inversions = [];

  /* ================= A. contrast baseline ================= */
  /* The clock has two colours on Liquid glass: media playing vs idle. Measuring
     only the media pill would let a regression in the idle one hide, so both
     are captured under separate keys. */
  const VARIANTS = [
    { state: 'pill', key: 'pill', media: true },
    { state: 'pill', key: 'pill-idle', media: false },
    { state: 'open', key: 'open', media: true },
  ];
  for (const [key, prof] of Object.entries(profiles)) {
    const g = prof.glass || GLASS;
    for (const variant of VARIANTS) {
      const state = variant.state;
      const target = state === 'pill' ? pillB : { x: openB.x, y: openB.y, width: openB.width, height: 300 };
      win.setBounds(target);
      await win.loadFile(prof.html);
      win.showInactive();
      await sleep(320);
      await js(win, `window.probe.emit('settings', ${JSON.stringify({
        ...g, visibleTabs: ['music'], miniMode: 'clock', islandScale: 100,
      })}); true`);
      await js(win, `window.probe.emit('status', ${JSON.stringify({
        state, visibleTabs: ['music'], media: variant.media,
        mediaTitle: variant.media ? 'Kavi Rao - Neon Harbor' : '',
        miniMode: 'clock', surface: g.surface, glassLevel: g.glassLevel,
        accent: g.accent, meeting: false, scaleEffective: 100,
      })}); true`);
      await sleep(260);
      if (state === 'open') {
        await js(win, `document.querySelector('.tab[data-tab="music"]').click(); true`);
        await sleep(300);
        await js(win, `window.probe.emit('lyrics', { title: 'Kavi Rao - Neon Harbor', lrc: '[00:01.00] satu\\n[00:04.00] dua' }); true`);
        await sleep(1200);
        /* Fit the window to the card the renderer asked for, so the surface
           under the lower rows is island, not a cropped window edge. */
        const h = await js(win, `(() => { const c = window.probe.calls().filter((x) => x.kind === 'setCardHeight');
          return c.length ? c[c.length - 1].payload : null; })()`);
        if (typeof h === 'number' && h > 40) {
          win.setBounds({ x: openB.x, y: openB.y, width: openB.width, height: Math.round(h) });
          await sleep(320);
        }
      }

      /* Warm-up capture: a stale/partial first frame on a transparent window
         would silently poison every number below. */
      await win.capturePage();
      await sleep(220);

      const boxes = await js(win, `(${TEXT_BOXES})(${JSON.stringify(state === 'pill' ? PILL_TEXT : OPEN_TEXT)})`);
      const img = await win.capturePage();
      const islandRect = await js(win, `(() => { const b = document.getElementById('island').getBoundingClientRect();
        return { x: b.x, y: b.y, w: b.width, h: b.height }; })()`);

      for (const bgKind of ['light', 'dark', 'busy']) {
        const flat = flattenBuffer(img, BG[bgKind]);
        const flatImg = nativeImage.createFromBitmap(flat.buf, flat.size);
        const file4x = `contrast-${key}-${variant.key}-${bgKind}-4x.png`;
        fs.writeFileSync(path.join(SHOT_DIR, file4x),
          flatImg.resize({ width: flat.size.width * 4, quality: 'best' }).toPNG());
        fs.writeFileSync(path.join(SHOT_DIR, `contrast-${key}-${variant.key}-${bgKind}.png`), flatImg.toPNG());

        const elements = boxes.map((b) => {
          if (b.missing || !b.visible) return { label: b.label, missing: true, visible: false };
          /* No parsed colour means no ratio. Reporting one anyway is how a
             color(srgb ...) text used to look like it passed. */
          if (!b.colorParsed) {
            unparsed.push(`${key}|${variant.key}|${bgKind}/${b.label} (${b.colorFormat}: ${b.colorCss})`);
            return { label: b.label, unparsed: true, colorCss: b.colorCss, colorFormat: b.colorFormat };
          }
          const surface = surfaceRing(flat, b.rect, 4);
          if (!surface) return { label: b.label, missing: true };
          /* A ring of a handful of pixels can produce a confident-looking ratio
             from almost nothing, which is the same failure mode as an unparsed
             colour. Refuse to report one. */
          if (surface.ringSamples < MIN_RING) {
            weakRings.push(`${key}|${variant.key}|${bgKind}/${b.label} (${surface.ringSamples} px < ${MIN_RING})`);
            return { label: b.label, weak: true, ringSamples: surface.ringSamples };
          }
          const a = b.alpha * b.opacityChain;
          const blended = {
            r: Math.round(surface.medianRgb.match(/\d+/g).map(Number)[0] * (1 - a) + b.color.r * a),
            g: Math.round(surface.medianRgb.match(/\d+/g).map(Number)[1] * (1 - a) + b.color.g * a),
            b: Math.round(surface.medianRgb.match(/\d+/g).map(Number)[2] * (1 - a) + b.color.b * a),
          };
          const lt = luminance(blended);
          const mid = ratioFromLum(lt, surface.l50);
          /* contrastMin/Max come from the ring's dark/light percentile, so the
             SMALLER number is the worst case for light text. worst/best make
             that explicit; contrastMin/Max keep their old values so previously
             published numbers stay comparable. */
          const cMin = ratioFromLum(lt, surface.l10);
          const cMax = ratioFromLum(lt, surface.l90);
          /* Light ink on a dark pane: the worst ring sample can never exceed
             the median. Catching that here makes an inverted column impossible
             to publish. */
          if (Math.min(cMin, cMax) > mid + 0.01) {
            inversions.push(`${key}|${variant.key}|${bgKind}/${b.label} worst ${Math.min(cMin, cMax)} > median ${mid}`);
          }
          return {
            label: b.label, text: b.text, rect: b.rect,
            colorCss: b.colorCss, colorFormat: b.colorFormat,
            fontSize: b.fontSize, fontWeight: b.fontWeight,
            alphaUsed: +a.toFixed(3),
            surfaceMedianRgb: surface.medianRgb,
            surfaceRingSamples: surface.ringSamples,
            surfaceUniformity: surface.uniformity,
            textOnSurface: rgbCss(blended),
            contrastRatio: mid,
            contrastMin: cMin,
            contrastMax: cMax,
            worst: Math.min(cMin, cMax),
            best: Math.max(cMin, cMax),
            passesAA: mid >= 4.5,
          };
        });

        const mean = meanOver(flat, islandRect);
        result.surfaces[`${key}|${variant.key}|${bgKind}`] = {
          profile: key, state: variant.key, media: variant.media, background: bgKind,
          window: flat.size, islandRect,
          meanSurfaceColor: mean ? rgbCss(mean) : null,
          elements, shot4x: file4x,
        };
      }
    }
  }

  /* ================= B. pill reaction ================= */
  win.setBounds(pillB);
  await win.loadFile(profiles.head.html);
  win.showInactive();
  await sleep(320);
  await js(win, `window.probe.emit('settings', ${JSON.stringify({
    ...GLASS, visibleTabs: ['music'], miniMode: 'clock', islandScale: 100,
  })}); true`);
  await js(win, `window.probe.emit('status', ${JSON.stringify({
    state: 'pill', media: true, mediaTitle: 'Kavi Rao - Neon Harbor', miniMode: 'clock',
    surface: GLASS.surface, glassLevel: GLASS.glassLevel, meeting: false, scaleEffective: 100,
  })}); true`);
  await sleep(700);

  const PROBE = `(() => {
    const island = document.getElementById('island');
    const mt = document.getElementById('mediaText');
    const track = document.getElementById('mediaTrack');
    const viz = document.getElementById('mediaViz');
    const bars = Array.from(document.querySelectorAll('#mediaViz i')).map((el) => {
      const b = el.getBoundingClientRect();
      return { w: +b.width.toFixed(2), h: +b.height.toFixed(2) };
    });
    const tb = track ? track.getBoundingClientRect() : null;
    const vb = viz ? viz.getBoundingClientRect() : null;
    return {
      media: island.dataset.media,
      scroll: mt ? mt.dataset.scroll : null,
      speed: mt ? mt.dataset.speed : null,
      scrollWidth: mt ? mt.scrollWidth : null,
      clientWidth: mt ? mt.clientWidth : null,
      trackLeft: tb ? +tb.left.toFixed(2) : null,
      trackRight: tb ? +tb.right.toFixed(2) : null,
      vizDisplay: viz ? getComputedStyle(viz).display : null,
      vizVisible: !!(viz && viz.getBoundingClientRect().width > 0),
      vizRect: vb ? { x: +vb.x.toFixed(1), w: +vb.width.toFixed(1) } : null,
      bars,
      islandText: String(island.innerText || '').replace(/\\s+/g, ' ').trim(),
      trackTransform: track ? getComputedStyle(track).transform : null,
    };
  })()`;

  const samples = [];
  for (let i = 0; i < 5; i += 1) {
    samples.push({ t: i * 400, ...(await js(win, PROBE)) });
    if (i < 4) await sleep(400);
  }
  const vizLater = await js(win, PROBE);
  const shotPill = await win.capturePage();
  const pillFlat = flattenBuffer(shotPill, BG.light);
  fs.writeFileSync(path.join(SHOT_DIR, 'contrast-pill-reaction-4x.png'),
    nativeImage.createFromBitmap(pillFlat.buf, pillFlat.size).resize({ width: pillFlat.size.width * 4, quality: 'best' }).toPNG());

  /* playback stops -> data-media false and the clock returns */
  await js(win, `window.probe.emit('status', ${JSON.stringify({
    state: 'pill', media: false, mediaTitle: '', miniMode: 'clock',
  })}); true`);
  await sleep(700);
  const stopped = await js(win, PROBE);

  result.pillReaction = {
    window: pillB, samples, vizLater, stopped,
    trackLeftSeries: samples.map((s) => s.trackLeft),
    barSeries: [...samples.map((s) => s.bars), vizLater.bars],
  };

  /* ---------- report ---------- */
  say('== A. KONTRAS AFTER (Liquid glass) ==');
  say(`git HEAD ${provenance.gitHead}; head snapshot styles.css ${provenance.head.stylesCss} renderer.js ${provenance.head.rendererJs}`);
  say(`profil repo: level ${GLASS.glassLevel} accent ${GLASS.accent} | profil user: level ${USER_GLASS.glassLevel} accent ${USER_GLASS.accent}`);
  for (const [k, v] of Object.entries(result.surfaces)) {
    say(`${k}  window ${v.window.width}x${v.window.height}  meanSurface ${v.meanSurfaceColor}`);
    for (const el of v.elements) {
      if (el.unparsed) { say(`   - ${el.label}: UNPARSED colour ${el.colorFormat} "${el.colorCss}" -> no ratio`); continue; }
      if (el.weak) { say(`   - ${el.label}: RING TERLALU KECIL (${el.ringSamples} px) -> no ratio`); continue; }
      if (el.missing) { say(`   - ${el.label}: (not rendered)`); continue; }
      say(`   - ${el.label}: "${el.text.slice(0, 34)}" color ${el.colorCss} [${el.colorFormat || 'rgb'}] a=${el.alphaUsed} surface ${el.surfaceMedianRgb} (ring ${el.surfaceRingSamples}px, spread ${el.surfaceUniformity}) -> ${el.contrastRatio}:1 [min ${el.contrastMin} .. max ${el.contrastMax}] ${el.passesAA ? 'PASS' : 'FAIL<4.5'}`);
    }
  }
  const fails = Object.entries(result.surfaces).flatMap(([k, v]) => v.elements
    .filter((e) => !e.missing && !e.unparsed && !e.weak && !e.passesAA)
    .map((e) => `${k}/${e.label} ${e.contrastRatio}:1`));
  const measured = Object.entries(result.surfaces).flatMap(([k, v]) => v.elements
    .filter((e) => !e.missing && !e.unparsed && !e.weak));
  const tightest = measured.slice().sort((a, b) => a.surfaceRingSamples - b.surfaceRingSamples)[0];
  say(`RINGKASAN <4.5:1 (${fails.length}): ${fails.join(' | ') || 'none'}`);
  say(`ELEMEN TAK TERPARSE (${unparsed.length}): ${unparsed.join(' | ') || 'none'}`);
  say(`RING TERLALU KECIL (${weakRings.length}): ${weakRings.join(' | ') || 'none'}`);
  say(`INVERSI worst>median (${inversions.length}): ${inversions.join(' | ') || 'none'}`);
  say(`SAMPEL: ${measured.length} elemen terukur, ring terkecil ${tightest ? tightest.surfaceRingSamples : 0} px (${tightest ? tightest.label : '-'}), batas ${MIN_RING} px`);
  result.unparsed = unparsed;
  result.weakRings = weakRings;
  result.inversions = inversions;

  say('== B. PILL REAKSI ==');
  const s0 = samples[0];
  say(`data-media=${s0.media} data-scroll=${s0.scroll} data-speed=${s0.speed} scrollWidth=${s0.scrollWidth} clientWidth=${s0.clientWidth}`);
  say(`trackLeft series (ms:px) ${samples.map((s) => `${s.t}:${s.trackLeft}`).join('  ')}`);
  say(`track transform sample0=${s0.trackTransform}`);
  say(`viz display=${s0.vizDisplay} visible=${s0.vizVisible} rect=${JSON.stringify(s0.vizRect)}`);
  say(`bar heights t0=${JSON.stringify(samples[0].bars.map((b) => b.h))} t+1600=${JSON.stringify(vizLater.bars.map((b) => b.h))}`);
  say(`islandText playing="${s0.islandText}"`);
  say(`stopped: data-media=${stopped.media} islandText="${stopped.islandText}" viz=${stopped.vizDisplay}`);

  fs.writeFileSync(path.join(SHOT_DIR, `glass-contrast-after${outSuffix}.json`), JSON.stringify(result, null, 2), 'utf8');
  fs.writeFileSync(path.join(SHOT_DIR, `glass-contrast-after${outSuffix}.txt`), log.join('\n'), 'utf8');

  /* A colour the ruler cannot read, or a ring too small to trust, must break
     the run - not quietly shrink the report. */
  if (unparsed.length) throw new Error(`${unparsed.length} warna tak terparse: ${unparsed.join(' | ')}`);
  if (weakRings.length) throw new Error(`${weakRings.length} ring terlalu kecil: ${weakRings.join(' | ')}`);
  if (inversions.length) throw new Error(`${inversions.length} inversi worst>median: ${inversions.join(' | ')}`);

  win.destroy();
  fs.rmSync(snapDir, { recursive: true, force: true });
  if (previousState === null) fs.rmSync(STATE_PATH, { force: true });
  else fs.writeFileSync(STATE_PATH, previousState, 'utf8');
}

app.on('window-all-closed', (event) => event.preventDefault());
app.whenReady().then(async () => {
  try {
    await main();
    console.log('\nPROBE_CONTRAST OK');
  } catch (err) {
    console.log('PROBE_CONTRAST ERROR ' + String((err && err.stack) || err));
    app.exit(1);
    return;
  }
  app.exit(0);
});
