/* R8 regression probe: layout stability, browser mini trigger, camera in
 * Google Meet, non-overlapping hints, and three distinct glass surfaces.
 * Run: env -u ELECTRON_RUN_AS_NODE electron.exe _probe-r8-fixes.js
 */
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const root = __dirname;
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  :: ' + JSON.stringify(detail)}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (win, code) => win.webContents.executeJavaScript(code);

function pureChecks() {
  const awPath = path.join(root, 'dist', 'main', 'activeWindow.js');
  const camPath = path.join(root, 'dist', 'main', 'camToggle.js');
  const aw = fs.existsSync(awPath) ? require(awPath) : {};
  const cam = fs.existsSync(camPath) ? require(camPath) : {};

  check('browser mini decision is a pure exported function',
    typeof aw.browserShouldShrink === 'function', typeof aw.browserShouldShrink);
  if (typeof aw.browserShouldShrink === 'function') {
    check('Chrome Meet with one tab stays a pill',
      aw.browserShouldShrink('chrome', 'Google Meet - Google Chrome', false, 1) === false);
    check('Chrome with many tabs shrinks to the notch',
      aw.browserShouldShrink('chrome', 'YouTube - Google Chrome', false, 9) === true);
    check('fullscreen still shrinks immediately',
      aw.browserShouldShrink('chrome', 'Google Meet - Google Chrome', true, 1) === true);
    check('non-browser is unaffected',
      aw.browserShouldShrink('zoom', 'Zoom Meeting', false, 1) === false);
  }

  check('camera target resolves Google Meet inside Chrome',
    typeof cam.cameraAppFor === 'function'
      && cam.cameraAppFor('chrome', 'Google Meet - Google Chrome') === 'Google Meet',
    typeof cam.cameraAppFor === 'function'
      ? cam.cameraAppFor('chrome', 'Google Meet - Google Chrome') : 'missing');
  if (typeof cam.cameraAppFor === 'function') {
    check('ordinary Chrome tab is not treated as Meet',
      cam.cameraAppFor('chrome', 'YouTube - Google Chrome') === 'chrome');
    const app = cam.cameraAppFor('chrome', 'Google Meet - Google Chrome');
    const d = cam.camDecision(app, app);
    check('Google Meet in Chrome gets ctrl+e', d.send === 'ctrl+e', d);
  }
}

async function domChecks() {
  const win = new BrowserWindow({
    width: 460, height: 560, frame: false, show: true, transparent: true,
    webPreferences: {
      preload: path.join(root, '_qa-preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
      backgroundThrottling: false,
    },
  });
  try {
    await win.loadFile(path.join(root, 'dist', 'renderer', 'index.html'));
    const status = (surface = 'Liquid glass', state = 'pill') => `window.probe.emit('status', ${JSON.stringify({
      state, surface, glassLevel: 55, accent: '#e9eef7', cardWidth: 420,
      visibleTabs: ['sholat', 'notifications', 'controls'], scaleEffective: 100,
      miniMode: 'clock', meeting: true, meetingApp: 'Chrome', media: false,
      hiddenUntilHover: false,
    })}); true`;
    const settings = (surface) => `window.probe.emit('settings', ${JSON.stringify({
      surface, glassLevel: 55, accent: '#e9eef7', cardWidth: 420,
      visibleTabs: ['sholat', 'notifications', 'controls'], islandStyle: 'dynamic',
      islandContent: 'clock-robot', miniMode: 'clock', miniTrigger: 'busy',
      islandPosition: 'center', monitor: 'main', edgeMargin: 4, islandScale: 100,
      barOrder: ['clock', 'cat', 'battery', 'media', 'mic'], catIdleCenter: true,
      catGreeting: false,
    })}); true`;

    await js(win, settings('Liquid glass'));
    await js(win, status('Liquid glass', 'pill'));
    await sleep(280);
    await js(win, `document.getElementById('meetingCam').click(); true`);
    await sleep(140);

    const catBefore = await js(win, `(() => { const b = document.querySelector('#pillCatSlot').getBoundingClientRect(); return b.x; })()`);
    await js(win, `window.probe.emit('robot', { idle: false, batteryPercent: 80, charging: false, cursorDx: 0 }); true`);
    await sleep(160);
    const catAfterFalse = await js(win, `(() => { const b = document.querySelector('#pillCatSlot').getBoundingClientRect(); return b.x; })()`);
    await js(win, `window.probe.emit('robot', { idle: true, batteryPercent: 80, charging: false, cursorDx: 0 }); true`);
    await sleep(160);
    const catAfterTrue = await js(win, `(() => { const b = document.querySelector('#pillCatSlot').getBoundingClientRect(); return b.x; })()`);
    check('cat does not jump when idle changes',
      Math.abs(catAfterFalse - catAfterTrue) < 1,
      { catBefore, catAfterFalse, catAfterTrue });

    // Open state with an active hint must not overlay panel content.
    await js(win, status('Liquid glass', 'open'));
    await js(win, `document.getElementById('meetingCam').click(); true`);
    await sleep(160);
    const hint = await js(win, `(() => {
      const banner = document.getElementById('banner');
      const inline = document.getElementById('openHint');
      const panel = document.querySelector('.panel.active');
      return {
        bannerHidden: banner.hidden,
        inlineVisible: Boolean(inline && !inline.hidden && inline.textContent.trim()),
        inlineText: inline ? inline.textContent.trim() : '',
        panelTop: panel ? Math.round(panel.getBoundingClientRect().top) : null,
        inlineBottom: inline ? Math.round(inline.getBoundingClientRect().bottom) : null,
      };
    })()`);
    check('camera hint does not overlay the open card',
      hint.bannerHidden && hint.inlineVisible && hint.inlineBottom <= hint.panelTop + 1, hint);

    const materials = {};
    for (const surface of ['Liquid glass', 'Translucent', 'Candy glass']) {
      await js(win, settings(surface));
      await js(win, status(surface, 'pill'));
      await sleep(180);
      materials[surface] = await js(win, `(() => {
        const i = document.getElementById('island');
        const cs = getComputedStyle(i);
        return { variant: i.dataset.glassVariant, bg: cs.backgroundImage + '|' + cs.backgroundColor };
      })()`);
    }
    const liquid = materials['Liquid glass'];
    const translucent = materials['Translucent'];
    const candy = materials['Candy glass'];
    check('Liquid glass uses the regular variant', liquid.variant === 'regular', liquid);
    check('Translucent uses the clear variant', translucent.variant === 'clear', translucent);
    check('Candy glass uses a candy variant', candy.variant === 'candy', candy);
    check('Liquid and Translucent backgrounds are materially different',
      liquid.bg !== translucent.bg, { liquid: liquid.bg.slice(0, 160), translucent: translucent.bg.slice(0, 160) });
    check('Translucent is a smoky neutral pane, not the same white frost',
      /rgba\(120, 130, 145/.test(translucent.bg) && !/228, 234, 246/.test(translucent.bg),
      translucent.bg.slice(0, 200));
    check('Candy glass is a light tinted material, not a dark card',
      /rgba\(255,\s*1[5-9]\d|rgba\(255,\s*2\d\d|rgba\(248,\s*230,\s*238|candy/i.test(candy.bg)
      || /(pink|rose|255,\s*1\d\d,\s*2\d\d)/i.test(candy.bg), candy.bg.slice(0, 200));
  } finally {
    win.destroy();
  }
}

app.whenReady().then(async () => {
  pureChecks();
  await domChecks();
  const failed = results.filter((r) => !r.ok);
  console.log(`R8_FIXES ${results.length - failed.length}/${results.length} PASS FAILED=${failed.length}`);
  app.quit();
}).catch((e) => { console.error(e); app.exit(1); });
