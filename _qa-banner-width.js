/* Regression probe: a notice/meeting banner widens the pill window by
   BANNER_EXTRA, and when it ends the window MUST shrink back to the stored
   pill width. The old code only restored the width when the base state was
   'mini', so a banner over a normal pill left a ~400 px empty bar forever
   (clock far left, cat far right) — the user's "Panjangg" bug.

   Pure Node: electron is mocked, the compiled Island class is exercised with
   a fake BrowserWindow that records setBounds calls.
   Run: node _qa-banner-width.js   (after `npm run build`) */
const Module = require('node:module');
const path = require('node:path');

const root = __dirname;
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  :: ' + detail}`);
};

/* ------------------------------------------------------------- electron mock */
const display = {
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
};
const electronMock = {
  screen: {
    getPrimaryDisplay: () => display,
    getDisplayNearestPoint: () => display,
    getCursorScreenPoint: () => ({ x: 960, y: 540 }),
  },
};
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronMock;
  return originalLoad.call(this, request, parent, isMain);
};

const { Island } = require(path.join(root, 'dist', 'main', 'island.js'));

/* --------------------------------------------------------------- fake window */
function makeWindow() {
  const calls = [];
  return {
    calls,
    setBounds(b) { calls.push({ ...b }); },
    getBounds() { return calls.length ? calls[calls.length - 1] : { x: 0, y: 0, width: 0, height: 0 }; },
    isDestroyed() { return false; },
  };
}

const settings = {
  monitor: 'main',
  islandScale: 100,
  islandPosition: 'center',
  edgeMargin: 4,
  pill: { width: 150, height: 36 },
  mini: { width: 112, height: 26 },
  open: { width: 360, height: 92 },
  cardWidth: 420,
};

/* --------------------------------------------------------------------- tests */
const win = makeWindow();
const island = new Island(win, settings, () => {});
island.place();

const base = win.calls[win.calls.length - 1];
check('pill starts at the stored 150 px width', base.width === 150, `width=${base.width}`);

win.calls.length = 0;
island.setBanner(true);
const widened = win.calls[win.calls.length - 1];
check('banner widens the pill by BANNER_EXTRA (250)', widened && widened.width === 400, `width=${widened && widened.width}`);

win.calls.length = 0;
island.setBanner(false);
const restored = win.calls[win.calls.length - 1];
check('banner end restores the stored pill width',
  Boolean(restored) && restored.width === 150,
  restored ? `width=${restored.width}` : 'setBounds was never called (window stays wide)');

/* A second banner cycle must behave the same (no cumulative drift). */
win.calls.length = 0;
island.setBanner(true);
island.setBanner(false);
const restored2 = win.calls[win.calls.length - 1];
check('second banner cycle also restores 150 px', restored2 && restored2.width === 150, `width=${restored2 && restored2.width}`);

/* Media + banner: the media width (264) is the anchor, banner adds 250, and
   closing the banner must return to 264 — not 150 and not 514. */
const win2 = makeWindow();
const island2 = new Island(win2, settings, () => {});
island2.place();
island2.setMedia(true);
win2.calls.length = 0;
island2.setBanner(true);
const mWide = win2.calls[win2.calls.length - 1];
island2.setBanner(false);
const mRestored = win2.calls[win2.calls.length - 1];
check('banner over a playing track widens to 514', mWide && mWide.width === 514, `width=${mWide && mWide.width}`);
check('banner end returns to the 264 media width', mRestored && mRestored.width === 264, `width=${mRestored && mRestored.width}`);

/* ---------------------------------------------------------------- summary */
const failed = results.filter((r) => !r.ok).length;
console.log(`\nBANNER_WIDTH ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
