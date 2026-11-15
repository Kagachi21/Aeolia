/* QA Yan - throwaway: contrast of the SECONDARY text family in the panels the
   main contrast probe never opens. Same ruler as _probe-contrast-after.js
   (median ring around the glyph, WCAG), same MIN_RING gate, same colour parser.
 *
 * Selectors come from the one-line override block
 *   #island[data-surface="Liquid glass"] ... { color: #dde2ec }
 * so a regression in any of them is caught, not just the three in the music card.
 *
 * The stylesheet and markup are pinned to a git ref and rendered from a temp
 * copy: src/ and dist/ are never touched.
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

const MIN_RING = 150;
const NOTICE_COUNT = Number(process.env.AEOLIA_NOTICES || 1);
const NOTICES = Array.from({ length: NOTICE_COUNT }, (_, i) => ({
  id: `n${i + 1}`, app: 'Telegram', title: `Obet ${i + 1}`, body: 'halo', at: Date.now() - 120000 - i * 1000,
}));
const BG = { r: 238, g: 241, b: 245 };      // light wallpaper tone
const USER = { surface: 'Liquid glass', glassLevel: 20, accent: '#6ea8ff' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (win, code) => win.webContents.executeJavaScript(code);

/* ---------- WCAG (identical to the main probe) ---------- */
const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const luminance = ({ r, g, b }) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratioFromLum = (a, b) => {
  const hi = Math.max(a, b); const lo = Math.min(a, b);
  return +((hi + 0.05) / (lo + 0.05)).toFixed(2);
};
const rgbCss = (c) => `rgb(${c.r},${c.g},${c.b})`;

function flattenOver(img) {
  const size = img.getSize();
  const src = img.toBitmap();
  const out = Buffer.alloc(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const a = src[i + 3] / 255;
    out[i] = Math.min(255, Math.round(src[i] + BG.b * (1 - a)));
    out[i + 1] = Math.min(255, Math.round(src[i + 1] + BG.g * (1 - a)));
    out[i + 2] = Math.min(255, Math.round(src[i + 2] + BG.r * (1 - a)));
    out[i + 3] = 255;
  }
  return { buf: out, size };
}

/** Ring of pixels around the glyph box: median + 10th/90th percentile. */
function surfaceRing(flat, rect, pad) {
  const { width, height } = flat.size;
  const x0 = Math.max(0, Math.floor(rect.x - pad));
  const y0 = Math.max(0, Math.floor(rect.y - pad));
  const x1 = Math.min(width - 1, Math.ceil(rect.x + rect.w + pad));
  const y1 = Math.min(height - 1, Math.ceil(rect.y + rect.h + pad));
  const ix0 = Math.floor(rect.x); const iy0 = Math.floor(rect.y);
  const ix1 = Math.ceil(rect.x + rect.w); const iy1 = Math.ceil(rect.y + rect.h);
  const lums = []; const rs = []; const gs = []; const bs = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (x >= ix0 && x <= ix1 && y >= iy0 && y <= iy1) continue;
      const i = (y * width + x) * 4;
      const px = { r: flat.buf[i + 2], g: flat.buf[i + 1], b: flat.buf[i] };
      lums.push(luminance(px)); rs.push(px.r); gs.push(px.g); bs.push(px.b);
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
}

/* Page-side: colour parser that also understands color(srgb ...), because
   color-mix() resolves to that and a silent [0,0,0] fallback invents ratios. */
const TEXT_BOXES = `((ids) => {
  const parseColor = (css) => {
    const s = String(css || '').trim();
    const rgb = /rgba?\\(([^)]+)\\)/.exec(s);
    if (rgb) {
      const p = rgb[1].split(/[,\\s\\/]+/).filter(Boolean).map(parseFloat);
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1, format: 'rgb' };
    }
    const col = /color\\(\\s*([a-z0-9-]+)\\s+([^)]+)\\)/i.exec(s);
    if (col) {
      const num = (v) => (v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v));
      const v = col[2].split(/[\\s\\/]+/).filter(Boolean);
      const r = num(v[0]), g = num(v[1]), b = num(v[2]);
      if ([r, g, b].every((n) => Number.isFinite(n))) {
        return { r: r * 255, g: g * 255, b: b * 255, a: v.length > 3 ? num(v[3]) : 1, format: 'color(' + col[1].toLowerCase() + ')' };
      }
    }
    return { r: null, g: null, b: null, a: 1, format: 'unparsed' };
  };
  const effOpacity = (el) => {
    let o = 1;
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const v = parseFloat(getComputedStyle(n).opacity);
      if (!Number.isNaN(v)) o *= v;
    }
    return +o.toFixed(3);
  };
  const flat = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
  return ids.map(([label, sel, scope]) => {
    const host = scope ? document.querySelector(scope) : document;
    const el = host ? host.querySelector(sel) : null;
    if (!el) return { label, missing: true };
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const c = parseColor(cs.color);
    return {
      label, text: flat(el.innerText || el.textContent).slice(0, 40),
      rect: { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) },
      colorCss: cs.color, colorFormat: c.format, colorParsed: c.r !== null,
      color: { r: c.r, g: c.g, b: c.b }, alpha: c.a,
      fontSize: cs.fontSize, fontWeight: cs.fontWeight,
      opacityChain: effOpacity(el),
      visible: b.width > 0 && b.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden',
    };
  });
})`;

/* Which panel to open for which selector, and what makes the panel non-empty. */
const PANELS = [
  { tab: 'notifications', scope: '.panel[data-panel="notifications"]', targets: [
    ['row-head notif', '.row-head'], ['hint notif', '.hint'], ['row time notif', '.row .time']] },
  { tab: 'clipboard', scope: '.panel[data-panel="clipboard"]', targets: [
    ['row-head clipboard', '.row-head'], ['hint clipboard', '.hint'], ['row time clipboard', '.row .time']] },
  { tab: 'today', scope: '.panel[data-panel="today"]', targets: [
    ['cal-agenda', '.cal-agenda span'], ['row-head today', '.row-head']] },
  { tab: 'controls', scope: '.panel[data-panel="controls"]', targets: [
    ['stat i (CPU/RAM)', '.stat i'], ['hint controls', '.hint']] },
  { tab: 'timer', scope: '.panel[data-panel="timer"]', targets: [['empty timer', '.empty']] },
  { tab: 'music', scope: '.panel[data-panel="music"]', targets: [
    ['time right (sisa)', '#musicTimeEnd'], ['time left', '#musicTimeCur']] },
];

app.whenReady().then(async () => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const CSS_REF = process.env.AEOLIA_CSS_REF || 'HEAD';
  const snapDir = path.join(os.tmpdir(), `aeolia-panel-${Date.now()}`);
  fs.cpSync(path.join(root, 'dist', 'renderer'), snapDir, { recursive: true });
  fs.writeFileSync(path.join(snapDir, 'styles.css'), execSync(`git show ${CSS_REF}:src/renderer/styles.css`, { cwd: root }));
  fs.writeFileSync(path.join(snapDir, 'index.html'), execSync(`git show ${CSS_REF}:src/renderer/index.html`, { cwd: root }));
  const appendFile = process.env.AEOLIA_CSS_APPEND_FILE;
  if (appendFile) {
    fs.appendFileSync(path.join(snapDir, 'styles.css'), `\n${fs.readFileSync(appendFile, 'utf8')}\n`);
    console.log(`== OVERRIDE KANDIDAT ==\n${fs.readFileSync(appendFile, 'utf8').trim()}\n`);
  }
  const gitHead = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim();
  const hashOf = (p) => require('node:crypto').createHash('sha1').update(fs.readFileSync(p)).digest('hex').slice(0, 12);
  console.log(`== PROVENANCE ==\ncss pinned to git ${CSS_REF} (HEAD ${gitHead}); notices=${NOTICE_COUNT}; styles.css ${hashOf(path.join(snapDir, 'styles.css'))} index.html ${hashOf(path.join(snapDir, 'index.html'))} renderer.js ${hashOf(path.join(snapDir, 'renderer.js'))}`);

  const now = Date.now();
  let previousState = null;
  try { previousState = fs.readFileSync(STATE_PATH, 'utf8'); } catch { previousState = null; }
  fs.writeFileSync(STATE_PATH, JSON.stringify({
    status: { state: 'open', accent: USER.accent, surface: USER.surface, glassLevel: USER.glassLevel,
      cardWidth: 360, visibleTabs: ['notifications', 'clipboard', 'today', 'controls', 'timer', 'music'],
      miniMode: 'clock', media: true, mediaTitle: 'Kavi Rao - Neon Harbor',
      meeting: false, scaleEffective: 100, openAction: 'last' },
    settings: { accent: USER.accent, surface: USER.surface, glassLevel: USER.glassLevel, cardWidth: 360,
      visibleTabs: ['notifications', 'clipboard', 'today', 'controls', 'timer', 'music'],
      islandStyle: 'dynamic', islandContent: 'clock-robot', barOrder: ['clock', 'cat', 'battery', 'media', 'mic'],
      miniMode: 'clock', miniTrigger: 'fullscreen', islandPosition: 'center', monitor: 'main',
      edgeMargin: 4, islandScale: 100, musicProgress: 'Wave' },
    card: {
      lastTab: 'notifications',
      sites: [], shelf: [],
      clips: [{ id: 'c1', kind: 'text', text: 'npm run build', at: now - 90000 }],
      notices: NOTICES,
      tasks: [{ id: 't1', name: 'Cek build', done: false }],
      waterMl: 0, waterGoalMl: 2000, waterStartHour: 8, waterEndHour: 22,
      waterEveryMin: 60, waterEnabled: false, waterSound: true, waterDay: '', eyeBreakMin: 20,
      eyeBreakSound: true, prayerCity: 'Jakarta',
    },
  }, null, 2), 'utf8');

  const openB = boundsFor('open', { islandScale: 100, monitor: 'main', islandPosition: 'center',
    edgeMargin: 4, islandStyle: 'dynamic', cardWidth: 360,
    pill: { width: 150, height: 36 }, mini: { width: 64, height: 14 }, open: { width: 360, height: 92 } });

  const win = new BrowserWindow({
    width: openB.width, height: 460, frame: false, show: false, transparent: true,
    hasShadow: false, thickFrame: false, resizable: false, movable: false,
    useContentSize: true, backgroundColor: '#00000000', paintWhenInitiallyHidden: true,
    webPreferences: { preload: path.join(root, '_qa-preload.js'), contextIsolation: true,
      nodeIntegration: false, sandbox: false, backgroundThrottling: false },
  });
  win.setMinimumSize(1, 1);
  win.setMaximumSize(4000, 4000);
  win.setBounds({ x: openB.x, y: 0, width: openB.width, height: 460 });
  win.showInactive();
  await win.loadFile(path.join(snapDir, 'index.html'));
  await sleep(340);
  await js(win, `window.probe.emit('settings', ${JSON.stringify({
    surface: USER.surface, glassLevel: USER.glassLevel, accent: USER.accent, cardWidth: 360,
    visibleTabs: ['notifications', 'clipboard', 'today', 'controls', 'timer', 'music'],
    miniMode: 'clock', islandScale: 100, musicProgress: 'Wave',
  })}); true`);
  await js(win, `window.probe.emit('status', ${JSON.stringify({
    state: 'open', visibleTabs: ['notifications', 'clipboard', 'today', 'controls', 'timer', 'music'],
    media: true, mediaTitle: 'Kavi Rao - Neon Harbor', miniMode: 'clock',
    surface: USER.surface, glassLevel: USER.glassLevel, accent: USER.accent,
    meeting: false, scaleEffective: 100,
  })}); true`);
  await js(win, `window.probe.emit('card', ${JSON.stringify({
    notices: NOTICES,
    clips: [{ id: 'c1', kind: 'text', text: 'npm run build', at: now - 90000 }],
    tasks: [{ id: 't1', name: 'Cek build', done: false }],
  })}); true`);
  await js(win, `window.probe.emit('lyrics', { title: 'Kavi Rao - Neon Harbor', lrc: '[00:01.00] satu\\n[00:04.00] dua' }); true`);
  await sleep(600);

  const rows = [];
  const problems = [];
  for (const panel of PANELS) {
    const clicked = await js(win, `(() => { const t = document.querySelector('.tab[data-tab="${panel.tab}"]');
      if (!t) return false; t.click(); return true; })()`);
    await sleep(420);
    /* Let the card grow to the height the renderer asks for, so the panel is
       not measured through a cropped window edge. */
    const h = await js(win, `(() => { const c = window.probe.calls().filter((x) => x.kind === 'setCardHeight');
      return c.length ? c[c.length - 1].payload : null; })()`);
    if (typeof h === 'number' && h > 40) {
      win.setBounds({ x: openB.x, y: 0, width: openB.width, height: Math.round(h) });
      await sleep(340);
    }
    await win.capturePage();
    await sleep(200);
    const boxes = await js(win, `(${TEXT_BOXES})(${JSON.stringify(panel.targets.map(([label, sel]) => [label, sel, panel.scope]))})`);
    const img = await win.capturePage();
    const flat = flattenOver(img);
    const flatImg = nativeImage.createFromBitmap(flat.buf, flat.size);
    fs.writeFileSync(path.join(SHOT_DIR, `panel-${panel.tab}-light.png`), flatImg.toPNG());

    for (const b of boxes) {
      if (b.missing || !b.visible) {
        rows.push({ panel: panel.tab, label: b.label, missing: true });
        continue;
      }
      if (!b.colorParsed) {
        problems.push(`${panel.tab}/${b.label}: UNPARSED ${b.colorFormat} "${b.colorCss}"`);
        rows.push({ panel: panel.tab, label: b.label, unparsed: true });
        continue;
      }
      const surface = surfaceRing(flat, b.rect, 4);
      if (!surface || surface.ringSamples < MIN_RING) {
        problems.push(`${panel.tab}/${b.label}: ring ${surface ? surface.ringSamples : 0} px < ${MIN_RING}`);
        rows.push({ panel: panel.tab, label: b.label, weak: true, ringSamples: surface ? surface.ringSamples : 0 });
        continue;
      }
      const a = b.alpha * b.opacityChain;
      const med = surface.medianRgb.match(/\d+/g).map(Number);
      const blended = {
        r: Math.round(med[0] * (1 - a) + b.color.r * a),
        g: Math.round(med[1] * (1 - a) + b.color.g * a),
        b: Math.round(med[2] * (1 - a) + b.color.b * a),
      };
      const lt = luminance(blended);
      /* l10 is the DARKER ring sample (brighter surface behind light text ->
         lower ratio), l90 the brighter one. Name them by what they are, and
         keep worst/best explicit so the columns cannot be read backwards. */
      const atDarkRing = ratioFromLum(lt, surface.l10);
      const atBrightRing = ratioFromLum(lt, surface.l90);
      const median = ratioFromLum(lt, surface.l50);
      const worst = Math.min(atDarkRing, atBrightRing);
      /* For light ink on a dark pane, the worst ring sample cannot beat the
         median. If it does, the columns are inverted again - fail the run. */
      if (worst > median + 0.01) problems.push(`${panel.tab}/${b.label}: worst ${worst} > median ${median} (inversi)`);
      rows.push({
        panel: panel.tab, label: b.label, text: b.text, colorCss: b.colorCss, colorFormat: b.colorFormat,
        ringSamples: surface.ringSamples, surface: surface.medianRgb,
        median, atDarkRing, atBrightRing, worst, best: Math.max(atDarkRing, atBrightRing),
      });
    }
    if (!clicked) problems.push(`tab ${panel.tab} tidak bisa diklik`);
  }

  console.log('\n== KONTRAS TEKS SEKUNDER PER PANEL (profil user, open|light) ==');
  console.log('panel            elemen                 median  terburuk  terbaik  sampel  warna');
  for (const r of rows) {
    if (r.missing) { console.log(`${r.panel.padEnd(16)} ${r.label.padEnd(22)} (tidak ter-render)`); continue; }
    if (r.unparsed) { console.log(`${r.panel.padEnd(16)} ${r.label.padEnd(22)} UNPARSED`); continue; }
    if (r.weak) { console.log(`${r.panel.padEnd(16)} ${r.label.padEnd(22)} RING KECIL ${r.ringSamples}px`); continue; }
    console.log(`${r.panel.padEnd(16)} ${r.label.padEnd(22)} ${String(r.median).padStart(5)}  ${String(r.worst).padStart(7)}  ${String(r.best).padStart(6)}  ${String(r.ringSamples).padStart(6)}  ${r.colorCss}`);
  }
  const below = rows.filter((r) => r.median != null && (r.median < 4.5 || r.worst < 4.6));
  /* A panel that failed to open yields no box, and a missing element used to
     just print "(tidak ter-render)" while the run stayed green. Every declared
     target must be measured, or this is not a pass. */
  const measuredKeys = new Set(rows.filter((r) => r.median != null).map((r) => `${r.panel}/${r.label}`));
  for (const panel of PANELS) {
    for (const [label] of panel.targets) {
      if (!measuredKeys.has(`${panel.tab}/${label}`)) problems.push(`tidak terukur: ${panel.tab}/${label}`);
    }
  }
  const expected = PANELS.reduce((n, p) => n + p.targets.length, 0);
  console.log(`\nTERUKUR ${measuredKeys.size}/${expected} elemen yang dideklarasikan`);
  console.log(`DI BAWAH AMBANG (median <4,5 atau terburuk <4,6): ${below.length ? below.map((r) => `${r.panel}/${r.label} ${r.median}/${r.worst}`).join(' | ') : 'none'}`);
  console.log(`MASALAH ALAT: ${problems.length ? problems.join(' | ') : 'none'}`);
  fs.writeFileSync(path.join(SHOT_DIR, `panel-contrast${process.env.AEOLIA_OUT_SUFFIX || ''}.json`), JSON.stringify({ gitHead, ref: CSS_REF, noticeCount: NOTICE_COUNT, rows, problems }, null, 2), 'utf8');

  win.destroy();
  try { fs.rmSync(snapDir, { recursive: true, force: true }); } catch { /* electron holds files */ }
  if (previousState === null) fs.rmSync(STATE_PATH, { force: true });
  else fs.writeFileSync(STATE_PATH, previousState, 'utf8');
  app.exit(problems.length ? 1 : 0);
});
