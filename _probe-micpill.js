/* Kou - visual proof for the separate meeting capsules (throwaway probe).
   Renders the REAL compiled renderer (dist/renderer/index.html) in a
   transparent BrowserWindow placed exactly where the REAL boundsFor() puts it,
   drives the real preload seam, then measures the DOM and scans the captured
   pixels so the proof is a number, not only a screenshot.

   Geometry is measured with a hit-test scan at mid height instead of
   getBoundingClientRect: the zoomed layers report zoom-relative rects, so the
   rects of the capsules cannot be compared with the (unzoomed) island body.

   Run: env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe _probe-micpill.js
*/
const { app, BrowserWindow, nativeImage, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const root = __dirname;
const SHOT_DIR = path.join(root, '.superpowers', 'shots');
const { boundsFor } = require(path.join(root, 'dist', 'main', 'bounds.js'));

/* Mirrors the defaults in src/main/settings.ts (pill 150x36) and the extra
   widths in src/main/bounds.ts: the pill window reserves MIC_PILL_EXTRA for
   the capsules, plus BANNER_EXTRA while a notice/meeting banner is up. */
const PILL = { width: 150, height: 36 };
const MIC_EXTRA = 172;
const BANNER_EXTRA = 250;

const results = [];
const metricsLog = {};
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  :: ' + detail}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (win, code) => win.webContents.executeJavaScript(code);

/** Settings slice boundsFor() reads, so the probe uses the product geometry
    instead of hand made numbers. */
const pillSettings = (pos, scalePct) => ({
  islandScale: scalePct, monitor: 'main', islandPosition: pos, edgeMargin: 4,
  islandStyle: 'dynamic', cardWidth: 360,
  pill: { width: PILL.width, height: PILL.height },
  mini: { width: 150, height: 32 },
  open: { width: 150, height: 40 },
});

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

/** Flatten the transparent capture onto white so a leaked dark or frosted
    rectangle is impossible to miss. */
function flattenOverWhite(img) {
  const size = img.getSize();
  const src = img.toBitmap();            // BGRA, premultiplied
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

function saveShots(img, name) {
  fs.writeFileSync(path.join(SHOT_DIR, `${name}.png`), img.toPNG());
  fs.writeFileSync(path.join(SHOT_DIR, `${name}-white.png`), flattenOverWhite(img).toPNG());
}

/** Stack captures on a common screen-x axis (one row per state) so the eye can
    check that the island body did not move while the strip grew. */
function saveAligned(rows, name) {
  const minX = Math.min(...rows.map((r) => r.x)) - 24;
  const maxX = Math.max(...rows.map((r) => r.x + r.img.getSize().width)) + 24;
  const width = maxX - minX;
  const rowH = Math.max(...rows.map((r) => r.img.getSize().height));
  const gap = 10;
  const height = rows.length * (rowH + gap) - gap;
  const canvas = Buffer.alloc(width * height * 4);
  rows.forEach((row, index) => {
    const size = row.img.getSize();
    const bmp = row.img.toBitmap();
    const dx = row.x - minX;
    const dy = index * (rowH + gap);
    for (let y = 0; y < size.height; y += 1) {
      bmp.copy(canvas, ((dy + y) * width + dx) * 4,
        y * size.width * 4, (y + 1) * size.width * 4);
    }
  });
  const img = nativeImage.createFromBitmap(canvas, { width, height });
  fs.writeFileSync(path.join(SHOT_DIR, `${name}.png`), img.toPNG());
  fs.writeFileSync(path.join(SHOT_DIR, `${name}-white.png`), flattenOverWhite(img).toPNG());
  return { width, height, originX: minX };
}

/* One horizontal hit-test scan at mid height. Classifies every page pixel of
   the window as island body, mic capsule, cam capsule, empty layer, or
   something unexpected. Zoom independent: elementFromPoint works in page px. */
const SCAN = `(() => {
  const island = document.getElementById('island');
  const layer = document.getElementById('micPill');
  const cs = getComputedStyle(island);
  const y = Math.round(window.innerHeight / 2);
  const classify = (x) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return 'empty';
    if (el === document.body || el === document.documentElement) return 'empty';
    if (el.closest('#micPill')) {
      if (el.closest('#meetingMic')) return 'mic';
      if (el.closest('#meetingCam')) return 'cam';
      return 'layer';
    }
    if (el.closest('#island')) return 'body';
    return 'other:' + (el.id || el.tagName);
  };
  const ranges = [];
  let prev = null;
  for (let x = 0; x < window.innerWidth; x += 1) {
    const kind = classify(x);
    if (!prev || prev.kind !== kind) { ranges.push({ kind, from: x, to: x }); prev = ranges[ranges.length - 1]; }
    else prev.to = x;
  }
  const span = (kind) => {
    const hits = ranges.filter((r) => r.kind === kind);
    return hits.length ? { from: hits[0].from, to: hits[hits.length - 1].to } : null;
  };
  return {
    innerWidth: window.innerWidth, innerHeight: window.innerHeight, y,
    ranges,
    body: span('body'), mic: span('mic'), cam: span('cam'), layer: span('layer'),
    stray: ranges.filter((r) => r.kind.startsWith('other:')).map((r) => r.kind),
    layerHidden: layer.hidden, layerDisplay: getComputedStyle(layer).display,
    micState: island.dataset.mic, pos: island.dataset.pos,
    extra: cs.getPropertyValue('--mic-extra').trim(),
    islandRight: cs.right, islandLeft: cs.left,
    bodyBackground: cs.backgroundColor,
    dotColor: getComputedStyle(document.querySelector('#micPill .mic-dot')).backgroundColor,
    micMuted: document.getElementById('meetingMic').classList.contains('muted'),
    pillOpacity: getComputedStyle(document.getElementById('pill')).opacity,
    bannerShown: island.dataset.banner === 'true',
  };
})()`;

/** The island body's own box, in page px. #island is never zoomed, so this
    rect is exact at every island scale. */
const BODY_RECT = `(() => {
  const r = document.getElementById('island').getBoundingClientRect();
  return { left: +r.left.toFixed(2), right: +r.right.toFixed(2), width: +r.width.toFixed(2) };
})()`;

/** Pixel report for the reserved strip: everything painted there must be one
    of the two capsules (plus their own soft shadow), never a container.
    The strip is whichever side of the island body the capsules took. */
function paintReport(img, m, label) {
  const size = img.getSize();
  const bmp = img.toBitmap();
  const k = size.width / m.innerWidth;                 // device px per page px
  const alphaAt = (x, y) => bmp[((Math.round(y * k) * size.width) + Math.round(x * k)) * 4 + 3];
  const body = m.body;
  const caps = [m.mic, m.cam].filter(Boolean);
  const capFrom = caps.length ? Math.min(...caps.map((c) => c.from)) : 0;
  const capTo = caps.length ? Math.max(...caps.map((c) => c.to)) : 0;
  const inCapsule = (x) => caps.some((c) => x >= c.from - 2 && x <= c.to + 2);
  const side = caps.length && capFrom > body.to ? 'right' : caps.length ? 'left' : 'none';
  const gapWidth = caps.length
    ? (side === 'right' ? capFrom - body.to - 1 : body.from - capTo - 1)
    : null;
  const strip = side === 'right'
    ? [body.to + 1, m.innerWidth - 1]
    : side === 'left' ? [0, body.from - 1] : [0, -1];

  let strong = 0;
  let maxOutside = 0;
  let firstStrong = null;
  let gapMax = 0;
  for (let y = 0; y < m.innerHeight; y += 1) {
    for (let x = strip[0]; x <= strip[1]; x += 1) {
      const a = alphaAt(x, y);
      if (!inCapsule(x)) {
        if (a > maxOutside) maxOutside = a;
        if (a >= 160) { strong += 1; if (!firstStrong) firstStrong = { x, y, a }; }
        if (side === 'right' ? x < capFrom : x > capTo) { if (a > gapMax) gapMax = a; }
      }
    }
  }
  const report = {
    label, imageWidth: size.width, pageWidth: m.innerWidth, scaleFactor: +k.toFixed(3),
    stripSide: side, body: [body.from, body.to], capsuleSpan: caps.length ? [capFrom, capTo] : null,
    gapWidth,
    bodyPixelAlpha: alphaAt(Math.round((body.from + body.to) / 2), Math.round(m.innerHeight / 2)),
    gapMaxAlpha: gapMax, outsideMaxAlpha: maxOutside,
    strongPixelsOutsideCapsules: strong, firstStrong,
  };
  metricsLog[label] = report;
  return report;
}

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const display = screen.getPrimaryDisplay();
  const displayRight = display.bounds.x + display.bounds.width;
  const win = makeWindow(PILL.width + MIC_EXTRA, PILL.height);
  await win.loadFile(path.join(root, 'dist', 'renderer', 'index.html'));
  /* document.elementFromPoint needs a rendered window, so the probe shows the
     frameless transparent window inactive. It never takes focus. */
  win.showInactive();
  await sleep(320);

  const status = (extra) => js(win, `window.probe.emit('status', ${JSON.stringify(extra)}); true`);
  const setPos = (pos) => js(win, `window.probe.emit('settings', { islandPosition: ${JSON.stringify(pos)} }); true`);
  const meeting = (on) => status({
    state: 'pill', meeting: on, meetingMicButton: true, media: false, mediaTitle: '',
    miniMode: 'clock', scaleEffective: 100, accent: '#e9eef7', surface: 'Black',
    word: false, hiddenUntilHover: false,
  });

  const s100 = pillSettings('center', 100);
  const offBounds = boundsFor('pill', s100);
  const onBounds = boundsFor('pill', s100, undefined, undefined, MIC_EXTRA);
  const bannerBounds = boundsFor('pill', s100, undefined, undefined, MIC_EXTRA, BANNER_EXTRA);
  metricsLog.bounds = { off: offBounds, on: onBounds, banner: bannerBounds };

  /* Meeting starts: pill + mic button on, no media. The rising edge also
     queues the "Meeting mode" banner (real behaviour), so the window takes the
     banner width first and returns to the plain pill width once it clears. */
  win.setBounds(bannerBounds);
  await meeting(true);
  await sleep(420);

  const joining = await js(win, SCAN);
  metricsLog.joining = joining;
  check('joining: layer tampil, dot oranye, satu kapsul saja',
    joining.layerDisplay === 'flex' && joining.micState === 'joining'
      && joining.dotColor === 'rgb(255, 159, 10)' && joining.cam === null,
    JSON.stringify({ display: joining.layerDisplay, mic: joining.micState, dot: joining.dotColor, cam: joining.cam }));
  saveShots(await win.capturePage(), 'micpill-joining');

  await sleep(1300);
  const settled = await js(win, SCAN);
  check('setelah 1,4 detik joining -> on (dua kapsul, data-mic on)',
    settled.micState === 'on' && settled.layerDisplay === 'flex'
      && settled.mic !== null && settled.cam !== null, settled.micState);

  /* The banner owns the body for 4,2 s; the capsules already sit outside it. */
  await sleep(3400);
  win.setBounds(onBounds);
  await sleep(320);
  const pill = await js(win, SCAN);
  const pillShot = await win.capturePage();
  saveShots(pillShot, 'micpill-pill');
  const strip = paintReport(pillShot, pill, 'pill');
  metricsLog.pillScan = pill;

  check('badan island selebar pil normal (window - MIC_PILL_EXTRA)',
    Math.abs((pill.body.to - pill.body.from + 1) - (pill.innerWidth - MIC_EXTRA)) <= 1.5
      && pill.body.from === 0,
    `body=${pill.body.from}..${pill.body.to} window=${pill.innerWidth} extra=${pill.extra}`);
  check('--mic-extra diisi renderer (skala 100 -> 172px)',
    pill.extra === `${MIC_EXTRA}px`, pill.extra);
  check('dua kapsul di strip, celah nyata 8..12 px dari badan island',
    strip.gapWidth >= 8 && strip.gapWidth <= 12 && pill.mic.from >= pill.body.to + 7,
    `gap=${strip.gapWidth} body=${pill.body.to} mic=${pill.mic.from}..${pill.mic.to} cam=${pill.cam.from}..${pill.cam.to}`);
  check('kapsul di dalam batas window (tidak terpotong)',
    pill.cam.to <= pill.innerWidth - 5 && pill.cam.to < pill.innerWidth,
    `camEnd=${pill.cam.to} window=${pill.innerWidth}`);
  check('tidak ada elemen lain di dalam window (hanya badan + 2 kapsul)',
    pill.stray.length === 0, JSON.stringify(pill.stray));
  check('tidak ada container yang dilukis di strip (piksel kuat di luar kapsul = 0)',
    strip.strongPixelsOutsideCapsules === 0,
    `strong=${strip.strongPixelsOutsideCapsules} first=${JSON.stringify(strip.firstStrong)} outsideMaxAlpha=${strip.outsideMaxAlpha}`);
  check('badan island berhenti tepat di bodyEnd (opak di dalam, bening di celah)',
    strip.bodyPixelAlpha >= 200 && strip.gapMaxAlpha < 96,
    `bodyAlpha=${strip.bodyPixelAlpha} gapMaxAlpha=${strip.gapMaxAlpha}`);
  check('tidak ada banner yang menutupi pill saat diambil',
    pill.bannerShown === false && pill.pillOpacity === '1',
    `banner=${pill.bannerShown} pillOpacity=${pill.pillOpacity}`);

  /* Right-hand island: the body stays flush with the screen edge, the
     capsules move to the strip on its left. */
  const sRight = pillSettings('right', 100);
  const rightOn = boundsFor('pill', sRight, undefined, undefined, MIC_EXTRA);
  await setPos('right');
  win.setBounds(rightOn);
  await sleep(400);
  const right = await js(win, SCAN);
  const rightShot = await win.capturePage();
  saveShots(rightShot, 'micpill-right');
  const rightStrip = paintReport(rightShot, right, 'right');
  metricsLog.rightScan = right;
  check('posisi right: badan island rata kanan, kapsul di strip kiri dengan celah 8..12 px',
    right.pos === 'right' && right.body.from === MIC_EXTRA && right.body.to === right.innerWidth - 1
      && rightStrip.gapWidth >= 8 && rightStrip.gapWidth <= 12 && right.cam.to < right.body.from,
    `pos=${right.pos} body=${right.body.from}..${right.body.to} mic=${right.mic.from}..${right.mic.to} cam=${right.cam.from}..${right.cam.to} gap=${rightStrip.gapWidth}`);
  check('posisi right: tidak ada container di strip kiri',
    rightStrip.strongPixelsOutsideCapsules === 0,
    `strong=${rightStrip.strongPixelsOutsideCapsules} outsideMaxAlpha=${rightStrip.outsideMaxAlpha}`);

  await setPos('center');
  await sleep(240);

  /* Island scale 130%: boundsFor widens the window and #island is not zoomed,
     so the inset has to be scaled too. */
  const zoom = 1.3;
  const s130 = pillSettings('center', 130);
  win.setBounds(boundsFor('pill', s130, undefined, undefined, MIC_EXTRA));
  await sleep(220);
  await status({ scaleEffective: 130 });
  await sleep(420);
  const big = await js(win, SCAN);
  const bigShot = await win.capturePage();
  saveShots(bigShot, 'micpill-pill-130');
  const bigStrip = paintReport(bigShot, big, 'scale130');
  metricsLog.scale130Scan = big;
  check('skala 130: --mic-extra ikut diskalakan (224px)',
    big.extra === `${Math.round(MIC_EXTRA * zoom)}px`, big.extra);
  check('skala 130: badan island tetap selebar pil (195 px), kapsul di luar dengan celah nyata',
    Math.abs((big.body.to - big.body.from + 1) - PILL.width * zoom) <= 2
      && Math.abs(bigStrip.gapWidth - Math.round(8 * zoom)) <= 2
      && bigStrip.strongPixelsOutsideCapsules === 0,
    `body=${big.body.from}..${big.body.to} gap=${bigStrip.gapWidth} strong=${bigStrip.strongPixelsOutsideCapsules}`);

  /* Idle: the window shrinks back and the layer must really be hidden. */
  win.setBounds(offBounds);
  await sleep(220);
  await status({ scaleEffective: 100 });
  await meeting(false);
  await sleep(420);
  const idle = await js(win, SCAN);
  const idleShot = await win.capturePage();
  saveShots(idleShot, 'micpill-idle');
  metricsLog.idleScan = idle;
  const idleSize = idleShot.getSize();
  const idleBmp = idleShot.toBitmap();
  const idleK = idleSize.width / idle.innerWidth;
  let idlePainted = 0;
  for (let y = 0; y < idle.innerHeight; y += 1) {
    for (let x = 0; x < idle.innerWidth; x += 1) {
      if (idleBmp[((Math.round(y * idleK) * idleSize.width) + Math.round(x * idleK)) * 4 + 3] > 8) idlePainted += 1;
    }
  }
  check('idle: micPill.hidden benar-benar display:none, tidak ada kapsul tersisa',
    idle.layerHidden === true && idle.layerDisplay === 'none'
      && idle.mic === null && idle.cam === null
      && Math.abs((idle.body.to - idle.body.from + 1) - idle.innerWidth) <= 1.5,
    `hidden=${idle.layerHidden} display=${idle.layerDisplay} mic=${JSON.stringify(idle.mic)} body=${idle.body.from}..${idle.body.to}/${idle.innerWidth} paintedPixels=${idlePainted}`);

  /* The capsule strip must NOT move the island body: the probe places the
     window exactly where boundsFor says (meeting off vs on) and compares the
     body's screen x. Rows are stacked on a shared screen-x axis for the eye. */
  const moves = {};
  for (const pos of ['center', 'left', 'right']) {
    const st = pillSettings(pos, 100);
    const bOff = boundsFor('pill', st);
    const bOn = boundsFor('pill', st, undefined, undefined, MIC_EXTRA);

    await setPos(pos);
    win.setBounds(bOff);
    await meeting(false);
    await sleep(380);
    const rectOff = await js(win, BODY_RECT);
    const shotOff = await win.capturePage();

    win.setBounds(bOn);
    await meeting(true);
    /* Let the "Meeting mode" banner clear so both rows show the same pill
       content and only the strip differs. */
    await sleep(4400);
    const rectOn = await js(win, BODY_RECT);
    const shotOn = await win.capturePage();

    const row = {
      pos,
      offWindow: [bOff.x, bOff.width],
      onWindow: [bOn.x, bOn.width],
      offBodyScreenX: bOff.x + rectOff.left,
      onBodyScreenX: bOn.x + rectOn.left,
      offBodyScreenRight: bOff.x + rectOff.right,
      onBodyScreenRight: bOn.x + rectOn.right,
      bodyWidthOff: rectOff.width,
      bodyWidthOn: rectOn.width,
      rightOverflow: bOn.x + bOn.width - displayRight,
      leftOverflow: display.bounds.x - bOn.x,
    };
    moves[pos] = row;
    const aligned = saveAligned([{ img: shotOff, x: bOff.x }, { img: shotOn, x: bOn.x }],
      `micpill-align-${pos}`);
    row.alignedShot = `micpill-align-${pos}-white.png`;
    row.alignedSize = [aligned.width, aligned.height];

    check(`badan island TIDAK bergeser saat rapat (posisi ${pos})`,
      Math.abs(row.offBodyScreenX - row.onBodyScreenX) <= 1
        && Math.abs(row.offBodyScreenRight - row.onBodyScreenRight) <= 1,
      `x off=${row.offBodyScreenX} on=${row.onBodyScreenX} | kanan off=${row.offBodyScreenRight} on=${row.onBodyScreenRight} | window off=${bOff.x}/${bOff.width} on=${bOn.x}/${bOn.width}`);
    check(`strip hanya tumbuh ke sisi bebas (posisi ${pos})`,
      pos === 'right'
        ? bOn.x < bOff.x && bOn.x + bOn.width === bOff.x + bOff.width
        : bOn.x === bOff.x && bOn.x + bOn.width > bOff.x + bOff.width,
      `window off=${bOff.x}..${bOff.x + bOff.width} on=${bOn.x}..${bOn.x + bOn.width}`);
    check(`tidak melewati tepi layar (posisi ${pos})`,
      row.rightOverflow <= 0 && row.leftOverflow <= 0,
      `rightOverflow=${row.rightOverflow} leftOverflow=${row.leftOverflow} display=${display.bounds.x}..${displayRight}`);
  }
  metricsLog.noMove = moves;

  fs.writeFileSync(path.join(SHOT_DIR, 'micpill-metrics.json'), JSON.stringify(metricsLog, null, 2), 'utf8');
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
  console.log(`\nPROBE_MICPILL ${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) console.log('FAILED: ' + failed.map((f) => f.name).join(' | '));
  app.exit(failed.length ? 1 : 0);
});
