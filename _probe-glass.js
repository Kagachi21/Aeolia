/* QA Yan - evidence probe (throwaway, NOT part of the product).
 *
 * A/B the compiled renderer that the user says looked right (the installed
 * app, built from 90045ec) against the repo build (HEAD = b9184d9 + 7b292ad),
 * then capture the music-start flow and the notch, and print the numbers.
 *
 * Nothing here touches src/. It only reads the two index.html trees, drives
 * the real preload seam (_qa-preload.js), measures the live DOM and writes
 * PNGs into .superpowers/shots/.
 *
 * Run: env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe _probe-glass.js
 */
const { app, BrowserWindow, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

app.commandLine.appendSwitch('force-device-scale-factor', '1');

const root = __dirname;
const SHOT_DIR = path.join(root, '.superpowers', 'shots');
const STATE_PATH = path.join(root, '_qa-state.json');
const { boundsFor } = require(path.join(root, 'dist', 'main', 'bounds.js'));
const { dropThickFrame } = require(path.join(root, 'dist', 'main', 'thinFrame.js'));

const BEFORE_HTML = 'C:\\Users\\Lycaon\\AppData\\Local\\Programs\\Aeolia Island\\resources\\app\\dist\\renderer\\index.html';
const AFTER_HTML = path.join(root, 'dist', 'renderer', 'index.html');

const ALL_TABS = [
  'web', 'notifications', 'shelf', 'clipboard', 'music', 'today', 'sholat',
  'timer', 'reminders', 'water', 'capture', 'controls', 'deck', 'calls',
];

/* Mirrors src/main/settings.ts DEFAULTS for the geometry keys. */
const BASE_SETTINGS = {
  islandScale: 100, monitor: 'main', islandPosition: 'center', edgeMargin: 4,
  islandStyle: 'dynamic', cardWidth: 360,
  pill: { width: 150, height: 36 },
  mini: { width: 112, height: 26 },
  open: { width: 360, height: 92 },
};

const GLASS = { surface: 'Liquid glass', glassLevel: 70 };

/* Backgrounds the transparent capture is composited over. 'busy' is a
   saturated 12 px checkerboard so any alpha/tint change is obvious. */
const BG = {
  light: () => ({ r: 238, g: 241, b: 245 }),
  dark: () => ({ r: 17, g: 19, b: 24 }),
  busy: (x, y) => ((((x / 12) | 0) + ((y / 12) | 0)) % 2
    ? { r: 232, g: 76, b: 61 }
    : { r: 32, g: 122, b: 214 }),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (win, code) => win.webContents.executeJavaScript(code);
const metrics = {};
const lines = [];
const say = (s) => { lines.push(s); console.log(s); };

function makeWindow(width, height) {
  /* Mirrors createWindow() in src/main/main.ts: without thickFrame:false +
     resizable:false Windows clamps the window to SM_CYMINTRACK (39 px) and a
     26 px notch would silently be shot at 39 px. */
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
  /* Electron's thickFrame:false does not survive transparent:true, so the app
     strips WS_THICKFRAME itself. Without this the OS clamps every window to
     39 px tall and the 26 px notch is silently shot at 39 px. */
  dropThickFrame(win);
  win.setBounds({ x: 0, y: 0, width, height });
  return win;
}

/** Composite a premultiplied BGRA bitmap over a background. Returns a Buffer. */
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

const imgFrom = ({ buf, size }) => nativeImage.createFromBitmap(buf, size);

/** Mean / max per-channel delta + share of visibly different pixels. */
function diff(a, b) {
  if (a.buf.length !== b.buf.length) return { incompatible: true, aLen: a.buf.length, bLen: b.buf.length };
  let sum = 0;
  let max = 0;
  let over = 0;
  let n = 0;
  let aAlpha = 0;
  let bAlpha = 0;
  for (let i = 0; i < a.buf.length; i += 4) {
    for (let c = 0; c < 3; c += 1) {
      const d = Math.abs(a.buf[i + c] - b.buf[i + c]);
      sum += d;
      if (d > max) max = d;
      if (d > 6) over += 1;
      n += 1;
    }
    aAlpha += a.buf[i + 3];
    bAlpha += b.buf[i + 3];
  }
  return {
    meanDelta: +(sum / n).toFixed(2),
    maxDelta: max,
    pctPixelsOver6: +((over / n) * 100).toFixed(1),
    aMeanAlpha: +(aAlpha / (a.buf.length / 4)).toFixed(1),
    bMeanAlpha: +(bAlpha / (a.buf.length / 4)).toFixed(1),
  };
}

/** Capture, composite over every requested background, plus a 4x upscale. */
async function shot(win, name, kinds) {
  const img = await win.capturePage();
  const out = { size: img.getSize() };
  for (const kind of kinds) {
    const flat = flattenBuffer(img, BG[kind]);
    fs.writeFileSync(path.join(SHOT_DIR, `${name}-${kind}.png`), imgFrom(flat).toPNG());
    out[kind] = flat;
    const up = imgFrom(flat).resize({ width: flat.size.width * 4, quality: 'best' });
    fs.writeFileSync(path.join(SHOT_DIR, `${name}-${kind}-4x.png`), up.toPNG());
  }
  fs.writeFileSync(path.join(SHOT_DIR, `${name}-raw.png`), img.toPNG());
  out.img = img;
  return out;
}

const MEASURE = `(() => {
  const isl = document.getElementById('island');
  const cs = getComputedStyle(isl);
  const r = isl.getBoundingClientRect();
  const flat = (s) => String(s == null ? '' : s).replace(/\\s+/g, ' ').trim();
  const pick = (id) => {
    const el = document.getElementById(id);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    const c = getComputedStyle(el);
    return {
      x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1),
      display: c.display, opacity: c.opacity, overflow: c.overflow,
      scrollW: el.scrollWidth, clientW: el.clientWidth,
      text: flat(el.innerText || el.textContent),
    };
  };
  return {
    state: isl.dataset.state, surface: isl.dataset.surface, mic: isl.dataset.mic,
    media: isl.dataset.media, viz: isl.dataset.viz, miniMode: isl.dataset.miniMode,
    glassA: cs.getPropertyValue('--glass-a').trim(),
    bgImage: cs.backgroundImage.slice(0, 320),
    bgColor: cs.backgroundColor,
    borderColor: cs.borderColor, borderWidth: cs.borderWidth,
    radius: cs.borderRadius,
    shadow: cs.boxShadow.slice(0, 220),
    opacity: cs.opacity,
    islandRect: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
    body: { w: document.body.clientWidth, h: document.body.clientHeight,
      scrollW: document.body.scrollWidth, scrollH: document.body.scrollHeight },
    win: [window.innerWidth, window.innerHeight],
    islandText: flat(isl.innerText),
    el: {
      pill: pick('pill'), mini: pick('mini'), banner: pick('banner'),
      open: pick('open'), micPill: pick('micPill'),
      mediaBox: pick('mediaBox'), mediaText: pick('mediaText'),
      mediaTrack: pick('mediaTrack'), mediaViz: pick('mediaViz'),
      mediaLyric: pick('mediaLyric'), clock: pick('clock'), battery: pick('battery'),
      miniClock: pick('miniClock'), miniDate: pick('miniDate'),
      miniCatSlot: pick('miniCatSlot'), pillCatSlot: pick('pillCatSlot'),
    },
    vizBars: Array.from(document.querySelectorAll('#mediaViz i')).map((el) => {
      const b = el.getBoundingClientRect();
      return { w: +b.width.toFixed(2), h: +b.height.toFixed(2) };
    }),
    overlays: (() => {
      const one = (id) => {
        const el = document.getElementById(id);
        if (!el) return null;
        const c = getComputedStyle(el);
        const b = el.getBoundingClientRect();
        return { display: c.display, visibility: c.visibility, opacity: c.opacity,
          bgColor: c.backgroundColor, bgImage: c.backgroundImage.slice(0, 160),
          x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) };
      };
      return { banner: one('banner'), micPill: one('micPill'), pill: one('pill'), open: one('open') };
    })(),
  };
})()`;

const MUSIC = `(() => {
  const flat = (s) => String(s == null ? '' : s).replace(/\\s+/g, ' ').trim();
  const panel = document.querySelector('.panel.active');
  const card = document.getElementById('musicCard');
  const fill = document.getElementById('musicFill');
  const lyricLines = document.getElementById('lyricLines');
  const lyricState = document.getElementById('lyricState');
  const box = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) };
  };
  return {
    activePanel: panel ? panel.dataset.panel : null,
    panelOverflow: panel ? panel.scrollHeight - panel.clientHeight : null,
    card: box(card),
    fillWidth: fill ? fill.style.width : null,
    timesText: flat((document.querySelector('#musicCard .music-times') || {}).innerText),
    title: flat((document.getElementById('musicTitle') || {}).textContent),
    sub: flat((document.getElementById('musicSub') || {}).textContent),
    lyricLines: flat(lyricLines ? lyricLines.innerText : ''),
    lyricLineCount: lyricLines ? lyricLines.children.length : 0,
    lyricState: flat(lyricState ? lyricState.textContent : ''),
    cardViz: card ? card.querySelectorAll('.media-viz, #musicViz').length : null,
    pillViz: document.querySelectorAll('#pill #mediaViz').length,
    size: [window.innerWidth, window.innerHeight],
  };
})()`;

/** Mean sRGB of a flattened capture, so "lighter/darker" is a number. */
function meanRGB(flat) {
  let r = 0; let g = 0; let b = 0;
  const px = flat.buf.length / 4;
  for (let i = 0; i < flat.buf.length; i += 4) { b += flat.buf[i]; g += flat.buf[i + 1]; r += flat.buf[i + 2]; }
  const hex = (v) => Math.round(v / px).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

const DIAG = `(() => {
  const h = (el) => (el ? +el.getBoundingClientRect().height.toFixed(1) : null);
  const isl = document.getElementById('island');
  const cs = getComputedStyle(isl);
  const tallest = [];
  for (const el of document.querySelectorAll('body *')) {
    const b = el.getBoundingClientRect();
    if (b.height > 30 && b.width > 0) {
      tallest.push({ id: el.id || el.className || el.tagName, h: +b.height.toFixed(1), y: +b.y.toFixed(1) });
    }
  }
  return {
    win: [window.innerWidth, window.innerHeight],
    docClient: [document.documentElement.clientWidth, document.documentElement.clientHeight],
    bodyClient: [document.body.clientWidth, document.body.clientHeight],
    bodyScroll: [document.body.scrollWidth, document.body.scrollHeight],
    islandComputedHeight: cs.height, islandRectH: h(isl),
    islandPosition: cs.position, islandTop: cs.top, islandBottom: cs.bottom,
    bodyHeightRule: getComputedStyle(document.body).height,
    htmlHeightRule: getComputedStyle(document.documentElement).height,
    layers: ['mini', 'pill', 'banner', 'open', 'micPill'].map((id) => {
      const el = document.getElementById(id);
      return { id, display: el ? getComputedStyle(el).display : null, h: h(el), y: el ? +el.getBoundingClientRect().y.toFixed(1) : null };
    }),
    tallest: tallest.slice(0, 6),
  };
})()`;

async function load(win, html) {
  await win.loadFile(html);
  win.showInactive();
  await sleep(320);
}

const emitSettings = (win, extra) => js(win, `window.probe.emit('settings', ${JSON.stringify(extra)}); true`);
const emitStatus = (win, extra) => js(win, `window.probe.emit('status', ${JSON.stringify(extra)}); true`);

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  let previousState = null;
  try { previousState = fs.readFileSync(STATE_PATH, 'utf8'); } catch { previousState = null; }
  fs.writeFileSync(STATE_PATH, JSON.stringify({
    status: {
      state: 'pill', surface: GLASS.surface, glassLevel: GLASS.glassLevel,
      accent: '#e9eef7', cardWidth: 360, visibleTabs: [...ALL_TABS],
      miniMode: 'clock', media: false, mediaTitle: '', word: false,
      hiddenUntilHover: false, openAction: 'last', meeting: false, scaleEffective: 100,
    },
    settings: {
      surface: GLASS.surface, glassLevel: GLASS.glassLevel, accent: '#e9eef7',
      cardWidth: 360, visibleTabs: [...ALL_TABS], islandStyle: 'dynamic',
      islandContent: 'clock-robot', barOrder: ['clock', 'cat', 'battery', 'media', 'mic'],
      miniMode: 'clock', miniTrigger: 'fullscreen', islandPosition: 'center',
      monitor: 'main', edgeMargin: 4, islandScale: 100, catGreeting: true,
      catIdleCenter: true, meetingAuto: false, meetingMicButton: true, pillLyrics: false,
    },
    card: { lastTab: 'music', notices: [], clips: [], sites: [], shelf: [], tasks: [] },
  }, null, 2), 'utf8');

  const pillB = boundsFor('pill', BASE_SETTINGS);
  const openB = boundsFor('open', BASE_SETTINGS);
  const miniB = boundsFor('mini', BASE_SETTINGS);
  metrics.bounds = { pill: pillB, open: openB, mini: miniB };

  const win = makeWindow(pillB.width, pillB.height);

  /* ================= Task 1: Liquid glass A/B ================= */
  const glassAB = {};
  for (const [tag, html] of [['before', BEFORE_HTML], ['after', AFTER_HTML]]) {
    win.setBounds(pillB);
    await load(win, html);
    await emitSettings(win, {
      ...GLASS, miniMode: 'clock', visibleTabs: [...ALL_TABS], pillLyrics: false,
      islandPosition: 'center', islandScale: 100, edgeMargin: 4,
    });
    await emitStatus(win, {
      state: 'pill', miniMode: 'clock', media: false, mediaTitle: '', meeting: false,
      surface: GLASS.surface, glassLevel: GLASS.glassLevel, hiddenUntilHover: false,
      scaleEffective: 100, visibleTabs: [...ALL_TABS],
    });
    await sleep(420);
    const m = await js(win, MEASURE);
    const s = await shot(win, `glass-${tag}`, ['light', 'dark', 'busy']);
    glassAB[tag] = { measure: m, size: s.size, light: s.light, dark: s.dark, busy: s.busy };
    metrics[`glass-${tag}-pill`] = m;
  }
  metrics.glassDiffPill = {
    light: diff(glassAB.before.light, glassAB.after.light),
    dark: diff(glassAB.before.dark, glassAB.after.dark),
    busy: diff(glassAB.before.busy, glassAB.after.busy),
  };

  /* Open card: use the height the renderer actually asks the main process for,
     so both sides are shot at the same real card size. */
  let cardHeight = 240;
  {
    win.setBounds({ x: openB.x, y: openB.y, width: openB.width, height: 240 });
    await emitStatus(win, { state: 'open', visibleTabs: ['music'] });
    await sleep(360);
    const h = await js(win, `(() => { const c = window.probe.calls().filter((x) => x.kind === 'setCardHeight');
      return c.length ? c[c.length - 1].payload : null; })()`);
    if (typeof h === 'number' && h > 40) cardHeight = Math.round(h);
  }
  const openRect = { x: openB.x, y: openB.y, width: openB.width, height: cardHeight };
  metrics.openRect = openRect;

  const glassOpen = {};
  for (const [tag, html] of [['before', BEFORE_HTML], ['after', AFTER_HTML]]) {
    win.setBounds(pillB);
    await load(win, html);
    win.setBounds(openRect);
    await emitSettings(win, { ...GLASS, visibleTabs: ['music'], miniMode: 'clock', islandScale: 100 });
    await emitStatus(win, {
      state: 'open', visibleTabs: ['music'], media: false, mediaTitle: '', miniMode: 'clock',
      surface: GLASS.surface, glassLevel: GLASS.glassLevel, meeting: false, scaleEffective: 100,
    });
    await sleep(320);
    await js(win, `document.querySelector('.tab[data-tab="music"]').click(); true`);
    await sleep(420);
    const m = await js(win, MEASURE);
    const s = await shot(win, `glass-${tag}-open`, ['light', 'dark', 'busy']);
    glassOpen[tag] = { measure: m, size: s.size, light: s.light, dark: s.dark, busy: s.busy };
    metrics[`glass-${tag}-open`] = m;
  }
  metrics.glassDiffOpen = {
    light: diff(glassOpen.before.light, glassOpen.after.light),
    dark: diff(glassOpen.before.dark, glassOpen.after.dark),
    busy: diff(glassOpen.before.busy, glassOpen.after.busy),
  };

  /* ---- control: the BEFORE build with its two always-on overlay bugs
     neutralised. If the glass then matches AFTER, the whole "glass changed"
     impression came from those overlays, not from the glass rules. ---- */
  const HIDE_OVERLAYS = `(() => {
    for (const id of ['banner', 'micPill']) {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    }
    return true;
  })()`;

  win.setBounds(pillB);
  await load(win, BEFORE_HTML);
  const beforePillOverlays = (await js(win, MEASURE)).overlays;
  await emitSettings(win, { ...GLASS, miniMode: 'clock', visibleTabs: [...ALL_TABS], islandScale: 100 });
  await emitStatus(win, {
    state: 'pill', miniMode: 'clock', media: false, mediaTitle: '', meeting: false,
    surface: GLASS.surface, glassLevel: GLASS.glassLevel, hiddenUntilHover: false,
    scaleEffective: 100, visibleTabs: [...ALL_TABS],
  });
  await sleep(300);
  await js(win, HIDE_OVERLAYS);
  await sleep(320);
  const ctrlPill = await shot(win, 'glass-before-pill-nofix', ['light']);
  metrics.glassBeforePillOverlays = beforePillOverlays;

  win.setBounds(openRect);
  await emitSettings(win, { ...GLASS, visibleTabs: ['music'], miniMode: 'clock' });
  await emitStatus(win, { state: 'open', visibleTabs: ['music'], media: false, mediaTitle: '', miniMode: 'clock' });
  await sleep(300);
  await js(win, `document.querySelector('.tab[data-tab="music"]').click(); true`);
  await sleep(300);
  await js(win, HIDE_OVERLAYS);
  await sleep(360);
  const ctrlOpen = await shot(win, 'glass-before-open-nofix', ['light']);

  metrics.glassDiffControl = {
    pill: diff(ctrlPill.light, glassAB.after.light),
    open: diff(ctrlOpen.light, glassOpen.after.light),
  };

  /* ================= Task 2: music start (repo build) ================= */
  win.setBounds(pillB);
  const actualPill = win.getBounds();
  await load(win, AFTER_HTML);
  await emitSettings(win, { ...GLASS, visibleTabs: ['music'], miniMode: 'clock', pillLyrics: false });
  await emitStatus(win, {
    state: 'pill', miniMode: 'clock', media: true, mediaTitle: 'Kavi Rao - Neon Harbor',
    visibleTabs: ['music'], surface: GLASS.surface, glassLevel: GLASS.glassLevel,
    meeting: false, scaleEffective: 100,
  });
  await sleep(600);
  const musicPill = await js(win, MEASURE);
  const pillDiag = await js(win, DIAG);
  const mpShot = await shot(win, 'musicstart-pill', ['light', 'busy']);
  metrics.musicPill = { ...musicPill, shotSize: mpShot.size, windowBounds: pillB, diag: pillDiag };

  win.setBounds(openRect);
  await emitStatus(win, { state: 'open', visibleTabs: ['music'], media: true, mediaTitle: 'Kavi Rao - Neon Harbor' });
  await sleep(320);
  await js(win, `document.querySelector('.tab[data-tab="music"]').click(); true`);
  await sleep(420);
  const musicOpen = await js(win, MEASURE);
  const moShot = await shot(win, 'musicstart-open', ['light', 'busy']);
  metrics.musicOpen = { ...musicOpen, shotSize: moShot.size, windowBounds: openRect };

  await js(win, `window.probe.emit('lyrics', { title: 'Kavi Rao - Neon Harbor', lrc: '[00:01.00] satu\\n[00:04.00] dua' }); true`);
  await sleep(320);
  const lyricEarly = await js(win, MUSIC);
  await sleep(1000);
  const lyricLate = await js(win, MUSIC);
  const mlShot = await shot(win, 'musicstart-lyrics', ['light', 'busy']);
  metrics.musicLyrics = { early: lyricEarly, late: lyricLate, shotSize: mlShot.size };

  /* ================= Task 3: notch (repo build) ================= */
  win.setBounds(miniB);
  const actualMini = win.getBounds();
  await emitSettings(win, { ...GLASS, miniMode: 'clock', visibleTabs: [...ALL_TABS] });
  await emitStatus(win, { state: 'mini', miniMode: 'clock', media: false, mediaTitle: '', visibleTabs: [...ALL_TABS] });
  await sleep(500);
  const notchClock = await js(win, MEASURE);
  const notchDiag = await js(win, DIAG);
  const ncShot = await shot(win, 'notch-busy', ['light']);
  metrics.notchClock = { ...notchClock, shotSize: ncShot.size, windowBounds: miniB, diag: notchDiag };

  await emitSettings(win, { miniMode: 'cat' });
  await emitStatus(win, { state: 'mini', miniMode: 'cat' });
  await sleep(500);
  const notchCat = await js(win, MEASURE);
  const ncatShot = await shot(win, 'notch-busy-cat', ['light']);
  metrics.notchCat = { ...notchCat, shotSize: ncatShot.size, windowBounds: miniB };

  /* ---- report ---- */
  const gb = glassAB.before.measure;
  const ga = glassAB.after.measure;
  const ob = glassOpen.before.measure;
  const oa = glassOpen.after.measure;

  say('== TASK 1: Liquid glass A/B ==');
  say(`pill window ${pillB.width}x${pillB.height}; open window ${openRect.width}x${openRect.height}`);
  say(`BEFORE surface=${gb.surface} glassA=${gb.glassA} rect=${JSON.stringify(gb.islandRect)} body=${gb.body.w}x${gb.body.h}`);
  say(`AFTER  surface=${ga.surface} glassA=${ga.glassA} rect=${JSON.stringify(ga.islandRect)} body=${ga.body.w}x${ga.body.h}`);
  say(`BEFORE border=${gb.borderWidth} ${gb.borderColor} radius=${gb.radius} opacity=${gb.opacity}`);
  say(`AFTER  border=${ga.borderWidth} ${ga.borderColor} radius=${ga.radius} opacity=${ga.opacity}`);
  say(`BEFORE bg=${gb.bgImage.slice(0, 200)}`);
  say(`AFTER  bg=${ga.bgImage.slice(0, 200)}`);
  say(`BEFORE shadow=${gb.shadow}`);
  say(`AFTER  shadow=${ga.shadow}`);
  say(`diff pill  light=${JSON.stringify(metrics.glassDiffPill.light)}`);
  say(`diff pill  dark =${JSON.stringify(metrics.glassDiffPill.dark)}`);
  say(`diff pill  busy =${JSON.stringify(metrics.glassDiffPill.busy)}`);
  say(`open BEFORE rect=${JSON.stringify(ob.islandRect)} body=${ob.body.w}x${ob.body.h} radius=${ob.radius}`);
  say(`open AFTER  rect=${JSON.stringify(oa.islandRect)} body=${oa.body.w}x${oa.body.h} radius=${oa.radius}`);
  say(`open BEFORE bg=${ob.bgImage.slice(0, 200)}`);
  say(`open AFTER  bg=${oa.bgImage.slice(0, 200)}`);
  say(`diff open  light=${JSON.stringify(metrics.glassDiffOpen.light)}`);
  say(`diff open  busy =${JSON.stringify(metrics.glassDiffOpen.busy)}`);
  say(`BEFORE overlays pill=${JSON.stringify(beforePillOverlays.banner)} micPill=${JSON.stringify(beforePillOverlays.micPill)}`);
  say(`AFTER  overlays banner=${JSON.stringify(ga.overlays.banner)} micPill=${JSON.stringify(ga.overlays.micPill)}`);
  say(`CONTROL (BEFORE, banner+micPill display:none) vs AFTER: pill=${JSON.stringify(metrics.glassDiffControl.pill)} open=${JSON.stringify(metrics.glassDiffControl.open)}`);
  say(`meanRGB pill  BEFORE=${meanRGB(glassAB.before.light)} AFTER=${meanRGB(glassAB.after.light)}`);
  say(`meanRGB open  BEFORE=${meanRGB(glassOpen.before.light)} AFTER=${meanRGB(glassOpen.after.light)}`);
  say(`DIAG pill ${JSON.stringify(pillDiag)}`);

  say('== TASK 2: music start (repo build) ==');
  say(`pill: requested=${JSON.stringify(pillB)} actualWindow=${JSON.stringify(actualPill)} shot=${mpShot.size.width}x${mpShot.size.height}`);
  const mpe = musicPill.el;
  say(`pill: window=${pillB.width}x${pillB.height} islandRect=${JSON.stringify(musicPill.islandRect)} body=${musicPill.body.w}x${musicPill.body.h}`);
  say(`pill: data-media=${musicPill.media} viz=${musicPill.viz} islandText="${musicPill.islandText}"`);
  for (const k of ['mediaBox', 'mediaText', 'mediaTrack', 'mediaViz', 'clock', 'battery', 'pillCatSlot']) {
    say(`pill: ${k}=${JSON.stringify(mpe[k])}`);
  }
  say(`pill: vizBars=${JSON.stringify(musicPill.vizBars)}`);
  say(`open: panel=${musicOpen.el.open && musicOpen.el.open.display} size=${musicOpen.win} islandRect=${JSON.stringify(musicOpen.islandRect)}`);
  say(`lyrics early=${JSON.stringify(lyricEarly)}`);
  say(`lyrics late =${JSON.stringify(lyricLate)}`);

  say('== TASK 3: notch (repo build) ==');
  say(`mini requested=${JSON.stringify(miniB)} actualWindow=${JSON.stringify(actualMini)} shot=${ncShot.size.width}x${ncShot.size.height}`);
  say(`mini body=${notchClock.body.w}x${notchClock.body.h} islandRect=${JSON.stringify(notchClock.islandRect)} win=${JSON.stringify(notchClock.win)}`);
  say(`notch clock: islandText="${notchClock.islandText}" clock=${JSON.stringify(notchClock.el.miniClock)} cat=${JSON.stringify(notchClock.el.miniCatSlot)} banner.display=${notchClock.el.banner && notchClock.el.banner.display} micPill.display=${notchClock.el.micPill && notchClock.el.micPill.display}`);
  say(`notch cat: islandText="${notchCat.islandText}" clock.display=${notchCat.el.miniClock && notchCat.el.miniClock.display} cat.display=${notchCat.el.miniCatSlot && notchCat.el.miniCatSlot.display} banner.display=${notchCat.el.banner && notchCat.el.banner.display}`);
  say(`DIAG notch ${JSON.stringify(notchDiag)}`);

  fs.writeFileSync(path.join(SHOT_DIR, 'glass-metrics.json'), JSON.stringify(metrics, null, 2), 'utf8');
  fs.writeFileSync(path.join(SHOT_DIR, 'glass-report.txt'), lines.join('\n'), 'utf8');

  win.destroy();
  if (previousState === null) fs.rmSync(STATE_PATH, { force: true });
  else fs.writeFileSync(STATE_PATH, previousState, 'utf8');
}

app.on('window-all-closed', (event) => event.preventDefault());

app.whenReady().then(async () => {
  try {
    await main();
    console.log('\nPROBE_GLASS OK');
  } catch (err) {
    console.log('PROBE_GLASS ERROR ' + String((err && err.stack) || err));
    app.exit(1);
    return;
  }
  app.exit(0);
});
