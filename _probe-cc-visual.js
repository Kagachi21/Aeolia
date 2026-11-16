/* Visual probe: renders the Control Centre in a real Electron window, checks
   the geometry that can be checked (including the thumb/rail alignment that
   regressed once), and writes a PNG per surface so the look can be reviewed.
   Run: env -u ELECTRON_RUN_AS_NODE electron.exe _probe-cc-visual.js */
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const root = __dirname;
const OUT = path.join(root, '_qa-shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SURFACES = ['Liquid glass', 'Translucent', 'Black'];

async function main() {
  await app.whenReady();
  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({
    width: 420, height: 470, frame: false, show: false, transparent: true,
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
  // A real pointer drag through Chromium's input pipeline. Setting .value in
  // JS only proves the paint code, not that the transparent native input is
  // oriented so a vertical drag produces a useful value.
  const dbg = win.webContents.debugger;
  try { dbg.attach('1.3'); } catch { /* already attached by the harness */ }
  const mouse = (type, x, y, buttons) => dbg.sendCommand('Input.dispatchMouseEvent', {
    type, x, y, button: 'left', buttons, clickCount: 1,
  });

  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok: Boolean(ok) });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  :: ' + detail}`);
  };

  const MEASURE = `(() => {
    const panel = document.querySelector('[data-panel="controls"]');
    const wrap = document.getElementById('brightnessSlider').parentElement;
    const rail = wrap.querySelector('.cc-rail');
    const thumb = wrap.querySelector('.cc-thumb');
    const input = document.getElementById('brightnessSlider');
    const ir = input.getBoundingClientRect();
    const rr = rail.getBoundingClientRect();
    const tr = thumb.getBoundingClientRect();
    const pr = panel.getBoundingClientRect();
    const strip = panel.querySelector('.cc-strip').getBoundingClientRect();
    const tileLabel = panel.querySelector('.cc-tile-label');
    return {
      active: panel.classList.contains('active'),
      value: +input.value,
      wells: panel.querySelectorAll('.cc-well').length,
      tiles: panel.querySelectorAll('.cc-tile').length,
      ranges: panel.querySelectorAll('input[type="range"]').length,
      labels: Array.from(panel.querySelectorAll('.cc-tile-label')).map((n) => n.textContent),
      panelW: Math.round(pr.width),
      panelH: Math.round(pr.height),
      overflow: panel.scrollHeight - panel.clientHeight,
      stripBottom: Math.round(strip.bottom - pr.top),
      inputW: +ir.width.toFixed(1), inputH: +ir.height.toFixed(1),
      railCx: +(((rr.left + rr.right) / 2)).toFixed(2),
      thumbCx: +(((tr.left + tr.right) / 2)).toFixed(2),
      thumbCy: +(((tr.top + tr.bottom) / 2)).toFixed(2),
      railTop: +rr.top.toFixed(2), railBottom: +rr.bottom.toFixed(2),
      railW: +rr.width.toFixed(1), railH: +rr.height.toFixed(1),
      tileInk: getComputedStyle(tileLabel).color,
      surface: document.getElementById('island').dataset.surface,
    };
  })()`;

  const setValue = (v) => js(`(() => {
    const s = document.getElementById('brightnessSlider');
    s.value = '${v}';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);

  const DRAG_GEOMETRY = `(() => {
    const input = document.getElementById('brightnessSlider');
    const r = input.getBoundingClientRect();
    return { x: r.left + r.width / 2, top: r.top + 4, bottom: r.bottom - 4,
      width: r.width, height: r.height };
  })()`;

  for (const surface of SURFACES) {
    await js(`window.probe.emit('status', ${JSON.stringify({
      state: 'open', meeting: false, media: false, mediaTitle: '',
      accent: '#e9eef7', surface, cardWidth: 420, cardHeight: 470,
      visibleTabs: null, hiddenUntilHover: false, openAction: 'last',
      miniMode: 'clock', islandScale: 100, scaleEffective: 100,
      islandPosition: 'center', islandStyle: 'dynamic', glassLevel: 55,
    })}); true`);
    await sleep(180);
    await js(`(() => { const b = document.querySelector('[data-tab="controls"]'); if (b) b.click(); return true; })()`);
    await sleep(320);

    await setValue(50);
    await sleep(90);
    const m = await js(MEASURE);

    check(`[${surface}] controls panel is active`, m.active);
    check(`[${surface}] two wells`, m.wells === 2, String(m.wells));
    check(`[${surface}] five tiles`, m.tiles === 5, String(m.tiles));
    check(`[${surface}] two ranges`, m.ranges === 2, String(m.ranges));
    check(`[${surface}] tile labels`, m.labels.join('|') === 'Wi-Fi|Bluetooth|Night light|Focus|Mute',
      m.labels.join('|'));
    check(`[${surface}] grid fits the card`, m.panelW > 0 && m.overflow <= 0, `overflow=${m.overflow}`);
    check(`[${surface}] strip is the last row`, m.stripBottom > 0 && m.stripBottom <= m.panelH,
      String(m.stripBottom));
    // The slider is vertical, drawn from a rail element rather than a UA thumb.
    check(`[${surface}] rail is vertical`, m.railH > m.railW * 4, `${m.railW}x${m.railH}`);
    check(`[${surface}] input covers the rail`, m.inputH > m.inputW && m.inputH >= m.railH - 1,
      `${m.inputW}x${m.inputH}`);

    // The reported bug: thumb must sit ON the rail, at every value.
    const offsets = [];
    const ends = {};
    for (const v of [0, 50, 100]) {
      await setValue(v);
      await sleep(80);
      const s = await js(MEASURE);
      offsets.push(Math.abs(s.thumbCx - s.railCx));
      ends[v] = s;
    }
    const worst = Math.max(...offsets);
    check(`[${surface}] thumb centred on rail at 0/50/100`, worst <= 0.5,
      `worst=${worst.toFixed(2)}px`);
    check(`[${surface}] value 0 sits on the rail's bottom end`,
      Math.abs(ends[0].thumbCy - ends[0].railBottom) <= 0.75,
      `thumbCy=${ends[0].thumbCy} railBottom=${ends[0].railBottom}`);
    check(`[${surface}] value 100 sits on the rail's top end`,
      Math.abs(ends[100].thumbCy - ends[100].railTop) <= 0.75,
      `thumbCy=${ends[100].thumbCy} railTop=${ends[100].railTop}`);
    check(`[${surface}] value 50 sits between the ends`,
      ends[50].thumbCy < ends[0].thumbCy && ends[50].thumbCy > ends[100].thumbCy,
      `${ends[100].thumbCy} < ${ends[50].thumbCy} < ${ends[0].thumbCy}`);

    // A real pointer drag: press near the bottom, move upwards in five steps.
    // A horizontal range in a 15x66 transparent box ignores most of this
    // motion, which is exactly the reported bug the programmatic checks missed.
    await setValue(0);
    await sleep(60);
    const g = await js(DRAG_GEOMETRY);
    const travel = g.bottom - g.top;
    await mouse('mousePressed', g.x, g.bottom, 1);
    const drag = [];
    for (const f of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      await mouse('mouseMoved', g.x, g.bottom - f * travel, 1);
      await sleep(70);
      const s = await js(MEASURE);
      drag.push({ f, value: s.value, thumbCy: s.thumbCy, railTop: s.railTop, railBottom: s.railBottom });
    }
    await mouse('mouseReleased', g.x, g.top, 0);
    const values = drag.map((d) => d.value);
    check(`[${surface}] real vertical drag spans most of 0..100`,
      values[0] > 0 && values[4] > 80 && values[4] - values[0] > 60,
      values.join(','));
    check(`[${surface}] drag values rise towards the top`,
      values.every((v, i) => i === 0 || v > values[i - 1]), values.join(','));
    const thumbError = Math.max(...drag.map((d) => {
      const expected = d.railBottom - (d.value / 100) * (d.railBottom - d.railTop);
      return Math.abs(d.thumbCy - expected);
    }));
    check(`[${surface}] drawn thumb follows the dragged value`, thumbError <= 1,
      `worst=${thumbError.toFixed(2)}px`);

    await setValue(50);
    await sleep(120);
    const shot = await win.capturePage();
    fs.writeFileSync(path.join(OUT, `cc-${surface.replace(/\s+/g, '-')}.png`), shot.toPNG());
  }

  try { dbg.detach(); } catch { /* nothing to detach */ }
  const failed = results.filter((r) => !r.ok);
  console.log(`\nCC_VISUAL ${results.length - failed.length}/${results.length} FAILED=${failed.length}`);
  app.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('probe crashed:', err);
  app.exit(1);
});
