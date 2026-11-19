/* Ink sweep (throwaway, NOT product).
 *
 * Renders the real dist page on the user's Liquid glass surface, walks EVERY
 * tab, and for each element that actually paints text it computes
 *   - the resolved text colour (via canvas, so oklch/color-mix are real values)
 *   - the composite backdrop by walking ancestors and accumulating
 *     background-color, then compositing over the measured pane colour
 *   - the WCAG ratio between them
 *
 * This is the "cek semuanya" pass: the per-selector probes only ever checked
 * the handful of elements someone remembered to list, which is exactly how the
 * mini-notch clock stayed at ~1.1:1 through four rounds.
 *
 * Run: env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe _probe-ink-sweep.js
 */
const { app, BrowserWindow, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

app.commandLine.appendSwitch('force-device-scale-factor', '1');

const root = __dirname;
const OUT = path.join(root, '.superpowers', 'shots', 'ink');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (win, code) => win.webContents.executeJavaScript(code);

const TABS = ['web', 'notifications', 'shelf', 'clipboard', 'music', 'today',
  'sholat', 'timer', 'reminders', 'water', 'capture', 'controls', 'deck', 'calls'];

/* Default to the working build, but allow the sweep to be pointed at the
   INSTALLED app so the deployed artifact can be verified directly instead of
   being assumed identical to dist. */
const PAGE = process.env.AEOLIA_HTML
  || path.join(root, 'dist', 'renderer', 'index.html');

const STATUS = {
  state: 'open', surface: 'Liquid glass', glassLevel: 20, accent: '#e9eef7',
  cardWidth: 420, visibleTabs: [...TABS], miniMode: 'clock', miniTrigger: 'busy',
  meetingMicButton: true, meetingCamButton: true, media: false, word: false,
  hiddenUntilHover: false, openAction: 'last', meeting: false, mediaTitle: '',
  scaleEffective: 100,
};
const SETTINGS = {
  surface: 'Liquid glass', glassLevel: 20, accent: '#e9eef7', cardWidth: 420,
  visibleTabs: [...TABS], islandStyle: 'dynamic', islandContent: 'clock-robot',
  miniMode: 'clock', miniTrigger: 'busy', islandPosition: 'center', monitor: 'main',
  edgeMargin: 4, islandScale: 100, pillLyrics: true,
};
const NOW = Date.now();
const CARD = {
  lastTab: 'controls',
  notices: [
    { id: 'n1', app: 'Discord', title: 'Kavi Rao', body: 'ping di #general', at: NOW - 60000 },
    { id: 'n2', app: 'Slack', title: '#design', body: 'Figma file is ready for review', at: NOW - 600000 },
  ],
  clips: [
    { id: 'c1', kind: 'text', text: 'https://example.com/a', at: NOW - 30000 },
    { id: 'c2', kind: 'text', text: 'catatan rapat 14.00', at: NOW - 900000 },
  ],
  sites: [{ id: 's1', name: 'Aeolia docs', url: 'https://example.com' }],
  shelf: [{ id: 'f1', name: 'invoice.pdf', path: 'C:\\tmp\\invoice.pdf', size: 220000, at: NOW - 120000 }],
  tasks: [{ id: 't1', name: 'Review glass contrast', done: false }, { id: 't2', name: 'Ship round 5', done: true }],
  waterMl: 1250, waterGoalMl: 2000, waterStartHour: 8, waterEndHour: 22,
  waterEveryMin: 45, waterEnabled: true,
};

/* Runs in the page. Returns every text-bearing leaf with its resolved colour
   and the composite backdrop behind it. `pane` is the island's real rendered
   colour, measured from the capture: the pane is painted with a gradient, so
   its computed background-color is transparent and cannot be used as a base. */
const sweepFor = (pane) => `(() => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const toRgba = (css) => {
    if (!css) return null;
    /* clearRect is not optional. Without it, a TRANSPARENT colour draws
       nothing and getImageData returns whatever was painted last, so every
       transparent ancestor background came back as the text colour and the
       whole sweep reported 1:1 for elements that are perfectly readable. */
    cx.clearRect(0, 0, 1, 1);
    cx.fillStyle = '#ff00fe';
    cx.fillStyle = css;
    cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    if (d[0] === 255 && d[1] === 0 && d[2] === 254 && !/ff00fe/i.test(css)) return null;
    return [d[0], d[1], d[2], d[3] / 255];
  };
  const over = (fg, bg) => [
    fg[0] * fg[3] + bg[0] * (1 - fg[3]),
    fg[1] * fg[3] + bg[1] * (1 - fg[3]),
    fg[2] * fg[3] + bg[2] * (1 - fg[3]),
    1,
  ];
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const ratio = (a, b) => {
    const l1 = lum(a); const l2 = lum(b);
    return +((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2);
  };

  const island = document.getElementById('island');
  const paneBg = [${pane.join(',')}, 1];

  /* Walk ancestors accumulating background-color, stopping AT the island: the
     pane colour already IS the island surface, and anything above it (body,
     html) is the wallpaper we injected to simulate a desktop. Walking past the
     island let the wallpaper paint over the pane and reported every light
     element as if it sat on a black desktop. */
  const backdropOf = (el) => {
    const stack = [];
    let n = el;
    while (n && n !== island && n !== document.body) {
      const bg = toRgba(getComputedStyle(n).backgroundColor);
      if (bg && bg[3] > 0.001) stack.push(bg);
      n = n.parentElement;
    }
    let out = [paneBg[0], paneBg[1], paneBg[2], 1];
    for (let i = stack.length - 1; i >= 0; i--) out = over(stack[i], out);
    return out;
  };

  const leafText = (el) => {
    let t = '';
    for (const n of el.childNodes) if (n.nodeType === 3) t += n.nodeValue;
    return t.replace(/\\s+/g, ' ').trim();
  };

  const out = [];
  const seen = new Set();
  for (const el of island.querySelectorAll('*')) {
    const text = leafText(el);
    if (!text) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const fg = toRgba(cs.color);
    if (!fg) continue;
    const bg = backdropOf(el);
    const blended = over(fg, bg);
    const sel = el.id ? '#' + el.id : '.' + [...el.classList].join('.');
    if (seen.has(sel + '|' + cs.color)) continue;
    seen.add(sel + '|' + cs.color);
    out.push({
      sel: sel.slice(0, 60), text: text.slice(0, 34), color: cs.color,
      fg: [Math.round(blended[0]), Math.round(blended[1]), Math.round(blended[2])],
      bg: [Math.round(bg[0]), Math.round(bg[1]), Math.round(bg[2])],
      ratio: ratio(blended, bg),
      size: cs.fontSize, weight: cs.fontWeight,
    });
  }
  return out;
})()`;

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({
    width: 460, height: 560, frame: false, show: true,
    webPreferences: {
      preload: path.join(root, '_probe-preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
      backgroundThrottling: false,
    },
  });
  await win.loadFile(PAGE);
  await sleep(900);
  await js(win, `window.probe.emit('settings', ${JSON.stringify(SETTINGS)});
    window.probe.emit('status', ${JSON.stringify(STATUS)});
    window.probe.emit('card', ${JSON.stringify(CARD)}); true`);
  await sleep(420);
  /* A live sampled desktop is part of the real Liquid glass backdrop. Without
     a frame this sweep measured only the base pane and missed the low-contrast
     hole a dark desktop could punch under the ink (QA A4 regression). */
  const liveFrame = (() => {
    const w = 256, h = 64, buf = Buffer.alloc(w * h * 4);
    for (let i = 0; i < buf.length; i += 4) {
      buf[i] = 172; buf[i + 1] = 172; buf[i + 2] = 172; buf[i + 3] = 255;
    }
    return nativeImage.createFromBitmap(buf, { width: w, height: h }).toDataURL();
  })();
  const injectFrame = () => js(win, `window.probe.emit('glassFrame', ${JSON.stringify({
    data: liveFrame, width: 256, height: 64, origin: 'injected',
  })}); true`);
  await injectFrame();
  await sleep(350);

  const rows = [];
  const WALLS = { light: [238, 241, 245], dark: [17, 19, 24] };

  /* The pane colour is measured, not assumed: the glass is a gradient, so its
     computed background-color is transparent and the ancestor walk has to
     start from a real pixel. Sample the island's own body area, away from any
     text, right after the wallpaper is applied. */
  const paneColour = async () => {
    const img = await win.capturePage();
    const { width, height } = img.getSize();
    const buf = img.toBitmap();
    const r = await js(win, `(() => { const b = document.getElementById('island').getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height }; })()`);
    /* 12% down the island, horizontally centred: below the specular bevel,
       clear of every glyph. */
    const px = Math.round(Math.min(Math.max(r.x + r.w / 2, 1), width - 2));
    const py = Math.round(Math.min(Math.max(r.y + r.h * 0.12, 1), height - 2));
    const i = (py * width + px) * 4;
    /* Electron bitmap is BGRA. */
    return [buf[i + 2], buf[i + 1], buf[i]];
  };

  for (const wall of Object.keys(WALLS)) {
    await win.webContents.insertCSS(`html, body { background: rgb(${WALLS[wall].join(',')}) !important; }`);
    await sleep(140);
    const pane = await paneColour();
    for (const tab of TABS) {
      await js(win, `document.querySelector('.tab[data-tab="${tab}"]')?.click(); true`);
      await sleep(150);
      const found = await js(win, sweepFor(pane));
      for (const r of found) rows.push({ wall, tab, pane, ...r });
    }
  }

  /* The pill and the mini notch carry their own readouts. */
  for (const st of ['pill', 'mini']) {
    win.setSize(st === 'pill' ? 150 : 64, 39);
    await sleep(240);
    await js(win, `window.probe.emit('status', ${JSON.stringify({ ...STATUS, state: st, media: true, mediaTitle: 'Kavi Rao - Neon Harbor' })}); true`);
    await injectFrame();
    await sleep(360);
    for (const wall of Object.keys(WALLS)) {
      await win.webContents.insertCSS(`html, body { background: rgb(${WALLS[wall].join(',')}) !important; }`);
      await sleep(140);
      const pane = await paneColour();
      const found = await js(win, sweepFor(pane));
      for (const r of found) rows.push({ wall, tab: st, pane, ...r });
    }
  }

  /* Large text (>=18.66px bold / >=24px) may use 3:1; everything else 4.5:1. */
  const bar = (r) => {
    const px = parseFloat(r.size);
    const bold = parseInt(r.weight, 10) >= 700;
    return (px >= 24 || (bold && px >= 18.66)) ? 3.0 : 4.5;
  };

  const fails = rows.filter((r) => r.ratio < bar(r));
  const uniq = new Map();
  for (const f of fails) {
    const k = f.tab + '|' + f.sel + '|' + f.color;
    if (!uniq.has(k)) uniq.set(k, f);
  }

  console.log('elements measured: ' + rows.length);
  console.log('FAILURES < AA (' + uniq.size + '):');
  for (const f of [...uniq.values()].sort((a, b) => a.ratio - b.ratio)) {
    console.log('  ' + String(f.ratio).padEnd(6) + f.tab.padEnd(14) + f.wall.padEnd(6)
      + f.sel.padEnd(34) + ' "' + f.text + '" ' + f.color + ' on rgb(' + f.bg.join(',') + ')');
  }

  const worst = [...uniq.values()].sort((a, b) => a.ratio - b.ratio)[0];
  console.log(worst ? 'WORST: ' + worst.ratio + ':1 ' + worst.sel : 'WORST: none');
  console.log('INK_SWEEP ' + (uniq.size === 0 ? 'PASS' : 'FAIL') + ' (' + uniq.size + ' below AA)');
  fs.writeFileSync(path.join(OUT, 'ink-sweep.json'), JSON.stringify(rows, null, 2));
  win.destroy();
  app.quit();
}

app.whenReady().then(main).catch((e) => { console.error(e); app.exit(1); });
