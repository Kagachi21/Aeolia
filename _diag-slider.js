/* Diagnostic: does the slider thumb sit on its rail, at every value?
   Reads real layout boxes (not thresholds), so the numbers are exact.
   Run: env -u ELECTRON_RUN_AS_NODE electron.exe _diag-slider.js */
const { app, BrowserWindow } = require('electron');
const path = require('node:path');

const root = __dirname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await app.whenReady();
  const win = new BrowserWindow({
    width: 420, height: 460, frame: false, show: false, transparent: true,
    hasShadow: false, useContentSize: true, backgroundColor: '#00000000',
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: path.join(root, '_qa-preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
      backgroundThrottling: false,
    },
  });
  await win.loadFile(path.join(root, 'dist', 'renderer', 'index.html'));
  win.showInactive();
  await sleep(400);
  const js = (code) => win.webContents.executeJavaScript(code);

  await js(`window.probe.emit('status', ${JSON.stringify({
    state: 'open', meeting: false, media: false, mediaTitle: '',
    accent: '#e9eef7', surface: 'Black', cardWidth: 420, cardHeight: 460,
    visibleTabs: null, hiddenUntilHover: false, openAction: 'last',
    miniMode: 'clock', islandScale: 100, scaleEffective: 100,
    islandPosition: 'center', islandStyle: 'dynamic', glassLevel: 55,
  })}); true`);
  await sleep(150);
  await js(`(() => { const b = document.querySelector('[data-tab="controls"]'); if (b) b.click(); return true; })()`);
  await sleep(350);

  const measure = `(() => {
    const wrap = document.getElementById('brightnessSlider').parentElement;
    const rail = wrap.querySelector('.cc-rail');
    const thumb = wrap.querySelector('.cc-thumb');
    const wr = wrap.getBoundingClientRect();
    const rr = rail.getBoundingClientRect();
    const tr = thumb.getBoundingClientRect();
    return {
      value: document.getElementById('brightnessSlider').value,
      pct: getComputedStyle(wrap).getPropertyValue('--cc-pct').trim(),
      wrap: { l: wr.left, t: wr.top, w: wr.width, h: wr.height },
      rail: { l: rr.left, r: rr.right, t: rr.top, b: rr.bottom },
      thumb: { l: tr.left, r: tr.right, t: tr.top, b: tr.bottom },
      railCx: (rr.left + rr.right) / 2,
      thumbCx: (tr.left + tr.right) / 2,
      thumbCy: (tr.top + tr.bottom) / 2,
      railTop: rr.top,
      railBottom: rr.bottom,
    };
  })()`;

  const results = [];
  for (const v of [0, 50, 100]) {
    await js(`(() => {
      const s = document.getElementById('brightnessSlider');
      s.value = '${v}';
      s.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(90);
    const m = await js(measure);
    const dx = +(m.thumbCx - m.railCx).toFixed(2);
    results.push({ v, dx, ...m });
    console.log(`value=${m.value} pct=${m.pct} railCx=${m.railCx.toFixed(2)} thumbCx=${m.thumbCx.toFixed(2)} dx=${dx} thumbCy=${m.thumbCy.toFixed(1)} rail=${m.railTop.toFixed(1)}..${m.railBottom.toFixed(1)}`);
  }

  // Horizontal agreement must hold at every value; vertical travel must span the rail.
  const worst = Math.max(...results.map((r) => Math.abs(r.dx)));
  const lo = results.find((r) => r.v === 0);
  const hi = results.find((r) => r.v === 100);
  const mid = results.find((r) => r.v === 50);
  console.log('WORST dx =', worst.toFixed(2), 'px');
  console.log('BOTTOM thumbCy =', lo.thumbCy.toFixed(1), 'railBottom =', lo.railBottom.toFixed(1));
  console.log('TOP    thumbCy =', hi.thumbCy.toFixed(1), 'railTop    =', hi.railTop.toFixed(1));
  console.log('MID    thumbCy =', mid.thumbCy.toFixed(1));
  app.exit(0);
}

main().catch((e) => { console.error(e); app.exit(1); });
