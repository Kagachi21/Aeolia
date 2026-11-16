/* Probe: verifies the upgraded original web-native Liquid Glass layer stack.
 * Run: env -u ELECTRON_RUN_AS_NODE electron.exe _probe-glass-upgrade.js
 *
 * Asserts the six compositor layers exist and are materially stronger than a
 * plain bevel, that glassLevel drives --glass-a, and that the supported
 * fallback (data-glass-fx="off") and non-liquid surfaces hide the effect.
 * Nothing here touches src/. */
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const root = __dirname;
const STATE = path.join(root, '_qa-state.json');
const prev = (() => { try { return fs.readFileSync(STATE, 'utf8'); } catch { return null; } })();
fs.writeFileSync(STATE, JSON.stringify({
  status: { state: 'pill', surface: 'Liquid glass', glassLevel: 70,
    accent: '#e9eef7', miniMode: 'clock' },
  settings: { surface: 'Liquid glass', glassLevel: 70, accent: '#e9eef7',
    barOrder: ['clock', 'cat', 'battery', 'media', 'mic'], catGreeting: false },
}, null, 2));

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  :: ' + detail}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const LAYERS = `
(() => {
  const isl = document.getElementById('island');
  const fx = document.querySelector('.glass-fx');
  const cs = (el) => el ? getComputedStyle(el) : null;
  const layer = (name) => {
    const el = document.querySelector('.glass-fx__' + name);
    if (!el) return null;
    const c = getComputedStyle(el);
    return {
      display: c.display,
      opacity: c.opacity,
      bgImage: c.backgroundImage.slice(0, 220),
      bgSize: c.backgroundSize,
      shadow: c.boxShadow.slice(0, 260),
      mask: (c.maskImage || c.webkitMaskImage || '').slice(0, 140),
      filter: c.filter,
      blend: c.mixBlendMode,
    };
  };
  return {
    state: isl.dataset.state, surface: isl.dataset.surface,
    glassFx: isl.dataset.glassFx, glassA: getComputedStyle(isl).getPropertyValue('--glass-a').trim(),
    fxDisplay: cs(fx) ? cs(fx).display : null,
    layerNames: Array.from(document.querySelectorAll('.glass-fx > span')).map((e) => e.className),
    refract: layer('refract'), dispersion: layer('dispersion'), inner: layer('inner'),
    fresnel: layer('fresnel'), glare: layer('glare'), glint: layer('glint'),
  };
})()`;

(async () => {
  let win;
  try {
    await app.whenReady();
    win = new BrowserWindow({
      width: 200, height: 48, frame: false, show: false, transparent: true,
      webPreferences: { preload: path.join(root, '_qa-preload.js'), contextIsolation: true,
        nodeIntegration: false, sandbox: false, backgroundThrottling: false },
    });
    await win.loadFile(path.join(root, 'dist', 'renderer', 'index.html'));
    await win.webContents.executeJavaScript(`window.probe.emit('status', window.probe.data().status); true`);
    await sleep(320);

    const m = await win.webContents.executeJavaScript(LAYERS);
    console.log('MEASURE', JSON.stringify(m));

    check('liquid glass active in pill', m.surface === 'Liquid glass' && m.fxDisplay === 'block',
      `surface=${m.surface} fxDisplay=${m.fxDisplay}`);
    check('glass fx support detected', m.glassFx === 'on', `data-glass-fx=${m.glassFx}`);
    check('glassLevel drives --glass-a (70 -> ~0.7)', Math.abs(parseFloat(m.glassA) - 0.7) < 0.02,
      `--glass-a=${m.glassA}`);

    const names = m.layerNames.join(' ');
    for (const n of ['refract', 'dispersion', 'inner', 'fresnel', 'glare', 'glint']) {
      check('layer present: ' + n, names.includes('glass-fx__' + n), names);
    }

    /* The blend mode follows the pane, not a fixed preference. `screen` only
       ever lightens, which is exactly right over a DARK base: the lens bands
       glow without hiding the wallpaper. Liquid glass is a light frost now,
       and screen over it clips straight to white - the entire glass stack
       vanished. The light-pane override in styles.css therefore uses normal
       blending, so assert the mode that matches the material. */
    const wantBlend = 'normal';   // Liquid glass = iOS-style light material
    check('refraction blends for a light pane + edge mask',
      m.refract && m.refract.blend === wantBlend && /gradient/.test(m.refract.mask),
      JSON.stringify({ blend: m.refract && m.refract.blend, want: wantBlend, mask: m.refract && m.refract.mask }));
    check('dispersion has >=4 inset colour fringes',
      m.dispersion && (m.dispersion.shadow.match(/inset/g) || []).length >= 4,
      m.dispersion && m.dispersion.shadow);
    check('inner contour is a masked 2px ring',
      m.inner && /gradient/.test(m.inner.mask) && /gradient/.test(m.inner.bgImage),
      JSON.stringify({ mask: m.inner && m.inner.mask, bg: m.inner && m.inner.bgImage }));
    check('fresnel is a conic masked rim',
      m.fresnel && /conic-gradient/.test(m.fresnel.bgImage) && /gradient/.test(m.fresnel.mask),
      m.fresnel && m.fresnel.bgImage);
    check('glint is a crisp sized specular (px background-size)',
      m.glint && /px/.test(m.glint.bgSize) && /gradient/.test(m.glint.bgImage) && m.glint.blend === wantBlend,
      JSON.stringify({ bgSize: m.glint && m.glint.bgSize, blend: m.glint && m.glint.blend, want: wantBlend }));

    // Fallback: turning the effect off must hide the whole stack.
    await win.webContents.executeJavaScript(
      `document.getElementById('island').dataset.glassFx = 'off'; true`);
    await sleep(60);
    const off = await win.webContents.executeJavaScript(
      `getComputedStyle(document.querySelector('.glass-fx')).display`);
    check('data-glass-fx="off" hides the whole stack', off === 'none', `display=${off}`);

    // Non-liquid surface must not show the effect either.
    await win.webContents.executeJavaScript(`
      const i = document.getElementById('island');
      i.dataset.glassFx = 'on'; i.dataset.surface = 'Graphite'; true`);
    await sleep(60);
    const other = await win.webContents.executeJavaScript(
      `getComputedStyle(document.querySelector('.glass-fx')).display`);
    check('non-liquid surface hides the effect', other === 'none', `display=${other}`);

    // Translucent is the user's live surface: it must get the retuned stack too.
    await win.webContents.executeJavaScript(`(() => {
      document.getElementById('island').dataset.surface = 'Translucent'; return true;
    })()`);
    await sleep(60);
    const trans = await win.webContents.executeJavaScript(`(() => {
      const fx = document.querySelector('.glass-fx');
      const glint = document.querySelector('.glass-fx__glint');
      return { display: getComputedStyle(fx).display,
        glintBlend: glint ? getComputedStyle(glint).mixBlendMode : null,
        glintBg: glint ? getComputedStyle(glint).backgroundImage.slice(0, 80) : null };
    })()`);
    check('Translucent also renders the glass stack', trans.display === 'block', `display=${trans.display}`);
    check('Translucent glint uses normal blend (visible on light pane)',
      trans.glintBlend === 'normal' && /gradient/.test(trans.glintBg || ''),
      JSON.stringify(trans));
  } catch (e) {
    check('probe ran without throwing', false, String(e && e.stack || e));
  } finally {
    if (win) { try { win.destroy(); } catch {} }
    try { fs.rmSync(STATE, { force: true }); } catch {}
    if (prev !== null) { try { fs.writeFileSync(STATE, prev); } catch {} }
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\nGLASSUPGRADE ${results.length - failed}/${results.length}  FAILED=${failed}`);
    app.exit(failed ? 1 : 0);
  }
})();
