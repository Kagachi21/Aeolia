/* QA Yan - settings module probe (independent of Kou's probes).
   Exercises the COMPILED dist/main/settings.js against a mocked electron app,
   with a fresh module instance per case so merge() really re-reads the file.
   Run: node _qa-settings.js
*/
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aeolia-qa-settings-'));
const settingsFile = path.join(tmp, 'settings.json');
const modulePath = path.join(__dirname, 'dist', 'main', 'settings.js');

const electronMock = {
  app: { getPath: () => tmp, setPath: () => {} },
};
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronMock;
  return originalLoad.call(this, request, parent, isMain);
};

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  :: ' + detail}`);
};

function fresh(raw) {
  fs.writeFileSync(settingsFile, JSON.stringify(raw, null, 2), 'utf8');
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

function freshMissing() {
  if (fs.existsSync(settingsFile)) fs.unlinkSync(settingsFile);
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

/* ---- merge(): empty list must survive a disk round-trip ---- */
check('merge() keeps an explicit empty visibleTabs from disk',
  JSON.stringify(fresh({ visibleTabs: [] }).loadSettings().visibleTabs) === '[]',
  JSON.stringify(fresh({ visibleTabs: [] }).loadSettings().visibleTabs));

/* ---- merge(): token whitelist + de-dup ---- */
const mixed = fresh({ visibleTabs: ['web', '__evil__', 42, 'notifications', null, 'web', 'deck'] })
  .loadSettings().visibleTabs;
check('merge() drops foreign/non-string tokens and de-dups',
  JSON.stringify(mixed) === '["web","notifications","deck"]', JSON.stringify(mixed));

/* ---- merge(): malformed / missing values ---- */
for (const [label, raw] of [
  ['string', { visibleTabs: 'oops' }],
  ['null', { visibleTabs: null }],
  ['object', { visibleTabs: { 0: 'web' } }],
]) {
  const list = fresh(raw).loadSettings().visibleTabs;
  check(`merge() with ${label} visibleTabs falls back to a valid default list`,
    Array.isArray(list) && list.length > 0 && list.every((t) => typeof t === 'string' && !t.startsWith('__')),
    JSON.stringify(list));
}
const missing = freshMissing().loadSettings().visibleTabs;
check('merge() with missing visibleTabs falls back to a valid default list',
  Array.isArray(missing) && missing.length > 0, JSON.stringify(missing));
console.log('QA_NOTE fallback_default_tabs=' + missing.length + ' :: ' + JSON.stringify(missing));

/* ---- setValue(): runtime writes bypass merge() but must keep the whitelist ---- */
const s = fresh({ visibleTabs: ['web', 'music'] });
check('setValue() persists an empty array (0 tabs is a legal choice)',
  JSON.stringify(s.setValue('visibleTabs', []).visibleTabs) === '[]'
  && JSON.stringify(JSON.parse(fs.readFileSync(settingsFile, 'utf8')).visibleTabs) === '[]');
const filtered = s.setValue('visibleTabs', ['web', '__evil__', 7, 'music', 'web']).visibleTabs;
check('setValue() applies the same token whitelist as merge()',
  JSON.stringify(filtered) === '["web","music"]', JSON.stringify(filtered));
check('setValue() with a non-array leaves the list intact (no crash / no wipe)',
  JSON.stringify(s.setValue('visibleTabs', 'garbage').visibleTabs) === '["web","music"]');
check('setValue() with null leaves the list intact',
  JSON.stringify(s.setValue('visibleTabs', null).visibleTabs) === '["web","music"]');

/* ---- unrelated clamps still work (regression) ---- */
const clamp = fresh({
  edgeMargin: 999, islandStyle: 'bogus', islandPosition: 'up',
  cardWidth: 9999, barOrder: ['mic', 'mic', 'nope', 'clock'],
}).loadSettings();
check('merge() clamps edgeMargin to 40', clamp.edgeMargin === 40, String(clamp.edgeMargin));
check('merge() rejects unknown islandStyle', clamp.islandStyle === 'dynamic', clamp.islandStyle);
check('merge() clamps cardWidth to 520', clamp.cardWidth === 520, String(clamp.cardWidth));
check('merge() completes barOrder into a de-duped permutation',
  clamp.barOrder.length === 5 && new Set(clamp.barOrder).size === 5, JSON.stringify(clamp.barOrder));

const failed = results.filter((r) => !r.ok);
console.log(`\nQA_SETTINGS ${results.length - failed.length}/${results.length} PASS`);
if (failed.length) console.log('FAILED: ' + failed.map((f) => f.name).join(' | '));
process.exit(failed.length ? 1 : 0);
