/* Kou - proof for the Wave progress style.
   Drives the REAL compiled renderer with the user's music card, lets the lyric
   timeline set --mp-pct, and then measures the painted result instead of
   trusting the CSS: the rightmost accent pixel has to stop at the masked
   boundary, and the accent pixels have to rise and fall like a sine line (a
   striped bar would sit on one y for the whole strip).

   Run: env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe _probe-wave.js
*/
const { app, BrowserWindow, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const root = __dirname;
const SHOT_DIR = path.join(root, '.superpowers', 'shots');
const { boundsFor } = require(path.join(root, 'dist', 'main', 'bounds.js'));

const CARD = { width: 420, height: 92 };
const PILL = { width: 150, height: 36 };
const ACCENT = { r: 0x6e, g: 0xa8, b: 0xff };   // the accent on the user machine
const TRACK = 'Kavi Rao - Neon Harbor';
/* 10 s of lyrics: sleeping 1 / 5 / 9 s puts --mp-pct at ~10 / 50 / 90. */
const LRC = '[00:00.00] satu\n[00:10.00] dua';
const TARGETS = [
  { pct: 10, at: 1000, file: 'wave-10' },
  { pct: 50, at: 5000, file: 'wave-50' },
  { pct: 90, at: 9000, file: 'wave-90' },
];

const results = [];
const report = { captures: {} };
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  :: ' + detail}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function settingsFor() {
  return {
    islandScale: 100, monitor: 'main', islandPosition: 'center', edgeMargin: 4,
    islandStyle: 'dynamic', cardWidth: CARD.width,
    pill: { ...PILL }, mini: { width: 64, height: 14 }, open: { ...CARD },
  };
}

const STATE = `(() => {
  const p = document.getElementById('musicProgress');
  const trackSvg = p.querySelector('.mp-wave');
  const slideSvg = p.querySelector('.mp-wave-slide');
  const wrap = p.querySelector('.mp-wave-fillwrap');
  const fill = p.querySelector('.mp-wave-fill');
  const track = p.querySelector('.mp-wave-track');
  const cs = fill ? getComputedStyle(fill) : null;
  const ws = wrap ? getComputedStyle(wrap) : null;
  const box = p.getBoundingClientRect();
  const sbox = trackSvg ? trackSvg.getBoundingClientRect() : null;
  const mask = ws ? (ws.maskImage && ws.maskImage !== 'none' ? ws.maskImage : ws.webkitMaskImage) : null;
  return {
    style: p.dataset.style,
    empty: p.dataset.empty,
    pct: Number(getComputedStyle(p).getPropertyValue('--mp-pct')) || 0,
    fillDisplay: getComputedStyle(document.getElementById('musicFill')).display,
    rect: { x: box.x, y: box.y, w: box.width, h: box.height },
    svg: sbox ? { w: sbox.width, h: sbox.height } : null,
    strokeWidth: cs && cs.strokeWidth,
    stroke: cs && cs.stroke,
    trackStroke: track ? getComputedStyle(track).stroke : null,
    mask,
    maskElement: wrap ? wrap.className : null,
    animation: slideSvg ? getComputedStyle(slideSvg).animationName : null,
  };
})()`;

/** Accent pixel profile inside the strip rect of a capture. */
function accentProfile(img, rect, scale) {
  const size = img.getSize();
  const bmp = img.toBitmap();
  const x0 = Math.max(0, Math.round(rect.x * scale));
  const y0 = Math.max(0, Math.round(rect.y * scale));
  const x1 = Math.min(size.width - 1, Math.round((rect.x + rect.w) * scale));
  const y1 = Math.min(size.height - 1, Math.round((rect.y + rect.h) * scale));
  const near = (r, g, b) => Math.abs(r - ACCENT.r) < 70 && Math.abs(g - ACCENT.g) < 70
    && Math.abs(b - ACCENT.b) < 70;
  const columns = [];
  let rightmost = -1;
  let any = 0;
  for (let x = x0; x <= x1; x += 1) {
    let minY = -1;
    let maxY = -1;
    for (let y = y0; y <= y1; y += 1) {
      const i = (y * size.width + x) * 4;
      if (bmp[i + 3] >= 150 && near(bmp[i + 2], bmp[i + 1], bmp[i])) {
        any += 1;
        if (minY < 0) minY = y;
        maxY = y;
      }
    }
    if (minY >= 0) {
      rightmost = x;
      columns.push({ x, mid: (minY + maxY) / 2, top: minY, bottom: maxY });
    }
  }
  const mids = columns.map((c) => c.mid);
  return {
    rightmost, accentPixels: any,
    firstX: columns.length ? columns[0].x : -1,
    midMin: mids.length ? Math.min(...mids) : null,
    midMax: mids.length ? Math.max(...mids) : null,
    midRange: mids.length ? +(Math.max(...mids) - Math.min(...mids)).toFixed(1) : null,
    columns: columns.length,
    rectPx: { x0, x1, y0, y1 },
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
  const status = (extra) => js(`window.probe.emit('status', ${JSON.stringify(extra)}); true`);

  await js(`window.probe.emit('settings', ${JSON.stringify({
    surface: 'Liquid glass', glassLevel: 20, accent: '#6ea8ff', cardWidth: CARD.width,
    visibleTabs: ['music'], miniMode: 'clock', islandStyle: 'dynamic',
    islandContent: 'clock-robot', islandPosition: 'center', monitor: 'main',
    edgeMargin: 4, islandScale: 100, musicCardProgress: 'Wave', lyricsText: LRC,
  })}); true`);
  await sleep(160);
  win.setBounds(boundsFor('open', settingsFor(), CARD.height));
  await status({
    state: 'open', meeting: false, media: true, mediaTitle: TRACK, word: false,
    miniMode: 'clock', scaleEffective: 100, accent: '#6ea8ff', surface: 'Liquid glass',
    glassLevel: 20, islandStyle: 'dynamic', islandPosition: 'center',
    visibleTabs: ['music'], hiddenUntilHover: false, openAction: 'last',
    musicCardProgress: 'Wave',
  });
  await sleep(200);
  await js(`document.querySelector('.tab[data-tab="music"]').click(); true`);
  await sleep(200);
  const wanted = await js(`(() => {
    const c = window.probe.calls().filter((x) => x.kind === 'setCardHeight');
    return c.length ? c[c.length - 1].payload : null;
  })()`);
  if (typeof wanted === 'number' && wanted > 40) {
    win.setBounds(boundsFor('open', settingsFor(), Math.round(wanted)));
    await sleep(320);
  }

  /* Start the lyric timeline, then capture as soon as the timeline passes each
     mark, so the pct printed next to every PNG is the pct that was painted. */
  const startedAt = Date.now();
  await js(`window.probe.emit('lyrics', { title: ${JSON.stringify(TRACK)}, lrc: ${JSON.stringify(LRC)} }); true`);

  for (const target of TARGETS) {
    const deadline = Date.now() + 12000;
    for (;;) {
      const pct = await js(`Number(getComputedStyle(document.getElementById('musicProgress')).getPropertyValue('--mp-pct')) || 0`);
      if (pct >= target.pct || Date.now() > deadline) break;
      await sleep(60);
    }
    await sleep(80);
    const state = await js(STATE);
    const shot = await win.capturePage();
    const scale = shot.getSize().width / (await js('window.innerWidth'));
    const profile = accentProfile(shot, state.rect, scale);
    fs.writeFileSync(path.join(SHOT_DIR, `${target.file}.png`), shot.toPNG());
    fs.writeFileSync(path.join(SHOT_DIR, `${target.file}-4x.png`),
      shot.resize({ width: shot.getSize().width * 4, quality: 'best' }).toPNG());
    const expected = (state.pct / 100) * state.rect.w * scale;
    report.captures[target.file] = {
      state, profile, expectedPx: +expected.toFixed(1), scale,
      elapsedMs: Date.now() - startedAt,
    };
    console.log(`  ${target.file} pct=${state.pct.toFixed(1)} strip=${state.rect.w.toFixed(1)}x${state.rect.h}`
      + ` accentRight=${profile.rightmost} expected=${expected.toFixed(1)}`
      + ` waveRange=${profile.midRange}`);
  }

  const first = report.captures['wave-10'];
  check('Wave memakai SVG, bukan bar belang (.mp-fill disembunyikan)',
    first.state.style === 'Wave' && first.state.fillDisplay === 'none' && first.state.svg !== null,
    `style=${first.state.style} fillDisplay=${first.state.fillDisplay} svg=${JSON.stringify(first.state.svg)}`);
  check('stroke 2 px tidak melar walau viewBox diregangkan',
    first.state.strokeWidth === '2px' && first.state.stroke === 'rgb(110, 168, 255)',
    `strokeWidth=${first.state.strokeWidth} stroke=${first.state.stroke} track=${first.state.trackStroke}`);
  check('animasi mp-slide berjalan di SVG isi, mask di wrapper terpisah',
    first.state.animation === 'mp-slide' && /mp-wave-fillwrap/.test(String(first.state.maskElement)),
    `animation=${first.state.animation} maskElement=${first.state.maskElement}`);
  check('mask mengikuti --mp-pct',
    /linear-gradient/.test(String(first.state.mask)) && /\d+(\.\d+)?%/.test(String(first.state.mask)),
    `${first.state.mask}`);

  for (const target of TARGETS) {
    const cap = report.captures[target.file];
    const expected = cap.expectedPx;
    const got = cap.profile.rightmost - cap.profile.rectPx.x0 + 1;
    check(`${target.file}: ujung isi berhenti di ${cap.state.pct.toFixed(1)}% lebar strip`,
      Math.abs(got - expected) <= 8 && Math.abs(cap.state.pct - target.pct) <= 6,
      `pct=${cap.state.pct.toFixed(1)} rightmostPx=${got} expected=${expected} (toleransi 8)`);
  }
  const ranges = TARGETS.map((t) => report.captures[t.file].profile.midRange);
  check('bentuknya gelombang: garis naik turun 4-8 px, bukan garis datar',
    ranges.every((r) => r !== null && r >= 4 && r <= 8),
    `midRange=${JSON.stringify(ranges)} (bar belang akan ~0-1)`);

  /* data-empty must still dim the strip */
  await js(`window.probe.emit('lyrics', { title: ${JSON.stringify(TRACK)}, lrc: '' }); true`);
  await sleep(400);
  const emptyState = await js(STATE);
  const emptyOpacity = await js(`getComputedStyle(document.getElementById('musicProgress')).opacity`);
  report.empty = { state: emptyState, opacity: emptyOpacity };
  check('tanpa lirik: strip tetap meredup (data-empty + opacity 0.45)',
    emptyState.empty === 'true' && emptyOpacity === '0.45',
    `empty=${emptyState.empty} opacity=${emptyOpacity}`);

  /* The other five styles must keep the plain bar: the wave markup is in the
     DOM for all of them, so it has to be display none outside Wave. */
  report.others = {};
  const others = ['Simple', 'Pixels', 'Comet', 'Song shape', 'Hearts'];
  for (const style of others) {
    await js(`window.probe.emit('settings', ${JSON.stringify({
      surface: 'Liquid glass', glassLevel: 20, accent: '#6ea8ff', cardWidth: CARD.width,
      visibleTabs: ['music'], miniMode: 'clock', islandStyle: 'dynamic',
      islandContent: 'clock-robot', islandPosition: 'center', monitor: 'main',
      edgeMargin: 4, islandScale: 100, musicCardProgress: style, lyricsText: LRC,
    })}); true`);
    await sleep(120);
    /* The renderer repaints the strip on the next status tick, so wait for the
       attribute to actually flip before measuring it. */
    const deadline = Date.now() + 3000;
    for (;;) {
      const now = await js(`document.getElementById('musicProgress').dataset.style`);
      if (now === style || Date.now() > deadline) break;
      await sleep(80);
    }
    await sleep(80);
    const info = await js(`(() => {
      const p = document.getElementById('musicProgress');
      const wave = p.querySelector('.mp-wave');
      const wrap = p.querySelector('.mp-wave-fillwrap');
      const fill = document.getElementById('musicFill');
      const b = p.getBoundingClientRect();
      return {
        style: p.dataset.style,
        fillDisplay: getComputedStyle(fill).display,
        waveDisplay: getComputedStyle(wave).display,
        wrapDisplay: getComputedStyle(wrap).display,
        height: +b.height.toFixed(1),
      };
    })()`);
    report.others[style] = info;
    const shot = await win.capturePage();
    fs.writeFileSync(path.join(SHOT_DIR, `wave-other-${style.replace(/\s+/g, '-')}.png`), shot.toPNG());
    check(`${style}: tetap bar biasa, gelombang tidak ikut tampil`,
      info.style === style && info.fillDisplay !== 'none' && info.waveDisplay === 'none'
        && info.wrapDisplay === 'none' && info.height < 14,
      JSON.stringify(info));
  }

  check('tidak ada error konsol', consoleErrors.length === 0, JSON.stringify(consoleErrors));

  fs.writeFileSync(path.join(SHOT_DIR, 'wave-metrics.json'), JSON.stringify(report, null, 2), 'utf8');
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
  console.log(`\nPROBE_WAVE ${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) console.log('FAILED: ' + failed.map((f) => f.name).join(' | '));
  app.exit(failed.length ? 1 : 0);
});
