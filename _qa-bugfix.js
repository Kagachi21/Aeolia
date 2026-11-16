/* QA Kou - regression probe for the 5 reported "ga berfungsi banget" bugs.
   Pure static + compiled-pure-function checks; no Electron, no user data.
   Run: node _qa-bugfix.js   (after `npm run build`) */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');

const root = __dirname;
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  :: ' + detail}`);
};
const read = (rel) => {
  try { return fs.readFileSync(path.join(root, rel), 'utf8'); }
  catch { return ''; }
};
const load = (rel) => {
  try { return require(path.join(root, rel)); }
  catch (e) { return { __error: String(e && e.message || e) }; }
};

const html = read('src/renderer/index.html');
const css = read('src/renderer/styles.css');
const renderer = read('src/renderer/renderer.ts');
const main = read('src/main/main.ts');
const extrasSrc = read('src/main/extras.ts');
const SUN_RAYS = 'M12 3v2M12 19v2';
const GEAR = 'data-icon="gear"';

/* ---------------------------------------------------------------- Issue 1 */
check('Bug1 settings tab memakai ikon GEAR (bukan sun)',
  html.includes(GEAR) && !html.includes(SUN_RAYS),
  `gear=${html.includes(GEAR)} sun=${html.includes(SUN_RAYS)}`);
check('Bug1 ikon Settings di grid All panels juga gear',
  renderer.includes(GEAR) && !renderer.includes(SUN_RAYS),
  `gear=${renderer.includes(GEAR)} sun=${renderer.includes(SUN_RAYS)}`);
check('Bug1 tidak ada jalur mati activate("settings")',
  /function activate\([\s\S]{0,220}tab === 'settings'/.test(renderer),
  'activate() harus membuka jendela Settings juga');

/* ---------------------------------------------------------------- Issue 2 */
const extras = load('dist/main/extras.js');
const capture = load('dist/main/captureSessions.js');
const hasSelect = typeof extras.selectMeetingApp === 'function';
check('Bug2 selectMeetingApp murni tersedia (sinyal audio + judul)', hasSelect,
  extras.__error || (hasSelect ? 'ok' : 'missing export'));
check('Bug2 helper sesi capture tersedia & parse murni',
  typeof capture.parseCaptureSessions === 'function'
  && typeof capture.setCaptureExecutor === 'function'
  && typeof capture.getActiveCaptureProcesses === 'function',
  capture.__error || 'captureSessions exports ok');
if (typeof capture.parseCaptureSessions === 'function') {
  const parsed = capture.parseCaptureSessions(
    'pid=111|name=Discord.exe|state=1\npid=222|name=audiodg|state=2\npid=333|name=ms-teams|state=1\nerror=BOGUS');
  check('Bug2 parseCaptureSessions hanya sesi ACTIVE, lowercase, unik',
    JSON.stringify(parsed) === JSON.stringify(['discord', 'ms-teams']), JSON.stringify(parsed));
}
if (hasSelect) {
  const t = (process, title) => ({ process, title });
  const chat = [t('discord.exe', 'Discord | #general | Wibverse')];
  check('Bug2 Discord voice (tanpa kata call di judul) terdeteksi lewat sesi capture',
    extras.selectMeetingApp(chat, ['discord.exe'], true, []) === 'discord',
    extras.selectMeetingApp(chat, ['discord.exe'], true, []));
  check('Bug2 chat Discord TANPA sesi capture TIDAK memicu rapat',
    extras.selectMeetingApp(chat, [], true, []) === '',
    extras.selectMeetingApp(chat, [], true, []));
  check('Bug2 Zoom/Teams lewat judul tetap terdeteksi',
    extras.selectMeetingApp([t('zoom.exe', 'Zoom Meeting 12345')], [], true, []) === 'zoom');
  check('Bug2 meetingIgnoreApps bekerja untuk app hasil deteksi audio',
    extras.selectMeetingApp([], ['discord.exe'], true, ['discord']) === '');
  check('Bug2 meetingAuto=false mematikan kedua sinyal',
    extras.selectMeetingApp(chat, ['discord.exe'], false, []) === '');
  check('Bug2 proses audio sistem (audiodg) tidak jadi false positive',
    extras.selectMeetingApp([], ['audiodg.exe'], true, []) === '');
  check('Bug2 kontrak matchesCall lama tidak berubah',
    extras.matchesCall('Discord | Wibverse 3.0') === false
    && extras.matchesCall('Discord | Voice Call') === true
    && extras.matchesCall('Zoom Meeting 12345') === true
    && extras.matchesCall('WhatsApp — Panggilan video') === true);
}
check('Bug2 main menanamkan captureProbe ke registerExtras',
  main.includes('captureProbe') && extrasSrc.includes('captureProbe'),
  `main=${main.includes('captureProbe')} extras=${extrasSrc.includes('captureProbe')}`);
check('Bug2 enumerasi Windows gagal tidak pernah melempar (graceful)',
  /try \{[\s\S]{0,600}catch/.test(read('src/main/captureSessions.ts'))
  && /catch/.test(extrasSrc),
  'helper + pollMeeting membungkus kegagalan COM');

/* ---------------------------------------------------------------- Issue 3 */
const bounds = load('dist/main/bounds.js');
check('Bug3 micStripRect + pointInRect murni tersedia',
  typeof bounds.micStripRect === 'function' && typeof bounds.pointInRect === 'function',
  bounds.__error || 'bounds exports ok');
if (typeof bounds.micStripRect === 'function') {
  const st = { islandScale: 100, islandPosition: 'center', monitor: 'main', edgeMargin: 4 };
  const b = { x: 100, y: 10, width: 322, height: 36 };
  const r = bounds.micStripRect(b, st, true);
  check('Bug3 strip kapsul = MIC_PILL_EXTRA px di sisi kanan jendela (center)',
    r && r.x === 100 + 322 - bounds.MIC_PILL_EXTRA && r.width === bounds.MIC_PILL_EXTRA,
    JSON.stringify(r));
  const rr = bounds.micStripRect(b, { ...st, islandPosition: 'right' }, true);
  check('Bug3 strip kapsul berpindah ke kiri untuk island kanan',
    rr && rr.x === 100, JSON.stringify(rr));
  check('Bug3 tidak ada strip saat kapsul nonaktif', bounds.micStripRect(b, st, false) === null);
  check('Bug3 pointInRect menolak titik di luar strip',
    bounds.pointInRect({ x: 150, y: 20 }, r) === false
    && bounds.pointInRect({ x: 100 + 322 - 10, y: 20 }, r) === true);
}
check('Bug3 main menekan hover-open saat kursor di strip kapsul',
  main.includes('micStripRect(') && main.includes('micHot')
  && main.includes('cancelHover()'), 'pollHoverZone harus skip strip + cancel hover timer');
check('Bug3 renderer melaporkan mic-enter/mic-leave',
  renderer.includes("'mic-enter'") && renderer.includes("'mic-leave'"),
  'hover kapsul harus mematikan armHover lewat IPC');
check('Bug3 kapsul tetap pointer-events:auto',
  /#micPill \.meeting-mic,\s*#micPill \.meeting-cam \{ pointer-events: auto; \}/.test(css),
  'CSS hit-area kapsul');

/* ---------------------------------------------------------------- Issue 4 */
check('Bug4 markup TIDAK memaksa greeting aktif sebelum setting dibaca',
  /id="island"[^>]*data-greeting="false"/.test(html),
  'data-greeting harus false di HTML');
check('Bug4 greeting dijaga sekali jalan & menghormati catGreeting',
  renderer.includes('greetingArmed') && renderer.includes('catGreeting !== false'),
  'harus ada guard replay + baca setting');
check('Bug4 kucing tidak menelan input (pointer-events:none)',
  /\.cat-slot \{[^}]*pointer-events: none/s.test(css),
  'cat-slot tidak boleh jadi target klik');

/* ------------------------------------------- Issue 4b: first run only */
/* The shipped design moved the one-shot flag to the persisted card store
   (state.json) as `greetingSeen`: the renderer decides once, consumes it with
   window.api.patch(), and the store migrates existing installs. These checks
   assert THAT contract (the earlier settings.ts/greeting:shown design was
   abandoned before delivery). */
const storeSrc = read('src/main/store.ts');
check('FirstRun flag greetingSeen ada di store + default false + migrasi state.json lama',
  storeSrc.includes('greetingSeen') && /greetingSeen: false/.test(storeSrc)
  && storeSrc.includes("typeof raw.greetingSeen === 'boolean' ? raw.greetingSeen : true")
  && storeSrc.includes("if (typeof raw.greetingSeen !== 'boolean') persist();"),
  'store.ts');
check('FirstRun renderer memakai state.greetingSeen + patch sekali',
  renderer.includes('greetingSeen') && renderer.includes('window.api.patch({ greetingSeen: true })')
  && renderer.includes('greetingPlayable = state.greetingSeen !== true')
  && renderer.includes('catGreetingEnabled'), 'renderer.ts');
check('FirstRun flag dikonsumsi walau catGreeting=false (tidak bisa diputar ulang)',
  /greetingDecisionMade = true;[\s\S]{0,260}if \(greetingPlayable\)/.test(renderer), 'renderer.ts');

/** Load a FRESH compiled store module against a temporary userData dir. */
function storeAt(dir) {
  const p = path.join(root, 'dist', 'main', 'store.js');
  delete require.cache[require.resolve(p)];
  const original = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return { app: { getPath: () => dir, setPath: () => {} } };
    return original.call(this, request, parent, isMain);
  };
  try { return require(p); }
  finally { Module._load = original; }
}
const readGreeting = (file) => JSON.parse(fs.readFileSync(file, 'utf8')).greetingSeen;

const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aeolia-fresh-'));
const freshFile = path.join(freshDir, 'state.json');
let freshVal = null;
try { freshVal = storeAt(freshDir).load().greetingSeen; } catch (e) { freshVal = 'error: ' + String(e); }
check('FirstRun (a) install BARU: greetingSeen=false dan ditulis ke disk',
  freshVal === false && readGreeting(freshFile) === false, JSON.stringify({ freshVal, onDisk: fs.existsSync(freshFile) }));

let persisted = null;
try {
  const mod = storeAt(freshDir);
  mod.load();
  mod.patch({ greetingSeen: true });
  persisted = readGreeting(freshFile);
} catch (e) { persisted = 'error: ' + String(e); }
check('FirstRun (b) patch(greetingSeen,true) bertahan di disk', persisted === true, JSON.stringify(persisted));
let reloaded = null;
try { reloaded = storeAt(freshDir).load().greetingSeen; } catch (e) { reloaded = 'error: ' + String(e); }
check('FirstRun (b) restart berikutnya membaca greetingSeen=true', reloaded === true, JSON.stringify(reloaded));

const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aeolia-legacy-'));
const legacyFile = path.join(legacyDir, 'state.json');
fs.writeFileSync(legacyFile, JSON.stringify({ lastTab: 'web', clips: [], notices: [], sites: [], shelf: [], tasks: [] }));
let legacyVal = null;
try { legacyVal = storeAt(legacyDir).load().greetingSeen; } catch (e) { legacyVal = 'error: ' + String(e); }
check('FirstRun (c) state.json LAMA tanpa flag -> dianggap sudah menyapa',
  legacyVal === true && readGreeting(legacyFile) === true, JSON.stringify({ legacyVal }));

const explicitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aeolia-explicit-'));
const explicitFile = path.join(explicitDir, 'state.json');
fs.writeFileSync(explicitFile, JSON.stringify({ greetingSeen: false }));
let explicitVal = null;
try { explicitVal = storeAt(explicitDir).load().greetingSeen; } catch (e) { explicitVal = String(e); }
check('FirstRun greetingSeen eksplisit false tidak ditimpa migrasi',
  explicitVal === false, JSON.stringify(explicitVal));

/* ---------------------------------------------------------------- Issue 5 */
check('Bug5 layer efek kaca ada di markup',
  html.includes('glass-fx') && html.includes('glass-fx__refract')
  && html.includes('glass-fx__dispersion') && html.includes('glass-fx__fresnel')
  && html.includes('glass-fx__glare'), '4 lapis efek');
check('Bug5 CSS: refraction, dispersi kromatik, Fresnel, glare',
  css.includes('.glass-fx__refract') && css.includes('.glass-fx__dispersion')
  && css.includes('.glass-fx__fresnel') && css.includes('.glass-fx__glare')
  && css.includes('mask-composite') && css.includes('mix-blend-mode')
  && css.includes('conic-gradient'), 'semua teknik harus ada');
check('Bug5 morph halus pill -> kartu + fallback ke kaca gelap',
  css.includes('transition: border-radius') && css.includes('data-glass-fx="off"')
  && renderer.includes('applyGlassFxSupport'), 'transisi + fallback');
check('Bug5 dasar gelap stabil & --glass-a masih dipakai',
  css.includes('rgba(20, 28, 24') && css.includes('var(--glass-a'), 'kontras dasar');
const stolenCode = /LiquidGlassView|LiquidLensView|LiquidGlassSlider|LiquidGlassSwitch|CABackdropLayer|IOSurface|SwiftUI|ZeroCopyBridge|import UIKit|MTLDevice/i;
const swiftFiles = fs.existsSync(path.join(root, 'src'))
  ? fs.readdirSync(path.join(root, 'src'), { recursive: true })
    .filter((f) => /\.(swift|metal|m|mm)$/i.test(String(f))) : [];
check('Bug5 TIDAK ada kode Swift/Metal/IOSurface dari LiquidGlassKit',
  !stolenCode.test(html + css + renderer) && swiftFiles.length === 0,
  `code=${stolenCode.test(html + css + renderer)} nativeFiles=${JSON.stringify(swiftFiles)}`);
check('Bug5 tidak ada dependensi npm baru',
  !/puppeteer|gl-matrix|three|regl/i.test(read('package.json')),
  'package.json tidak berubah');

/* ---------------------------------------------------------------- App icon */
/* The shipped icon was a robot; it must be the cat mascot, and the ICO must
   use DIB frames because NSIS' MUI_ICON rejects PNG-compressed entries. */
const icoPath = path.join(root, 'build', 'appicon.ico');
let icoOk = false;
let icoDetail = 'missing';
try {
  const ico = fs.readFileSync(icoPath);
  const frames = ico.readUInt16LE(4);
  const firstOffset = ico.readUInt32LE(6 + 12);
  icoOk = ico.readUInt16LE(2) === 1 && frames >= 5 && ico.readUInt32LE(firstOffset) === 40;
  icoDetail = JSON.stringify({ type: ico.readUInt16LE(2), frames, dib: ico.readUInt32LE(firstOffset) });
} catch (e) { icoDetail = String(e); }
check('App icon: ICO multi-size DIB (siap rcedit + NSIS)', icoOk, icoDetail);
check('App icon: generator kucing ada & build/appicon.png 512',
  fs.existsSync(path.join(root, 'scripts', 'make-icon.py'))
  && fs.existsSync(path.join(root, 'build', 'appicon.png')),
  'make-icon.py + appicon.png');

const failed = results.filter((r) => !r.ok);
console.log(`\nQA_BUGFIX ${results.length - failed.length}/${results.length} PASS`);
if (failed.length) console.log('FAILED: ' + failed.map((f) => f.name).join(' | '));
process.exit(failed.length ? 1 : 0);
