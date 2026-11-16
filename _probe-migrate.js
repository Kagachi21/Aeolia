/* QA Yan - does the notch-size migration actually reach the user's machine?
 * (throwaway probe, NOT product)
 *
 * The user's real settings.json still says mini {112,26}. This probe copies it
 * VERBATIM into temp userData dirs, runs the REAL compiled loader
 * (dist/main/settings.js) against each copy, and reports what the app would
 * read on that machine. Only electron's app.getPath is mocked; the merge,
 * the legacy list and the clamping are the shipped code.
 *
 * Cases: user file as-is (legacy 112x26), the older 150x32 default, the
 * current 64x14, a genuine custom 80x20, and no file at all.
 *
 * Run: node _probe-migrate.js
 */
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const root = __dirname;
const USER_DATA = path.join(process.env.APPDATA || '', 'Aeolia Island');
const userFile = path.join(USER_DATA, 'settings.json');

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  :: ' + detail}`);
};

/* ---- electron mock: app.getPath for settings.js, screen for bounds.js ---- */
let userDataDir = '';
const primaryDisplay = {
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
};
const electronMock = {
  app: { getPath: (name) => (name === 'userData' ? userDataDir : os.tmpdir()) },
  screen: {
    getPrimaryDisplay: () => primaryDisplay,
    getDisplayNearestPoint: () => primaryDisplay,
    getCursorScreenPoint: () => ({ x: 960, y: 5 }),
  },
};
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronMock;
  return originalLoad.call(this, request, parent, isMain);
};

const temps = [];
function freshUserData(raw) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aeolia-migrate-'));
  temps.push(dir);
  userDataDir = dir;
  if (raw !== undefined) fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(raw, null, 2), 'utf8');
  delete require.cache[require.resolve('./dist/main/settings.js')];
  return require('./dist/main/settings.js');
}

const size = (s) => `${s.mini.width}x${s.mini.height}`;

/* ---- 1. the user's real file, copied verbatim ---- */
const realRaw = JSON.parse(fs.readFileSync(userFile, 'utf8'));
const fromReal = freshUserData(realRaw).loadSettings();
console.log(`user file mini ${JSON.stringify(realRaw.mini)} -> loadSettings mini ${JSON.stringify(fromReal.mini)}`);
check('migrasi: settings.json user (112x26) terbaca 64x14',
  fromReal.mini.width === 64 && fromReal.mini.height === 14, size(fromReal));
check('migrasi tidak merusak setting user lain (cardWidth 420, islandStyle, edgeMargin)',
  fromReal.cardWidth === (realRaw.cardWidth ?? fromReal.cardWidth)
    && fromReal.islandStyle === (realRaw.islandStyle ?? fromReal.islandStyle)
    && fromReal.edgeMargin === (realRaw.edgeMargin ?? fromReal.edgeMargin),
  JSON.stringify({ cardWidth: fromReal.cardWidth, islandStyle: fromReal.islandStyle, edgeMargin: fromReal.edgeMargin }));

/* ---- 2. older default 150x32 ---- */
const older = freshUserData({ ...realRaw, mini: { width: 150, height: 32 } }).loadSettings();
check('migrasi: default lama 150x32 juga terbaca 64x14', size(older) === '64x14', size(older));

/* ---- 3. genuine custom size must NOT be reset ---- */
const custom = freshUserData({ ...realRaw, mini: { width: 80, height: 20 } }).loadSettings();
check('80x20 (bukan default lama) TIDAK di-reset', size(custom) === '80x20', size(custom));
const custom2 = freshUserData({ ...realRaw, mini: { width: 120, height: 18 } }).loadSettings();
check('120x18 (bukan default lama) TIDAK di-reset', size(custom2) === '120x18', size(custom2));

/* ---- 4. already-migrated file stays put ---- */
const already = freshUserData({ ...realRaw, mini: { width: 64, height: 14 } }).loadSettings();
check('file yang sudah 64x14 tetap 64x14 (idempoten)', size(already) === '64x14', size(already));

/* ---- 5. no file at all -> defaults ---- */
const fresh = freshUserData(undefined).loadSettings();
check('tanpa settings.json: default baru 64x14', size(fresh) === '64x14', size(fresh));

/* ---- 6. what the window geometry becomes from those settings ---- */
const { boundsFor } = require('./dist/main/bounds.js');
const boundsReal = boundsFor('mini', { ...fromReal, islandStyle: 'dynamic' });
const boundsCustom = boundsFor('mini', { ...custom, islandStyle: 'dynamic' });
check('boundsFor mini dari settings user (migrasi) = 64x14',
  boundsReal.width === 64 && boundsReal.height === 14, `${boundsReal.width}x${boundsReal.height}`);
check('boundsFor mini untuk 80x20 tetap 80x20',
  boundsCustom.width === 80 && boundsCustom.height === 20, `${boundsCustom.width}x${boundsCustom.height}`);

for (const dir of temps) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}
const failed = results.filter((r) => !r.ok);
console.log(`\nPROBE_MIGRATE ${results.length - failed.length}/${results.length} PASS`);
if (failed.length) console.log('FAILED: ' + failed.map((f) => f.name).join(' | '));
process.exit(failed.length ? 1 : 0);
