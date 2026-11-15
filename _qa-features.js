/* QA probe for the 1.2.5 feature batch: island scale, new setting validation,
   and the notice:open protocol map. Runs compiled dist code against a mocked
   electron surface. No user data is touched (temp userData only).
   Run: node _qa-features.js  */
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aeolia-qa-feat-'));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  :: ' + detail}`);
};

/* ------------------------------------------------------------ electron mock */
let primaryDisplay = {
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
};
const ipcOn = new Map();
const ipcHandle = new Map();
const externalOpens = [];
const mediaKeys = [];
const wcSends = [];

const electronMock = {
  app: {
    requestSingleInstanceLock: () => true,
    on: () => {}, quit: () => {}, focus: () => {},
    whenReady: () => Promise.resolve(),
    setPath: () => {},
    getPath: () => tmp,
    setLoginItemSettings: () => {},
  },
  BrowserWindow: class {
    constructor(options) {
      this.options = options || {};
      this._bounds = {
        x: Math.round(this.options.x ?? 0), y: Math.round(this.options.y ?? 0),
        width: Math.round(this.options.width ?? 100), height: Math.round(this.options.height ?? 30),
      };
      this.webContents = { send: (ch, payload) => wcSends.push({ ch, payload }), once: () => {}, on: () => {}, executeJavaScript: () => Promise.resolve(null) };
      this.destroyed = false;
    }
    setMinimumSize() {} setMaximumSize() {} setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {}
    setContentProtection() {}
    setBounds(b) { this._bounds = { ...b }; }
    getBounds() { return { ...this._bounds }; }
    setIgnoreMouseEvents() {}
    isDestroyed() { return this.destroyed; }
    show() {} showInactive() {} hide() {} focus() {} loadFile() {} close() { this.destroyed = true; }
    once() {} on() {}
  },
  clipboard: { readText: () => Promise.resolve(''), writeText: () => {}, write: () => {} },
  globalShortcut: { unregisterAll: () => {}, register: () => {} },
  ipcMain: {
    on: (channel, fn) => ipcOn.set(channel, fn),
    handle: (channel, fn) => ipcHandle.set(channel, fn),
  },
  powerMonitor: { getSystemIdleTime: () => 0, on: () => {} },
  screen: {
    getPrimaryDisplay: () => primaryDisplay,
    getDisplayNearestPoint: () => primaryDisplay,
    getCursorScreenPoint: () => ({ x: 960, y: 5 }),
  },
  shell: { openExternal: (url) => { externalOpens.push(url); } },
  dialog: { showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }) },
  _wcSends: wcSends,
  net: { fetch: () => Promise.reject(new Error('offline in probe')) },
  desktopCapturer: { getSources: () => Promise.resolve([]) },
  session: { fromPartition: () => ({}) },
};

const stubs = {
  activeWindow: { getActiveWindow: () => ({ process: 'explorer', title: 'QA', maximized: false, fullscreen: false, rect: { x: 0, y: 0, width: 1920, height: 1080 } }), isBusyProcess: () => false },
  thinFrame: { dropThickFrame: () => {} },
  media: { readMedia: () => ({ playing: false, title: '' }) },
  power: { readPower: () => ({ percent: 80, charging: false }) },
  keys: {
    mediaPlayPause: () => mediaKeys.push('playpause'),
    mediaPrev: () => mediaKeys.push('prev'),
    mediaNext: () => mediaKeys.push('next'),
  },
  systemControl: {
    brightnessRange: () => ({ supported: false, min: 0, max: 100, current: 0 }),
    setBrightness: () => false,
    pasteShortcut: () => {}, toggleMute: () => {}, volumeStep: () => {},
  },
  ramClean: {
    cpuPercent: () => 12,
    memoryInfo: () => ({ usedMb: 8192, totalMb: 16384, percent: 50 }),
    cleanRam: () => ({ freedMb: 1, trimmed: 2, denied: 0 }),
  },
  capture: { registerCapture: () => {}, disposeCapture: () => {} },
  extras: {
    disposeExtras: () => {},
    getExtras: () => ({ meeting: false, meetingApp: '', online: true, weather: null, weatherError: '', calendarEvents: [], calendarError: '', lastDownload: '', resumeOffer: false }),
    isMeeting: () => false, openPath: () => {},
    pickFile: () => Promise.resolve(''), pickFolder: () => Promise.resolve(''),
    registerExtras: () => {}, shouldHoldNotice: () => false, dismissResumeOffer: () => {},
  },
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronMock;
  if (typeof request === 'string' && request.startsWith('./')) {
    const key = path.basename(request, '.js');
    if (Object.prototype.hasOwnProperty.call(stubs, key)) return stubs[key];
  }
  return originalLoad.call(this, request, parent, isMain);
};

/* ------------------------------------------------------------------ tests */
(async () => {
  const settingsPath = path.join(tmp, 'settings.json');
  /* loadSettings() caches, so every disk-level scenario re-imports the module
     fresh - the same thing that happens on a real app start. */
  const freshSettings = () => {
    delete require.cache[require.resolve('./dist/main/settings.js')];
    return require('./dist/main/settings.js');
  };
  const write = (raw) => {
    fs.writeFileSync(settingsPath, JSON.stringify(raw), 'utf8');
  };

  /* --- islandScale validation: free steps, clamped 75..130 --- */
  write({ islandScale: 108 });
  check('islandScale 108 (langkah bebas dari slider) diterima', freshSettings().loadSettings().islandScale === 108);
  write({ islandScale: 130 });
  check('islandScale 130 diterima', freshSettings().loadSettings().islandScale === 130);
  write({ islandScale: 140 });
  check('islandScale 140 di-clamp ke 130', freshSettings().loadSettings().islandScale === 130);
  write({ islandScale: 0 });
  check('islandScale 0 di-clamp ke 75', freshSettings().loadSettings().islandScale === 75);
  write({ islandScale: 85 });
  check('migrasi langkah lama: 85 -> 90', freshSettings().loadSettings().islandScale === 90);
  write({ islandScale: 120 });
  check('migrasi langkah lama: 120 -> 115', freshSettings().loadSettings().islandScale === 115);
  write({ islandScale: 'auto' });
  check('islandScale "auto" diterima apa adanya', freshSettings().loadSettings().islandScale === 'auto');
  write({ islandScale: 'besar' });
  check('islandScale non-angka jatuh ke default (Auto)', freshSettings().loadSettings().islandScale === 'auto');

  /* --- glassLevel (kekentalan tema kaca) --- */
  write({});
  const gl = freshSettings().loadSettings();
  check('glassLevel default 55', gl.glassLevel === 55);
  write({ glassLevel: 5 });
  check('glassLevel 5 di-clamp ke 20 (teks tetap terbaca)', freshSettings().loadSettings().glassLevel === 20);
  write({ glassLevel: 99 });
  check('glassLevel 99 di-clamp ke 90 (tidak jadi solid penuh)', freshSettings().loadSettings().glassLevel === 90);
  write({ glassLevel: 'tebal' });
  check('glassLevel non-angka kembali default 55', freshSettings().loadSettings().glassLevel === 55);

  /* --- small notch default sizes + old-default migration --- */
  check('default mini notch kecil: 112x26 (tidak menutupi tab browser)',
    gl.mini.width === 112 && gl.mini.height === 26, JSON.stringify(gl.mini));
  check('default pill ikut Dynamic Island: 150x36', gl.pill.width === 150 && gl.pill.height === 36,
    JSON.stringify(gl.pill));
  write({ mini: { width: 64, height: 14 }, pill: { width: 138, height: 28 } });
  const mig = freshSettings().loadSettings();
  check('migrasi: mini default lama 64x14 -> 112x26', mig.mini.width === 112 && mig.mini.height === 26,
    JSON.stringify(mig.mini));
  write({ mini: { width: 150, height: 32 }, pill: { width: 138, height: 28 } });
  const migBig = freshSettings().loadSettings();
  check('migrasi: mini default 150x32 (build batch B) -> 112x26',
    migBig.mini.width === 112 && migBig.mini.height === 26, JSON.stringify(migBig.mini));
  check('migrasi: pill default lama 138 -> 150', mig.pill.width === 150, JSON.stringify(mig.pill));
  write({ mini: { width: 200, height: 40 }, pill: { width: 160, height: 28 } });
  const kept = freshSettings().loadSettings();
  check('ukuran kustom tidak disentuh migrasi', kept.mini.width === 200 && kept.pill.width === 160,
    JSON.stringify({ m: kept.mini, p: kept.pill }));

  /* --- new boolean / enum defaults --- */
  write({});
  const s = freshSettings().loadSettings();
  check('pillLyrics default false', s.pillLyrics === false);
  check('noticeOpenLinks default true', s.noticeOpenLinks === true);
  check('visualizer default pixels', s.visualizer === 'pixels');
  check('musicCardBackground default album', s.musicCardBackground === 'album');
  check('musicCardProgress default Wave', s.musicCardProgress === 'Wave');
  check('meetingAuto default true (mic pill Discord/Zoom langsung muncul)', s.meetingAuto === true);
  check('islandScale default Auto', s.islandScale === 'auto');

  write({ visualizer: 'blobs', musicCardProgress: 'Rainbow', musicCardBackground: 'photo' });
  const s2 = freshSettings().loadSettings();
  check('enum invalid: visualizer/pattern/background kembali default',
    s2.visualizer === 'pixels' && s2.musicCardProgress === 'Wave' && s2.musicCardBackground === 'album',
    JSON.stringify({ v: s2.visualizer, p: s2.musicCardProgress, b: s2.musicCardBackground }));

  /* --- legacy meetingAuto migration --- */
  write({ meetingAuto: false });
  check('migrasi: meetingAuto false lama (inert) dinaikkan ke true',
    freshSettings().loadSettings().meetingAuto === true);
  write({ meetingAuto: false, islandScale: 115 });
  check('migrasi tidak menyentuh build baru (islandScale sudah ada)',
    freshSettings().loadSettings().meetingAuto === false);

  /* --- bounds: island scale --- */
  const { boundsFor, effectiveScalePct } = require('./dist/main/bounds.js');
  const base = { cardWidth: 360, edgeMargin: 4, islandPosition: 'center', monitor: 'main', islandStyle: 'dynamic' };
  const sizes = { pill: { width: 150, height: 36 }, mini: { width: 140, height: 30 }, open: { width: 360, height: 200 } };
  write({ ...base, islandScale: 100, ...sizes });
  const basePill = boundsFor('pill', freshSettings().loadSettings());
  const baseOpen = boundsFor('open', freshSettings().loadSettings());
  const baseMini = boundsFor('mini', freshSettings().loadSettings());
  write({ ...base, islandScale: 130, ...sizes });
  const bigPill = boundsFor('pill', freshSettings().loadSettings());
  const bigOpen = boundsFor('open', freshSettings().loadSettings());
  const bigMini = boundsFor('mini', freshSettings().loadSettings());
  check('scale 130: pill melebar 150 -> 195 (150 x 1,3)', bigPill.width === Math.round(150 * 1.3),
    `${basePill.width} -> ${bigPill.width}`);
  check('scale 130: kartu melebar 360 -> 468', bigOpen.width === Math.round(360 * 1.3),
    `${baseOpen.width} -> ${bigOpen.width}`);
  check('scale 130: notch mini ikut membesar 140x30 -> 182x39 (font & kucing ikut skala)',
    bigMini.width === Math.round(140 * 1.3) && bigMini.height === Math.round(30 * 1.3),
    `${bigMini.width}x${bigMini.height}`);
  write({ ...base, islandScale: 75, ...sizes });
  const smallPill = boundsFor('pill', freshSettings().loadSettings());
  check('scale 75: pill menyusut 150 -> 113', smallPill.width === Math.round(150 * 0.75), smallPill.width);

  /* --- auto resolves against the display width --- */
  write({ ...base, islandScale: 'auto', ...sizes });
  primaryDisplay.bounds.width = 1920;
  const auto1920 = freshSettings().loadSettings();
  check('auto di layar 1920 -> 100%', effectiveScalePct(auto1920) === 100 && boundsFor('pill', auto1920).width === 150,
    effectiveScalePct(auto1920));
  primaryDisplay.bounds.width = 2304;
  const auto2304 = freshSettings().loadSettings();
  check('auto di layar 2304 -> 120% ... di-clamp ke 130/75 batas? tidak: 2304/1920=120%',
    effectiveScalePct(auto2304) === 120, effectiveScalePct(auto2304));
  primaryDisplay.bounds.width = 3840;
  const auto4k = freshSettings().loadSettings();
  check('auto di layar 4K di-clamp ke 130%', effectiveScalePct(auto4k) === 130, effectiveScalePct(auto4k));
  primaryDisplay.bounds.width = 1280;
  const autoSmall = freshSettings().loadSettings();
  check('auto di layar 1280 -> 75% (clamp bawah)', effectiveScalePct(autoSmall) === 75, effectiveScalePct(autoSmall));
  primaryDisplay.bounds.width = 1920;

  /* --- media pill width scales too --- */
  write({ ...base, islandScale: 130, ...sizes });
  const mediaPill = boundsFor('pill', freshSettings().loadSettings(), undefined, 264);
  check('media pill 264 ikut diskalakan -> 343', mediaPill.width === Math.round(264 * 1.3), mediaPill.width);

  /* --- mic pill reserves room beside the island (pill state only) --- */
  const micPill = boundsFor('pill', freshSettings().loadSettings(), undefined, undefined, 86);
  check('micExtra 86 melebar pil 150 -> 236 (150+86, diskalakan)',
    micPill.width === Math.round((150 + 86) * 1.3), micPill.width);
  const micOpen = boundsFor('open', freshSettings().loadSettings(), 200, undefined, 86);
  check('micExtra tidak mengubah kartu terbuka', micOpen.width === Math.round(360 * 1.3), micOpen.width);
  const micMini = boundsFor('mini', freshSettings().loadSettings(), undefined, undefined, 86);
  check('micExtra tidak mengubah notch mini (hanya diskalakan)',
    micMini.width === Math.round(140 * 1.3) && micMini.height === Math.round(30 * 1.3),
    `${micMini.width}x${micMini.height}`);

  /* --- banner extra width (6th param, pill only) --- */
  const bannerPill = boundsFor('pill', freshSettings().loadSettings(), undefined, undefined, undefined, 250);
  check('bannerExtra 250 melebar pil 150 -> 400 (diskalakan)',
    bannerPill.width === Math.round((150 + 250) * 1.3), bannerPill.width);
  const bannerOpen = boundsFor('open', freshSettings().loadSettings(), 200, undefined, undefined, 250);
  check('bannerExtra tidak mengubah kartu terbuka', bannerOpen.width === Math.round(360 * 1.3), bannerOpen.width);

  /* --- Island.peek: hover pada notch mengembang tanpa kehilangan base --- */
  {
    write({ ...base, islandScale: 100, animationMs: 16, ...sizes });
    const { Island } = require('./dist/main/island.js');
    const st = freshSettings().loadSettings();
    let cur = { x: 0, y: 0, width: -1, height: -1 };
    const fakeWin = { getBounds: () => ({ ...cur }), setBounds: (b) => { cur = { ...b }; } };
    const isl = new Island(fakeWin, st);
    isl.place();
    isl.setBase('mini');
    await new Promise((r) => setTimeout(r, 90));
    check('peek setup: island di notch 140x30', cur.width === 140 && cur.height === 30,
      `${cur.width}x${cur.height}`);
    if (typeof isl.peek === 'function') {
      isl.peek();
      await new Promise((r) => setTimeout(r, 90));
      check('peek: notch mengembang ke pil 150x36 dan base tetap mini',
        cur.width === 150 && cur.height === 36 && isl.baseState === 'mini',
        `${cur.width}x${cur.height} base=${isl.baseState}`);
      // Peek must SURVIVE the window poll re-asserting the same base: the old
      // setBase shrank a peeked island every poll, fighting pollHoverZone's
      // re-assert (island flickered mini<->pill and the hover card never came).
      isl.setBase('mini');
      await new Promise((r) => setTimeout(r, 90));
      check('setBase re-assert TIDAK membatalkan peek (tetap pil 150x36)',
        cur.width === 150 && cur.height === 36 && isl.baseState === 'mini',
        `${cur.width}x${cur.height} base=${isl.baseState}`);
      // Leaving the notch is the hover zone's job: close() returns the peek.
      isl.close();
      await new Promise((r) => setTimeout(r, 90));
      check('close() setelah peek: kembali ke notch 140x30',
        cur.width === 140 && cur.height === 30, `${cur.width}x${cur.height}`);
      if (typeof isl.setBanner === 'function') {
        isl.setBanner(true);
        await new Promise((r) => setTimeout(r, 90));
        check('banner saat notch: island terbangun ke pil + lebar banner (150+250, skala 100)',
          cur.width === 400 && cur.height === 36 && isl.baseState === 'mini',
          `${cur.width}x${cur.height} base=${isl.baseState}`);
        isl.setBanner(false);
        await new Promise((r) => setTimeout(r, 90));
        check('banner selesai: notch kembali 140x30 (base mini)',
          cur.width === 140 && cur.height === 30 && isl.baseState === 'mini',
          `${cur.width}x${cur.height}`);
      } else {
        check('banner saat notch: island terbangun ke pil + lebar banner (150+250, skala 100)',
          false, 'Island.setBanner belum ada');
        check('banner selesai: notch kembali 140x30 (base mini)', false, 'Island.setBanner belum ada');
      }
    } else {
      check('peek: notch mengembang ke pil 150x36 dan base tetap mini', false, 'Island.peek belum ada');
      check('setBase setelah peek: kembali ke notch 140x30', false, 'Island.peek belum ada');
    }
  }

  /* --- call-context detection (extras.matchesCall) --- */
  /* The Module._load hook would serve the extras STUB here; drop the stub so
     the real compiled module (with matchesCall) is loaded instead. The later
     main.js require then also gets the real extras, which only starts its
     timers in registerExtras — safe under the mocks. */
  delete stubs.extras;
  const extrasMod = require('./dist/main/extras.js');
  check('WhatsApp biasa bukan rapat (false positive whatsapp.root diperbaiki)',
    extrasMod.matchesCall('WhatsApp WhatsApp 2') === false, extrasMod.matchesCall('WhatsApp WhatsApp 2'));
  check('Telegram saja bukan rapat', extrasMod.matchesCall('Telegram Telegram') === false);
  check('jendela Discord chat biasa BUKAN rapat (false positive discord)',
    extrasMod.matchesCall('Discord | Wibverse 3.0') === false, extrasMod.matchesCall('Discord | Wibverse 3.0'));
  check('judul Discord berisi kata rapat di nama channel bukan call',
    extrasMod.matchesCall('Discord | #rapat-malam') === false, extrasMod.matchesCall('Discord | #rapat-malam'));
  check('Discord voice call terdeteksi',
    extrasMod.matchesCall('Discord | Voice Call') === true);
  check('Discord video call terdeteksi',
    extrasMod.matchesCall('Discord | Video Call dengan Ana') === true);
  check('Discord voice connected terdeteksi',
    extrasMod.matchesCall('Discord | @budi · Voice Connected') === true);
  check('Slack chat biasa bukan rapat',
    extrasMod.matchesCall('Slack | #general Aeolia') === false, extrasMod.matchesCall('Slack | #general Aeolia'));
  check('Zoom terdeteksi', extrasMod.matchesCall('Zoom Meeting 12345') === true);
  check('jendela voice call aplikasi apa pun terdeteksi',
    extrasMod.matchesCall('Voice call with Bila') === true);
  check('panggilan video (Bahasa) terdeteksi',
    extrasMod.matchesCall('WhatsApp — Panggilan video') === true);
  check('browser biasa bukan rapat', extrasMod.matchesCall('Mozilla Firefox - Mozilla Firefox') === false);

  /* --- main process: notice:open protocol map + media IPC --- */
  const settingsLive = require('./dist/main/settings.js');
  await require('./dist/main/main.js');
  await Promise.resolve();
  await new Promise((r) => setImmediate(r));

  const send = (channel, ...args) => {
    const fn = ipcOn.get(channel);
    if (!fn) throw new Error('no ipcMain.on for ' + channel);
    fn(null, ...args);
  };

  check('IPC media:prev dan media:next terdaftar', ipcOn.has('media:prev') && ipcOn.has('media:next'));

  send('notice:open', 'WhatsApp Web', 'Halo');
  check('WhatsApp -> protokol whatsapp://', externalOpens[0] === 'whatsapp://', externalOpens);
  send('notice:open', 'Discord', 'ping');
  check('Discord -> protokol discord://', externalOpens[1] === 'discord://', JSON.stringify(externalOpens));
  send('notice:open', 'Zoom Meeting', 'x');
  check('Zoom -> protokol zoommtg://', externalOpens[2] === 'zoommtg://');
  send('notice:open', 'Aplikasi Tak Dikenal', 'isi pesan penting');
  check('Aplikasi tak dikenal -> pencarian web (noticeOpenLinks on)',
    externalOpens[3].startsWith('https://www.google.com/search?q='), externalOpens[3]);

  /* turn the web fallback off via the real save API (cache-aware) */
  settingsLive.saveSettings({ ...settingsLive.current(), noticeOpenLinks: false });
  const before = externalOpens.length;
  send('notice:open', 'Aplikasi Tak Dikenal', 'isi');
  check('noticeOpenLinks off: aplikasi tak dikenal tidak membuka apa pun',
    externalOpens.length === before, externalOpens.length - before);

  /* media IPC handlers forward to the key stubs without touching real hardware */
  send('media:prev');
  send('media:next');
  check('media:prev/next meneruskan ke tombol media',
    mediaKeys.includes('prev') && mediaKeys.includes('next'), JSON.stringify(mediaKeys));

  /* --- notice:reply = clipboard + deep-link open --- */
  check('IPC notice:reply terdaftar (handle)', ipcHandle.has('notice:reply'));
  check('IPC island:open terdaftar (klik notch expand)', ipcHandle.has('island:open'));

  /* --- miniMode chain: settings:set harus tercermin di island:update --- */
  const setMini = await ipcHandle.get('settings:set')(null, 'miniMode', 'cat');
  await Promise.resolve();
  await new Promise((r) => setImmediate(r));
  check('settings:set miniMode tersimpan (setValue balik settings)',
    setMini && setMini.miniMode === 'cat', JSON.stringify(setMini && setMini.miniMode));
  const lastUpdate = electronMock._wcSends.filter((s) => s.ch === 'island:update').pop();
  check('island:update setelah save membawa miniMode cat',
    Boolean(lastUpdate) && lastUpdate.payload.miniMode === 'cat',
    JSON.stringify(lastUpdate && lastUpdate.payload.miniMode));
  const clipWrites = [];
  electronMock.clipboard.writeText = (t) => clipWrites.push(t);
  const replyKnown = await ipcHandle.get('notice:reply')(null, 'WhatsApp', 'duren', 'oke bentar');
  check('notice:reply WhatsApp: teks disalin ke clipboard', clipWrites.includes('oke bentar'), JSON.stringify(clipWrites));
  check('notice:reply WhatsApp: aplikasi dibuka lewat protokol', replyKnown.opened === true
    && externalOpens.includes('whatsapp://'), JSON.stringify(replyKnown));
  const replyUnknown = await ipcHandle.get('notice:reply')(null, 'Aplikasi Anonim', 'x', 'hai');
  check('notice:reply aplikasi tanpa protokol: jujur opened:false', replyUnknown.opened === false,
    JSON.stringify(replyUnknown));

  const failed = results.filter((r) => !r.ok);
  console.log(`\nQA_FEATURES ${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) { console.log('FAILED:', failed.map((f) => f.name)); process.exitCode = 1; }
  process.exit(process.exitCode || 0);
})().catch((err) => { console.error('PROBE ERROR', err); process.exit(1); });
