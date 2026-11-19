/* Focused probe: the glass material must be optical (lens, moving specular,
   two variants, interaction energy) and must keep ink contrast intact.
   Run: env -u ELECTRON_RUN_AS_NODE electron.exe _probe-glass-material.js */
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const root = __dirname;
const css = fs.readFileSync(path.join(root, 'src/renderer/styles.css'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'src/renderer/renderer.ts'), 'utf8');
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  :: ' + detail}`);
};

const rule = (selector) => (css.match(new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}')) || [])[1] || '';
const section = (start, end) => {
  const a = css.indexOf(start);
  return a < 0 ? '' : css.slice(a, end ? css.indexOf(end, a) : css.length);
};
const lensSection = section('/* ---- Original iOS-like Liquid Glass approximation', '/* ---- Card controls');
const clearSection = section('#island[data-glass-variant="clear"]');

check('pointer-driven highlight variables are declared',
  /--glass-x:/.test(rule('#island')) && /--glass-y:/.test(rule('#island')));
check('renderer writes pointer-driven highlight variables',
  /setProperty\('--glass-x'/.test(renderer) && /setProperty\('--glass-y'/.test(renderer));
check('renderer assigns a single glass variant per surface',
  /dataset\.glassVariant\s*=/.test(renderer) && /glassVariant[\s\S]{0,120}clear/.test(renderer));

const inner = rule('#island:is([data-surface="Liquid glass"], [data-surface="Translucent"], [data-surface="Candy glass"]) .glass-fx__inner');
check('edge lens has one restrained inner contour', (inner.match(/inset/g) || []).length >= 2 && (inner.match(/inset/g) || []).length <= 3,
  `${(inner.match(/inset/g) || []).length} inset contours`);
check('edge lens avoids a four-corner halo',
  (inner.match(/at (6|8|92|94)% (6|8|92|94)%/g) || []).length === 0,
  String((inner.match(/at (6|8|92|94)% (6|8|92|94)%/g) || []).length));
check('edge lens carries a thicker lower waterline',
  /0 -[3-9]px/.test(inner) && /rgba\(255, 255, 255/.test(inner));

const lightRefract = rule('#island:is([data-surface="Liquid glass"], [data-surface="Translucent"], [data-surface="Candy glass"]) .glass-fx__refract');
const dispersionOff = /glass-fx__dispersion\s*\{[^}]*display:\s*none/.test(css);
check('light pane does not paint a chromatic fringe', dispersionOff,
  dispersionOff ? 'dispersion layer off' : 'no display:none rule for .glass-fx__dispersion');
check('light pane has a visible cool edge vignette',
  /rgba\(74, 90, 118, 0\.[3-9]\d*\)/.test(lightRefract)
  || /rgba\(54, 70, 100, 0\.[3-9]\d*\)/.test(lightRefract),
  (lightRefract.match(/rgba\((?:74, 90, 118|54, 70, 100), [^)]+\)/g) || []).join(' '));

const glare = rule('#island:is([data-surface="Liquid glass"], [data-surface="Translucent"], [data-surface="Candy glass"]) .glass-fx__glare');
const glint = rule('#island:is([data-surface="Liquid glass"], [data-surface="Translucent"], [data-surface="Candy glass"]) .glass-fx__glint');
check('specular follows the pointer, not a static diagonal band',
  /var\(--glass-x/.test(glare) && /var\(--glass-y/.test(glare)
  && /var\(--glass-x/.test(glint) && /var\(--glass-y/.test(glint));
check('glint stays a crisp sized highlight', /px/.test(glint.match(/background-size:[^;]*/)?.[0] || ''));

check('interaction energy lights the glass on hover',
  /data-hovered="true"[^\n]*glass-fx/.test(lensSection));
check('reduced motion disables the interaction energy',
  /prefers-reduced-motion: reduce[\s\S]{0,700}hovered="true"/.test(lensSection));

check('clear variant lowers the base alpha',
  /data-glass-variant="clear"/.test(clearSection)
  && /0\.6[0-9] \+ 0\.[0-9]+ \* var\(--glass-a/.test(clearSection));
check('clear variant adds local dimming where text sits',
  /data-glass-variant="clear"[^\n]*\.panel/.test(clearSection) && /rgba\(2[0-9], 3[0-9], 4[0-9]/.test(clearSection));

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
    const status = (surface) => `window.probe.emit('status', ${JSON.stringify({
      state: 'open', surface, glassLevel: 55, accent: '#e9eef7', cardWidth: 420,
      visibleTabs: ['controls'], scaleEffective: 100, miniMode: 'clock',
    })}); true`;
    await js(status('Liquid glass'));
    await sleep(320);
    const regular = await js(`(() => {
      const i = document.getElementById('island');
      const g = document.querySelector('.glass-fx__glint');
      return { variant: i.dataset.glassVariant, x: getComputedStyle(i).getPropertyValue('--glass-x').trim(),
        pos: getComputedStyle(g).backgroundPosition, shadow: getComputedStyle(i).boxShadow };
    })()`);
    check('runtime: regular variant selected for Liquid glass', regular.variant === 'regular', regular.variant);
    const shadows = regular.shadow.split(/,(?![^(]*\))/).map((s) => s.trim()).filter(Boolean);
    check('runtime: no outer shadow on the glass',
      shadows.length > 0 && shadows.every((s) => /inset/.test(s)),
      `${shadows.length} shadows, all inset=${shadows.every((s) => /inset/.test(s))}`);

    const dbg = win.webContents.debugger;
    try { dbg.attach('1.3'); } catch { /* already attached */ }
    await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 380, y: 8 });
    await sleep(90);
    const moved = await js(`(() => {
      const i = document.getElementById('island');
      const g = document.querySelector('.glass-fx__glint');
      return { x: getComputedStyle(i).getPropertyValue('--glass-x').trim(),
        pos: getComputedStyle(g).backgroundPosition };
    })()`);
    check('runtime: pointer moves the highlight', moved.x !== regular.x && moved.pos !== regular.pos,
      `${regular.x} -> ${moved.x}`);

    await js(status('Translucent'));
    await sleep(240);
    const clear = await js(`(() => {
      const i = document.getElementById('island');
      const p = document.querySelector('.panel.active');
      return { variant: i.dataset.glassVariant, panelBg: p ? getComputedStyle(p).backgroundImage : '',
        bg: getComputedStyle(i).backgroundImage };
    })()`);
    check('runtime: clear variant selected for Translucent', clear.variant === 'clear', clear.variant);
    check('runtime: clear variant changes the material and text backing',
      clear.bg !== '' && clear.panelBg !== '');
    try { dbg.detach(); } catch { /* nothing to detach */ }
  } catch (e) {
    check('runtime probe ran without throwing', false, String(e && e.stack || e));
  } finally {
    win.destroy();
  }
}

app.whenReady().then(async () => {
  await runtime();
  const failed = results.filter((r) => !r.ok);
  console.log(`\nGLASSMATERIAL ${results.length - failed.length}/${results.length} FAILED=${failed.length}`);
  app.exit(failed.length === 0 ? 0 : 1);
}).catch((e) => { console.error(e); app.exit(1); });
