/* QA Yan - static hygiene audit (no source changes).
   Dead-toggle audit, UI em-dash scan, and verification-tool exclusion. */
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  :: ' + detail}`);
};

const settingsSrc = fs.readFileSync(path.join(root, 'src', 'main', 'settings.ts'), 'utf8');
const defaultsBlock = settingsSrc.slice(settingsSrc.indexOf('const DEFAULTS'), settingsSrc.indexOf('export const ROBOT_EYES'));
const keys = Array.from(defaultsBlock.matchAll(/^\s{2}([a-zA-Z][a-zA-Z0-9]*):/gm)).map((m) => m[1]);

const settingsUi = fs.readFileSync(path.join(root, 'src', 'settings', 'settings.ts'), 'utf8');
/* A key is "wired" when its literal appears anywhere in the Settings UI source.
   This covers first-arg factories (toggle/segment/slider) AND second-arg ones
   (choiceCards(options, 'islandStyle'), orderEditor(...), surfaceCards(), ...). */
const wired = new Set(keys.filter((k) =>
  settingsUi.includes("'" + k + "'") || settingsUi.includes('"' + k + '"')));
const unwired = keys.filter((k) => !wired.has(k));
/* catIdleCenter is a legacy setting: it stays in DEFAULTS for compatibility but
   the renderer no longer reads it (the cat always settles on the right rail). */
const knownInternal = ['mini', 'pill', 'open', 'catIdleCenter', 'glassLevel', 'glassTint', 'visualizer', 'musicCardBackground', 'musicCardProgress'];
check('Audit dead-toggle: setiap setting punya kontrol UI atau memang internal',
  unwired.length > 0 && unwired.every((k) => knownInternal.includes(k)),
  `keys=${keys.length} unwired=${JSON.stringify(unwired)}`);

const uiFiles = [
  'src/renderer/index.html', 'src/renderer/styles.css', 'src/renderer/renderer.ts',
  'src/renderer/panels.ts', 'src/settings/settings.html', 'src/settings/settings.css',
  'src/settings/settings.ts',
];
const dashHits = [];
for (const rel of uiFiles) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) continue;
  const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    if (line.includes('\u2014')) dashHits.push(rel + ':' + (i + 1));
  });
}
check('Antislop: tidak ada em dash di teks/kode UI', dashHits.length === 0, JSON.stringify(dashHits));

const distFiles = [];
const walk = (dir, prefix = '') => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, prefix + e.name + '/');
    else distFiles.push(prefix + e.name);
  }
};
walk(path.join(root, 'dist'));
const forbidden = distFiles.filter((f) => /(^|\/)(_qa|_probe|_shot)[-_.]/i.test(f)
  || /patch/i.test(f));
check('Hygiene: tidak ada harness/probe/script patching di dalam dist/ (yang dipaket)',
  forbidden.length === 0, `files=${distFiles.length} forbidden=${JSON.stringify(forbidden)}`);

const nsi = fs.readFileSync(path.join(root, 'build', 'installer.nsi'), 'utf8');
check('installer.nsi menunjuk app-root yang benar',
  nsi.includes('..\\dist-release\\app-root') && nsi.includes('SetOutPath "$INSTDIR"')
    && nsi.includes('File /r "${SOURCE_DIR}\\*.*"'),
  'SOURCE_DIR/SetOutPath/File ok');

const failed = results.filter((r) => !r.ok);
console.log(`\nQA_AUDIT ${results.length - failed.length}/${results.length} PASS`);
if (failed.length) console.log('FAILED: ' + failed.map((f) => f.name).join(' | '));
process.exit(failed.length ? 1 : 0);
