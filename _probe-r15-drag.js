/* R15 DRAG probe (fails before the drag implementation).
   Verifies: (1) islandOffset translates/clamps window bounds, (2) Island.dragBy
   moves the real window and exposes the accumulated offset, (3) the offset
   survives a settings "restart" (fresh module load from disk), (4) main /
   preload / renderer wire the drag IPC and suppress hover-open while dragging.
   Run: node _probe-r15-drag.js  */
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const root = __dirname;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aeolia-r15-drag-'));
const settingsFile = path.join(tmp, 'settings.json');
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  :: ' + detail}`);
};

const display = { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
const electronMock = {
  screen: { getPrimaryDisplay: () => display, getDisplayNearestPoint: () => display, getCursorScreenPoint: () => ({ x: 960, y: 5 }) },
  app: { getPath: () => tmp },
};
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronMock;
  return originalLoad.call(this, request, parent, isMain);
};

const fresh = (rel) => {
  const p = require.resolve(path.join(root, rel));
  delete require.cache[p];
  return require(p);
};

(async () => {
  fs.writeFileSync(settingsFile, JSON.stringify({ islandPosition: 'center', islandScale: 100, edgeMargin: 4, islandStyle: 'dynamic', mini: { width: 64, height: 14 }, pill: { width: 150, height: 36 }, open: { width: 360, height: 92 } }), 'utf8');
  const settings = fresh('dist/main/settings.js');
  const bounds = fresh('dist/main/bounds.js');
  const s = settings.loadSettings();
  const base = bounds.boundsFor('pill', s);

  // 1. Offset changes the position (and only the position, not the size).
  const moved = { ...s, islandOffset: { x: 120, y: 30 } };
  const shifted = bounds.boundsFor('pill', moved);
  check('islandOffset translates the pill', shifted.x === base.x + 120 && shifted.y === base.y + 30,
    `${base.x},${base.y} -> ${shifted.x},${shifted.y}`);
  check('islandOffset does not resize the pill', shifted.width === base.width && shifted.height === base.height,
    `${base.width}x${base.height} -> ${shifted.width}x${shifted.height}`);

  // 2. Clamp to the active display; a huge offset must never leave the screen.
  const far = bounds.boundsFor('pill', { ...s, islandOffset: { x: 99999, y: 99999 } });
  check('islandOffset is clamped to the active display',
    far.x + far.width <= display.bounds.width && far.y + far.height <= display.bounds.height
      && far.x >= display.bounds.x && far.y >= display.bounds.y,
    JSON.stringify(far));

  // 3. Island.dragBy moves the window and reports the accumulated offset.
  const { Island } = fresh('dist/main/island.js');
  const win = {
    _b: { ...base },
    setBounds(b) { this._b = { ...b }; },
    getBounds() { return { ...this._b }; },
  };
  const island = new Island(win, settings.loadSettings());
  island.place();
  if (typeof island.setDragging === 'function') island.setDragging(true);
  if (typeof island.dragBy === 'function') island.dragBy(40, 25);
  const after = win.getBounds();
  check('dragBy moves the BrowserWindow', after.x === base.x + 40 && after.y === base.y + 25,
    `${base.x},${base.y} -> ${after.x},${after.y}`);
  check('dragBy exposes the persisted offset',
    typeof island.getOffset === 'function'
      && island.getOffset().x === 40 && island.getOffset().y === 25,
    typeof island.getOffset === 'function' ? JSON.stringify(island.getOffset()) : 'no getOffset');

  // 4. Persist, then reload from disk as if the app had restarted.
  settings.setValue('islandOffset', island.getOffset ? island.getOffset() : { x: 40, y: 25 });
  const onDisk = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  check('drag offset is written to settings.json', onDisk.islandOffset && onDisk.islandOffset.x === 40 && onDisk.islandOffset.y === 25,
    JSON.stringify(onDisk.islandOffset));
  const reloaded = fresh('dist/main/settings.js').loadSettings();
  const bounds2 = fresh('dist/main/bounds.js').boundsFor('pill', reloaded);
  check('offset survives a settings reload', bounds2.x === base.x + 40 && bounds2.y === base.y + 25,
    `${bounds2.x},${bounds2.y}`);

  // 5. Wiring: drag start cancels hover-open; pointer bridge exists.
  const mainSrc = fs.readFileSync(path.join(root, 'src/main/main.ts'), 'utf8');
  const preloadSrc = fs.readFileSync(path.join(root, 'src/preload/preload.ts'), 'utf8');
  const rendererSrc = fs.readFileSync(path.join(root, 'src/renderer/renderer.ts'), 'utf8');
  check('main registers drag IPC channels',
    /island:drag-start/.test(mainSrc) && /island:drag-move/.test(mainSrc) && /island:drag-end/.test(mainSrc));
  check('drag start cancels hover-open',
    /island:drag-start[\s\S]{0,220}cancelHover\(\)/.test(mainSrc));
  check('hover poll is gated while dragging', /function pollHoverZone[\s\S]{0,240}dragging/.test(mainSrc));
  check('preload exposes the drag bridge',
    /dragStart/.test(preloadSrc) && /dragMove/.test(preloadSrc) && /dragEnd/.test(preloadSrc));
  check('renderer starts drag on non-interactive pointerdown',
    /pointerdown/.test(rendererSrc) && /dragStart\(\)/.test(rendererSrc)
      && /closest\([^)]*button/.test(rendererSrc));
  check('renderer suppresses the click that follows a drag', /dragJustMoved/.test(rendererSrc));

  Module._load = originalLoad;
  const failed = results.filter((r) => !r.ok);
  console.log(`\nR15_DRAG ${results.length - failed.length}/${results.length} FAILED=${failed.length}`);
  process.exit(failed.length === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
