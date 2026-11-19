/* R7 glass probe: open-glass-ui style dials, one lit edge, inset-only shadows,
   default-off SVG experiment, and untouched text selection/focus.
   Run: env -u ELECTRON_RUN_AS_NODE electron.exe _probe-r7-glass.js */
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const root = __dirname;
const css = fs.readFileSync(path.join(root, 'src/renderer/styles.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  :: ' + JSON.stringify(detail)}`);
};
const tokens = ['--glass-frost', '--glass-tint', '--glass-density', '--glass-saturation',
  '--glass-brightness', '--glass-edge', '--glass-depth', '--glass-light-dir'];
check('open-glass-ui material dials are mapped to tokens',
  tokens.every((t) => css.includes(t + ':')), tokens.filter((t) => !css.includes(t + ':')));
check('regular and clear dials differ',
  /data-glass-variant="clear"/.test(css) && /--glass-frost:/.test(css));
check('MIT attribution for copied token idea is present',
  /open-glass-ui \(MIT\)/.test(css));

const glassSection = css.slice(css.indexOf('/* ---- Original iOS-like Liquid Glass approximation'),
  css.indexOf('/* ---- Card controls'));
const shadows = glassSection.match(/box-shadow:\s*([^;]+);/g) || [];
check('every glass shadow is inset',
  shadows.length > 0 && shadows.every((s) => s.includes('inset')),
  `${shadows.length} shadows, ${shadows.filter((s) => !s.includes('inset')).length} outer`);
check('no glass-on-glass layer is added',
  (html.match(/class="glass-fx"/g) || []).length === 1
  && (html.match(/class="glass-fx__lit-edge"/g) || []).length === 1);
check('one lit edge follows the light-direction dial',
  /glass-fx__lit-edge/.test(css) && /var\(--glass-light-dir/.test(css)
  && /var\(--glass-edge/.test(css));

check('SVG displacement experiment exists',
  /id="r7-liquid"/.test(html) && /feImage/.test(html) && /feDisplacementMap/.test(html)
  && /feComposite/.test(html));
check('experiment attribution and captured-desktop distinction are stated',
  /rdev\/liquid-glass-react \(MIT\)/.test(html)
  && /DOM-only filter cannot sample the OS\s+desktop/.test(html)
  && /captured-desktop canvas/.test(html));
check('experiment has no default-on selector',
  !/#island\s*\{[^}]*filter:\s*url\(#r7-liquid\)/.test(css)
  && /data-glass-experiment="on"/.test(css));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function runtime() {
  const win = new BrowserWindow({
    width: 420, height: 470, frame: false, show: true, transparent: true,
    webPreferences: {
      preload: path.join(root, '_qa-preload.js'), contextIsolation: true,
      nodeIntegration: false, sandbox: false, backgroundThrottling: false,
    },
  });
  try {
    await win.loadFile(path.join(root, 'dist', 'renderer', 'index.html'));
    const js = (code) => win.webContents.executeJavaScript(code);
    await js(`window.probe.emit('status', { state: 'pill', surface: 'Liquid glass',
      glassLevel: 55, visibleTabs: ['notifications'], hiddenUntilHover: false }); true`);
    await sleep(250);
    const dom = await js(`(() => {
      const island = document.getElementById('island');
      const fx = document.querySelector('.glass-fx');
      const edge = document.querySelector('.glass-fx__lit-edge');
      const text = document.querySelector('#clock');
      return { fxCount: document.querySelectorAll('.glass-fx').length,
        display: getComputedStyle(fx).display, pointer: getComputedStyle(fx).pointerEvents,
        edgeDisplay: edge ? getComputedStyle(edge).display : 'missing',
        experiment: island.dataset.glassExperiment || '',
        filter: getComputedStyle(document.querySelector('.glass-fx__refract')).filter,
        userSelect: text ? getComputedStyle(text).userSelect : '' };
    })()`);
    check('exactly one active optical layer, inert to the pointer',
      dom.fxCount === 1 && dom.display === 'block' && dom.pointer === 'none', dom);
    check('lit edge is disabled on light glass so no white frame is painted', dom.edgeDisplay === 'none', dom);
    check('SVG filter is off by default',
      dom.experiment !== 'on' && !/url\(/.test(dom.filter), dom);
    check('text stays selectable', dom.userSelect !== 'none', dom);

    const on = await js(`(() => {
      const island = document.getElementById('island');
      island.dataset.glassExperiment = 'on';
      const filter = getComputedStyle(document.querySelector('.glass-fx__refract')).filter;
      island.dataset.glassExperiment = '';
      return filter;
    })()`);
    check('SVG experiment applies only when switched on', /url\(/.test(on), on);

    await js(`window.probe.emit('status', { state: 'open' }); true`);
    await sleep(180);
    const focus = await js(`(() => {
      const b = document.querySelector('.tab');
      b.focus();
      const el = document.activeElement;
      return { focused: el === b, outline: getComputedStyle(b).outlineStyle };
    })()`);
    check('capsule focus stays visible', focus.focused && focus.outline !== 'none', focus);
  } catch (err) {
    check('glass runtime ran without throwing', false, String(err && err.stack || err));
  } finally {
    win.destroy();
  }
}

app.whenReady().then(async () => {
  await runtime();
  const failed = results.filter((r) => !r.ok);
  console.log(`\nR7_GLASS ${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) console.log('FAILED: ' + failed.map((f) => f.name).join(' | '));
  app.exit(failed.length ? 1 : 0);
}).catch((err) => { console.error(err && err.stack || err); app.exit(1); });
