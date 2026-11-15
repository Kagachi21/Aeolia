/* QA Yan - independent verification of 28a57cc (mic capsule gap), pinned to a
   git ref. The working tree is being edited for a music-bg revision, so this
   probe builds its OWN renderer snapshot:
     - styles.css + index.html from `git show <ref>`
     - renderer.js by transpiling `git show <ref>:src/renderer/renderer.ts`
   Nothing from dist's mutable copy is trusted. src/ and dist/ are not touched.
 *
 * Ruler: painted capsule columns = union over rows 6..32 of pixels with
 * alpha >= 128 and near-dark ink on the RAW capture. The gap is measured from
 * the island body edge to the nearest painted column, separately for the DOM
 * boxes of buttons that are actually visible (opacity > 0.5, display != none).
 * Comparing the two exposes an invisible button stealing a flex slot.
 */
const { app, BrowserWindow, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execSync } = require('node:child_process');
const ts = require('typescript');

const root = __dirname;
const SHOT_DIR = path.join(root, '.superpowers', 'shots');
const STATE_PATH = path.join(root, '_qa-state.json');
const { boundsFor } = require(path.join(root, 'dist', 'main', 'bounds.js'));

const PILL = { width: 150, height: 36 };
const MIC_EXTRA = 172;
const BANNER_EXTRA = 250;
const POSITIONS = ['center', 'left', 'right', 'right-side'];
const STATES = ['joining', 'on'];
const LIGHT = { r: 238, g: 241, b: 245 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (win, code) => win.webContents.executeJavaScript(code);

const MEASURE = `(() => {
  const island = document.getElementById('island');
  const layer = document.getElementById('micPill');
  const mic = document.getElementById('meetingMic');
  const cam = document.getElementById('meetingCam');
  const box = (el) => { const r = el.getBoundingClientRect();
    return { left: +r.left.toFixed(2), right: +r.right.toFixed(2), width: +r.width.toFixed(2) }; };
  const style = (el) => { const cs = getComputedStyle(el);
    return { display: cs.display, opacity: +cs.opacity, visibility: cs.visibility,
      animationName: cs.animationName, animationDuration: cs.animationDuration }; };
  const anims = layer.getAnimations().map((a) => ({ name: a.animationName || (a.effect && a.effect.getKeyframes && 'css'),
    playState: a.playState, currentTime: a.currentTime }));
  return {
    innerWidth: window.innerWidth,
    pos: island.dataset.pos, micState: island.dataset.mic,
    body: box(island), layer: box(layer), mic: box(mic), cam: box(cam),
    micStyle: style(mic), camStyle: style(cam), layerStyle: style(layer),
    layerHidden: layer.hidden, anims,
    extra: getComputedStyle(island).getPropertyValue('--mic-extra').trim(),
  };
})()`;

function flattenOver(img) {
  const size = img.getSize();
  const src = img.toBitmap();
  const out = Buffer.alloc(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const a = src[i + 3] / 255;
    out[i] = Math.min(255, Math.round(src[i] + LIGHT.b * (1 - a)));
    out[i + 1] = Math.min(255, Math.round(src[i + 1] + LIGHT.g * (1 - a)));
    out[i + 2] = Math.min(255, Math.round(src[i + 2] + LIGHT.r * (1 - a)));
    out[i + 3] = 255;
  }
  return nativeImage.createFromBitmap(out, { width: size.width, height: size.height });
}

/** Union of dark opaque columns across a band of rows inside the strip. */
function paintedSpan(img, x0, x1) {
  const size = img.getSize();
  const bmp = img.toBitmap();
  const k = size.width / 572; // logical px -> capture px
  const rows = [];
  for (const yLogical of [6, 10, 14, 19, 24, 28, 32]) rows.push(Math.round(yLogical * (size.height / 39)));
  let first = -1; let last = -1;
  for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(571, Math.ceil(x1)); x++) {
    const px = Math.round(x * k);
    let painted = false;
    for (const y of rows) {
      const i = (y * size.width + px) * 4;
      const a = bmp[i + 3];
      const dark = bmp[i + 2] < 110 && bmp[i + 1] < 110 && bmp[i] < 110;
      if (a >= 128 && dark) { painted = true; break; }
    }
    if (painted) { if (first < 0) first = x; last = x; }
  }
  return { first, last };
}

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  :: ${detail}`);
};

app.whenReady().then(async () => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const REF = process.env.AEOLIA_REF || 'HEAD';
  const snapDir = path.join(os.tmpdir(), `aeolia-micgap-${Date.now()}`);
  fs.cpSync(path.join(root, 'dist', 'renderer'), snapDir, { recursive: true });
  const gitShow = (p) => execSync(`git show ${REF}:${p}`, { cwd: root });
  const css = gitShow('src/renderer/styles.css');
  const html = gitShow('src/renderer/index.html');
  const rendererTs = gitShow('src/renderer/renderer.ts').toString('utf8');
  const rendererJs = ts.transpileModule(rendererTs, { compilerOptions: {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None,
  } }).outputText;
  fs.writeFileSync(path.join(snapDir, 'styles.css'), css);
  fs.writeFileSync(path.join(snapDir, 'index.html'), html);
  fs.writeFileSync(path.join(snapDir, 'renderer.js'), rendererJs);
  const hashOf = (p) => require('node:crypto').createHash('sha1').update(fs.readFileSync(p)).digest('hex').slice(0, 12);
  const gitHead = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim();
  console.log(`== PROVENANCE ==\nref ${REF} (HEAD ${gitHead}); styles.css ${hashOf(path.join(snapDir, 'styles.css'))} index.html ${hashOf(path.join(snapDir, 'index.html'))} renderer.js ${hashOf(path.join(snapDir, 'renderer.js'))} (transpiled from git)`);
  console.log(`mic rules changed 28a57cc..HEAD: ${execSync('git diff 28a57cc..HEAD -- src/renderer/styles.css', { cwd: root }).toString().match(/micPill|meeting-cam|mic-pop/g)?.length || 0}`);

  let previousState = null;
  try { previousState = fs.readFileSync(STATE_PATH, 'utf8'); } catch { previousState = null; }
  fs.writeFileSync(STATE_PATH, JSON.stringify({
    status: { state: 'pill', accent: '#e9eef7', surface: 'Black', glassLevel: 20,
      cardWidth: 420, visibleTabs: null, miniMode: 'clock', media: false, mediaTitle: '',
      meeting: false, meetingMicButton: true, word: false, hiddenUntilHover: false,
      scaleEffective: 100, openAction: 'last' },
    settings: { accent: '#e9eef7', surface: 'Black', glassLevel: 20, cardWidth: 420,
      visibleTabs: null, islandStyle: 'dynamic', islandContent: 'clock-robot',
      barOrder: ['clock', 'cat', 'battery', 'media', 'mic'], miniMode: 'clock',
      miniTrigger: 'fullscreen', islandPosition: 'center', monitor: 'main',
      edgeMargin: 4, islandScale: 100 },
    card: { lastTab: 'music', notices: [], clips: [], sites: [], shelf: [], tasks: [] },
  }, null, 2), 'utf8');

  const win = new BrowserWindow({
    width: PILL.width + MIC_EXTRA + BANNER_EXTRA, height: 39,
    frame: false, show: false, transparent: true, hasShadow: false,
    useContentSize: true, backgroundColor: '#00000000', paintWhenInitiallyHidden: true,
    webPreferences: { preload: path.join(root, '_qa-preload.js'), contextIsolation: true,
      nodeIntegration: false, sandbox: false, backgroundThrottling: false },
  });
  win.setMinimumSize(1, 1);
  win.setMaximumSize(4000, 4000);
  win.showInactive();
  await win.loadFile(path.join(snapDir, 'index.html'));
  await sleep(340);

  const status = (pos, meeting) => js(win, `window.probe.emit('status', ${JSON.stringify({
    state: 'pill', meeting, meetingMicButton: true, media: false, mediaTitle: '',
    miniMode: 'clock', scaleEffective: 100, accent: '#e9eef7', surface: 'Black',
    word: false, hiddenUntilHover: false, islandPosition: pos,
    glassLevel: 20, islandStyle: 'dynamic', visibleTabs: null, openAction: 'last',
  })}); true`);

  const table = [];
  for (const pos of POSITIONS) {
    const settings = { islandScale: 100, monitor: 'main', islandPosition: pos, edgeMargin: 4,
      islandStyle: 'dynamic', cardWidth: 420, pill: PILL,
      mini: { width: 64, height: 14 }, open: { width: 420, height: 92 } };
    const bounds = boundsFor('pill', settings, undefined, undefined, MIC_EXTRA, BANNER_EXTRA);
    await js(win, `window.probe.emit('settings', ${JSON.stringify({ islandPosition: pos })}); true`);
    win.setBounds(bounds);
    await status(pos, false);
    await sleep(320);
    await status(pos, true);
    /* Sample the pop animation while it is still running. */
    await sleep(70);
    const animEarly = await js(win, MEASURE);

    for (const state of STATES) {
      await sleep(state === 'joining' ? 320 : 1250);
      const m = await js(win, MEASURE);
      const img = await win.capturePage();
      const flat = flattenOver(img);
      const name = `qa-micgap-${pos}-${state}`;
      fs.writeFileSync(path.join(SHOT_DIR, `${name}.png`), flat.toPNG());
      fs.writeFileSync(path.join(SHOT_DIR, `${name}-raw.png`), img.toPNG());
      fs.writeFileSync(path.join(SHOT_DIR, `${name}-4x.png`),
        flat.resize({ width: flat.getSize().width * 4, quality: 'best' }).toPNG());

      const rightSide = pos === 'right' || pos === 'right-side';
      const strip = rightSide ? [0, m.body.left - 1] : [m.body.right + 1, m.innerWidth - 1];
      const painted = paintedSpan(img, strip[0], strip[1]);
      const gap = rightSide
        ? +(m.body.left - (painted.last + 1)).toFixed(1)
        : +(painted.first - m.body.right).toFixed(1);
      const visibleBtns = [
        m.micStyle.opacity > 0.5 && m.micStyle.display !== 'none' ? m.mic : null,
        m.camStyle.opacity > 0.5 && m.camStyle.display !== 'none' ? m.cam : null,
      ].filter(Boolean);
      const domEdge = rightSide
        ? Math.max(...visibleBtns.map((c) => c.right))
        : Math.min(...visibleBtns.map((c) => c.left));
      const domGap = rightSide ? +(m.body.left - domEdge).toFixed(1) : +(domEdge - m.body.right).toFixed(1);
      const overlap = rightSide ? painted.last >= m.body.left : painted.first <= m.body.right;
      const clipped = painted.first < strip[0] - 1 || painted.last > strip[1] + 1 || painted.first < 0;

      table.push({ pos, state, gap, domGap, painted: [painted.first, painted.last],
        body: [m.body.left, m.body.right], mic: [m.mic.left, m.mic.right],
        cam: [m.cam.left, m.cam.right], camDisplay: m.camStyle.display, camOpacity: m.camStyle.opacity,
        micState: m.micState, anim: m.layerStyle.animationName, overlap, clipped });

      check(`${name}: state ${state}, layer tampil`, m.micState === state
        && m.layerHidden === false && m.layerStyle.display === 'flex',
      `state=${m.micState} hidden=${m.layerHidden} display=${m.layerStyle.display}`);
      check(`${name}: gap terlukis 8..12 px`, gap >= 8 && gap <= 12,
        `gap=${gap} painted=${painted.first}..${painted.last} body=${m.body.left}..${m.body.right}`);
      check(`${name}: gap piksel == gap DOM tombol terlihat (+-2)`, Math.abs(gap - domGap) <= 2,
        `painted=${gap} dom=${domGap} (invisible button must not steal a slot)`);
      check(`${name}: tidak tumpang tindih / terpotong`, !overlap && !clipped,
        `overlap=${overlap} clipped=${clipped} strip=${strip[0]}..${strip[1]}`);
      check(`${name}: animasi mic-pop utuh`,
        (rightSide ? m.layerStyle.animationName === 'mic-pop-right' : m.layerStyle.animationName === 'mic-pop')
        && m.layerStyle.animationDuration === '0.32s',
      `name=${m.layerStyle.animationName} dur=${m.layerStyle.animationDuration} early=${JSON.stringify(animEarly.anims)}`);
      check(`${name}: cam ${state === 'on' ? 'muncul kembali' : 'sesuai aturan joining'}`,
        state === 'on'
          ? m.camStyle.display !== 'none' && m.camStyle.opacity > 0.5
          : (rightSide ? m.camStyle.display === 'none' : m.camStyle.display !== 'none' && m.camStyle.opacity === 0),
      `display=${m.camStyle.display} opacity=${m.camStyle.opacity} right=${rightSide}`);
    }
  }

  /* joining -> on: no capsule disappears, no body jump, no gap jump. */
  for (const pos of POSITIONS) {
    const a = table.find((r) => r.pos === pos && r.state === 'joining');
    const b = table.find((r) => r.pos === pos && r.state === 'on');
    check(`transisi ${pos}: tanpa lompatan badan / celah, kapsul tetap ada`,
      Math.abs(a.gap - b.gap) <= 2 && a.body[0] === b.body[0] && a.body[1] === b.body[1]
        && b.camDisplay !== 'none' && b.painted[1] > b.painted[0],
      `gap ${a.gap} -> ${b.gap}, body ${JSON.stringify(a.body)} -> ${JSON.stringify(b.body)}, cam ${a.camDisplay} -> ${b.camDisplay}`);
  }

  console.log('\n== TABEL GAP (piksel, 572x39) ==');
  console.log('pos          state     gap  gapDOM  painted      body        cam(display/op)');
  for (const r of table) {
    console.log(`${r.pos.padEnd(12)} ${r.state.padEnd(9)} ${String(r.gap).padStart(4)} ${String(r.domGap).padStart(7)}  `
      + `${String(r.painted[0]).padStart(3)}..${String(r.painted[1]).padEnd(3)}     ${String(r.body[0]).padStart(3)}..${String(r.body[1]).padEnd(3)}    ${r.camDisplay}/${r.camOpacity}`);
  }
  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(path.join(SHOT_DIR, 'qa-micgap-report.json'),
    JSON.stringify({ ref: REF, gitHead, table, results }, null, 2), 'utf8');
  console.log(`\nQA_MICGAP ${results.length - failed.length}/${results.length} PASS`);

  win.destroy();
  try { fs.rmSync(snapDir, { recursive: true, force: true }); } catch { /* windows locks */ }
  if (previousState === null) fs.rmSync(STATE_PATH, { force: true });
  else fs.writeFileSync(STATE_PATH, previousState, 'utf8');
  app.exit(failed.length ? 1 : 0);
});
