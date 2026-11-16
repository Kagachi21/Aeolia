/* Diagnostic: which rule wins the ink for each pill/card element on the light
   glass surface. Prints the computed colour plus the surface behind it.
   Run: env -u ELECTRON_RUN_AS_NODE electron.exe _diag-ink.js */
const { app, BrowserWindow } = require('electron');
const path = require('node:path');

const root = __dirname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TARGETS = [
  ['#clock', 'pill clock'],
  ['#mediaText', 'pill track title'],
  ['#mediaTitle', 'pill track title alt'],
  ['.media-track', 'pill track title alt2'],
  ['.music-meta strong', 'music title'],
  ['.music-meta span', 'music artist'],
  ['.music-times', 'music times'],
  ['.tab', 'tab label'],
  ['.hint', 'hint'],
];

async function main() {
  await app.whenReady();
  const win = new BrowserWindow({
    width: 420, height: 470, frame: false, show: false, transparent: true,
    hasShadow: false, useContentSize: true, backgroundColor: '#00000000',
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: path.join(root, '_qa-preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  });
  await win.loadFile(path.join(root, 'dist', 'renderer', 'index.html'));
  win.showInactive();
  await sleep(400);
  const js = (c) => win.webContents.executeJavaScript(c);

  await js(`window.probe.emit('status', ${JSON.stringify({
    state: 'pill', meeting: false, media: true, mediaTitle: 'Kavi Rao - Neon Harbor',
    accent: '#e9eef7', surface: 'Liquid glass', cardWidth: 360, cardHeight: 470,
    visibleTabs: null, hiddenUntilHover: false, openAction: 'last',
    miniMode: 'clock', islandScale: 100, scaleEffective: 100,
    islandPosition: 'center', islandStyle: 'dynamic', glassLevel: 20,
  })}); true`);
  await sleep(300);

  const out = await js(`(() => {
    const list = ${JSON.stringify(TARGETS)};
    return list.map(([sel, label]) => {
      const el = document.querySelector(sel);
      if (!el) return { sel, label, missing: true };
      const cs = getComputedStyle(el);
      return { sel, label, color: cs.color, opacity: cs.opacity, text: (el.textContent || '').slice(0, 28) };
    });
  })()`);

  const islandColor = await js(`getComputedStyle(document.getElementById('island')).color`);
  console.log('island color =', islandColor);
  for (const r of out) {
    console.log(r.missing ? `MISSING  ${r.label} (${r.sel})`
      : `${r.label.padEnd(22)} ${String(r.color).padEnd(26)} "${r.text}"`);
  }
  app.exit(0);
}

main().catch((e) => { console.error(e); app.exit(1); });
