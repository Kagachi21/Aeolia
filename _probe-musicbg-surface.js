/* QA Yan - throwaway: does the dynamic cover background ACTUALLY paint on the
   user's surface (Liquid glass), and is the #island:not([...Translucent])
   prefix load-bearing? Checking only that CSS variables were set would be a
   false pass: an id-level glass rule can outrank the dynamic rule.
 *
 * All CSS/markup comes from a pinned git snapshot in a temp dir. src/, dist/
 * and the installed app are never touched.
 */
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execSync } = require('node:child_process');

const root = __dirname;
const SHOT_DIR = path.join(root, '.superpowers', 'shots');
const STATE_PATH = path.join(root, '_qa-state.json');
const { boundsFor } = require(path.join(root, 'dist', 'main', 'bounds.js'));

const TITLE = 'Kavi Rao - Neon Harbor';
const PAL = { c1: '#7b4dff', c2: '#c792ea', c3: '#2b3a67' };
const PREFIX = '#island:not([data-surface="Translucent"]) .music-card';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (win, code) => win.webContents.executeJavaScript(code);

const READ = `(() => {
  const c = document.getElementById('musicCard');
  const a = document.getElementById('musicArt');
  const cs = getComputedStyle(c);
  return {
    dynamic: c.dataset.dynamic,
    bg: cs.backgroundImage,
    art: getComputedStyle(a).backgroundImage,
    vars: ['--mc-1', '--mc-2', '--mc-3'].map((v) => c.style.getPropertyValue(v).trim()),
    surface: document.getElementById('island').dataset.surface,
    bgKind: document.getElementById('island').dataset.musicBg,
    media: document.getElementById('island').dataset.media,
  };
})()`;

async function runCase(win, label, surface, cssText) {
  const snapDir = path.join(os.tmpdir(), `aeolia-mcbg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  fs.cpSync(path.join(root, 'dist', 'renderer'), snapDir, { recursive: true });
  fs.writeFileSync(path.join(snapDir, 'styles.css'), cssText);
  fs.writeFileSync(path.join(snapDir, 'index.html'),
    execSync(`git show HEAD:src/renderer/index.html`, { cwd: root }));

  await win.loadFile(path.join(snapDir, 'index.html'));
  await sleep(320);
  await js(win, `window.probe.emit('settings', ${JSON.stringify({
    surface, glassLevel: 20, accent: '#6ea8ff', cardWidth: 360,
    visibleTabs: ['music'], miniMode: 'clock', islandScale: 100,
    musicCardBackground: 'album', musicProgress: 'Wave',
  })}); true`);
  await js(win, `window.probe.emit('status', ${JSON.stringify({
    state: 'open', openAction: 'music', visibleTabs: ['music'], media: true,
    mediaTitle: TITLE, miniMode: 'clock', surface, glassLevel: 20,
    accent: '#6ea8ff', musicCardBackground: 'album', meeting: false, scaleEffective: 100,
  })}); true`);
  await sleep(400);
  await js(win, `document.querySelector('.tab[data-tab="music"]').click(); true`);
  await sleep(300);
  const before = await js(win, READ);
  await js(win, `window.probe.emit('musicColors', ${JSON.stringify({ title: TITLE, colors: PAL })}); true`);
  await sleep(300);
  const after = await js(win, READ);
  console.log(`\n== ${label} (${surface}) ==`);
  console.log(`  sebelum: dynamic=${before.dynamic} bg=${before.bg.slice(0, 90)}`);
  console.log(`  sesudah: dynamic=${after.dynamic} bg=${after.bg.slice(0, 90)}`);
  console.log(`  vars=${JSON.stringify(after.vars)}  art=${after.art.slice(0, 80)}`);
  try { fs.rmSync(snapDir, { recursive: true, force: true }); } catch { /* windows file locks */ }
  return { before, after };
}

app.whenReady().then(async () => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const base = execSync('git show HEAD:src/renderer/styles.css', { cwd: root }).toString('utf8');
  const gitHead = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim();
  console.log(`== PROVENANCE ==\ngit ${gitHead} src/renderer/styles.css (${base.length} bytes)`);
  console.log(`prefix ditemukan: ${base.includes(PREFIX)}`);

  let previousState = null;
  try { previousState = fs.readFileSync(STATE_PATH, 'utf8'); } catch { previousState = null; }
  fs.writeFileSync(STATE_PATH, JSON.stringify({
    status: { state: 'open', accent: '#6ea8ff', surface: 'Liquid glass', glassLevel: 20,
      cardWidth: 360, visibleTabs: ['music'], miniMode: 'clock', media: true,
      mediaTitle: TITLE, meeting: false, scaleEffective: 100, openAction: 'music' },
    settings: { accent: '#6ea8ff', surface: 'Liquid glass', glassLevel: 20, cardWidth: 360,
      visibleTabs: ['music'], islandStyle: 'dynamic', islandContent: 'clock-robot',
      barOrder: ['clock', 'cat', 'battery', 'media', 'mic'], miniMode: 'clock',
      miniTrigger: 'fullscreen', islandPosition: 'center', monitor: 'main',
      edgeMargin: 4, islandScale: 100, musicCardBackground: 'album', musicProgress: 'Wave' },
    card: { lastTab: 'music', notices: [], clips: [], sites: [], shelf: [], tasks: [] },
  }, null, 2), 'utf8');

  const openB = boundsFor('open', { islandScale: 100, monitor: 'main', islandPosition: 'center',
    edgeMargin: 4, islandStyle: 'dynamic', cardWidth: 360,
    pill: { width: 150, height: 36 }, mini: { width: 64, height: 14 }, open: { width: 360, height: 92 } });
  const win = new BrowserWindow({
    width: openB.width, height: 400, frame: false, show: false, transparent: true,
    hasShadow: false, thickFrame: false, resizable: false, movable: false,
    useContentSize: true, backgroundColor: '#00000000', paintWhenInitiallyHidden: true,
    webPreferences: { preload: path.join(root, '_qa-preload.js'), contextIsolation: true,
      nodeIntegration: false, sandbox: false, backgroundThrottling: false },
  });
  win.setMinimumSize(1, 1);
  win.setMaximumSize(4000, 4000);
  win.setBounds({ x: openB.x, y: 0, width: openB.width, height: 400 });
  win.showInactive();

  const glass = await runCase(win, 'A. aturan asli', 'Liquid glass', base);
  const translucent = await runCase(win, 'B. aturan asli', 'Translucent', base);
  /* Drop ONLY the id prefix from the two dynamic rules, keeping everything
     else byte-identical. If the prefix is decorative, case C still paints. */
  const stripped = base.split(PREFIX).join('.music-card');
  console.log(`\nprefix dihapus di salinan: ${base.split(PREFIX).length - 1} aturan berubah`);
  const mutated = await runCase(win, 'C. prefix dicabut', 'Liquid glass', stripped);

  const checks = [];
  const check = (name, ok, detail) => {
    checks.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  :: ${detail}`);
  };
  console.log('');
  check('A: Liquid glass benar-benar melukis glow sampul (bukan cuma variabel)',
    glass.after.dynamic === 'true' && glass.after.bg.includes('radial-gradient')
      && glass.after.bg !== glass.before.bg && glass.after.vars.join('|') === `${PAL.c1}|${PAL.c2}|${PAL.c3}`,
    JSON.stringify({ dynamic: glass.after.dynamic, radial: glass.after.bg.includes('radial-gradient'),
      changed: glass.after.bg !== glass.before.bg, vars: glass.after.vars }));
  /* getComputedStyle resolves hex to rgb(), so comparing against the literal
     '#7b4dff' would be a test bug, not a product failure. */
  const c1rgb = 'rgb(' + [1, 3, 5].map((i) => parseInt(PAL.c1.slice(i, i + 2), 16)).join(', ') + ')';
  check('A: art mengikuti palet', glass.after.art.includes(c1rgb) && glass.after.art !== glass.before.art,
    JSON.stringify({ want: c1rgb, art: glass.after.art.slice(0, 80), changed: glass.after.art !== glass.before.art }));
  check('B: Translucent tidak ikut berubah (pane terang dipertahankan)',
    translucent.after.bg === translucent.before.bg && !translucent.after.bg.includes('radial-gradient'),
    JSON.stringify({ changed: translucent.after.bg !== translucent.before.bg, bg: translucent.after.bg.slice(0, 70) }));
  check('C: tanpa prefix id, Liquid glass GAGAL melukis glow (prefix memang krusial)',
    !mutated.after.bg.includes('radial-gradient') || mutated.after.bg === mutated.before.bg,
    JSON.stringify({ radial: mutated.after.bg.includes('radial-gradient'),
      changed: mutated.after.bg !== mutated.before.bg, bg: mutated.after.bg.slice(0, 70) }));
  const failed = checks.filter((c) => !c.ok);
  console.log(`\nPROBE_MUSICBG_SURFACE ${checks.length - failed.length}/${checks.length} PASS`);

  win.destroy();
  if (previousState === null) fs.rmSync(STATE_PATH, { force: true });
  else fs.writeFileSync(STATE_PATH, previousState, 'utf8');
  app.exit(failed.length ? 1 : 0);
});
