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
  activeWindow: { getActiveWindow: () => ({ process: 'explorer', title: 'QA', maximized: false, fullscreen: false, rect: { x: 0, y: 0, width: 1920, height: 1080 } }), isBusyProcess: () => false, BROWSERS: new Set(), browserShouldShrink: () => false, browserTabCount: () => 0, focusProcessWindow: () => true },
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
  check('glassLevel 5 diterima apa adanya (batas bawah 0)', freshSettings().loadSettings().glassLevel === 5);
  write({ glassLevel: 99 });
  check('glassLevel 99 diterima apa adanya (batas atas 100)', freshSettings().loadSettings().glassLevel === 99);
  write({ glassLevel: 'tebal' });
  check('glassLevel non-angka kembali default 55', freshSettings().loadSettings().glassLevel === 55);

  /* --- small notch default sizes + old-default migration --- */
  /* Old expectation here was the 112x26 notch. The reference screenshot the
     user measured is 64x14 with a 5 px bottom radius, so the default moved and
     every old default (64x14 sliver, 150x32 oversized, 112x26 interim) now
     migrates to it. A genuinely customized size is still left alone. */
  check('default mini notch sesuai referensi: 64x14',
    gl.mini.width === 64 && gl.mini.height === 14, JSON.stringify(gl.mini));
  check('default pill ikut Dynamic Island: 150x36', gl.pill.width === 150 && gl.pill.height === 36,
    JSON.stringify(gl.pill));
  write({ mini: { width: 112, height: 26 }, pill: { width: 138, height: 28 } });
  const mig = freshSettings().loadSettings();
  check('migrasi: mini default lama 112x26 -> 64x14 (settings user ikut berubah)',
    mig.mini.width === 64 && mig.mini.height === 14, JSON.stringify(mig.mini));
  write({ mini: { width: 150, height: 32 }, pill: { width: 138, height: 28 } });
  const migBig = freshSettings().loadSettings();
  check('migrasi: mini default 150x32 (build batch B) -> 64x14',
    migBig.mini.width === 64 && migBig.mini.height === 14, JSON.stringify(migBig.mini));
  write({ mini: { width: 64, height: 14 }, pill: { width: 138, height: 28 } });
  const migSliver = freshSettings().loadSettings();
  check('migrasi: mini sliver 64x14 tetap 64x14 (kini default)',
    migSliver.mini.width === 64 && migSliver.mini.height === 14, JSON.stringify(migSliver.mini));
  check('migrasi: pill default lama 138 -> 150', mig.pill.width === 150, JSON.stringify(mig.pill));
  write({ mini: { width: 200, height: 40 }, pill: { width: 160, height: 28 } });
  const kept = freshSettings().loadSettings();
  check('ukuran kustom tidak disentuh migrasi', kept.mini.width === 200 && kept.pill.width === 160,
    JSON.stringify({ m: kept.mini, p: kept.pill }));
  write({ mini: { width: 80, height: 20 }, pill: { width: 160, height: 28 } });
  const kept80 = freshSettings().loadSettings();
  check('mini 80x20 bukan nilai legacy -> tidak direset ke default',
    kept80.mini.width === 80 && kept80.mini.height === 20, JSON.stringify(kept80.mini));

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

  /* --- regresi 2026-11-15: strip kapsul mic TIDAK menggeser badan island ---
     Window tetap melebar MIC_PILL_EXTRA, tapi #island memberi strip itu
     kembali lewat --mic-extra, jadi badan di-anchor dengan lebar TANPA
     micExtra: center/left tidak bergeser sama sekali, right menggeser x ke
     kiri tepat selebar strip dan tepi kanannya tetap di tempat. */
  const MIC_EXTRA = 172;
  for (const scale of [100, 130, 75]) {
    for (const pos of ['center', 'left', 'right']) {
      write({ ...base, islandPosition: pos, islandScale: scale, ...sizes });
      const off = boundsFor('pill', freshSettings().loadSettings());
      write({ ...base, islandPosition: pos, islandScale: scale, ...sizes });
      const on = boundsFor('pill', freshSettings().loadSettings(), undefined, undefined, MIC_EXTRA);
      const extraPx = on.width - off.width;
      check(`micExtra ${MIC_EXTRA} @${scale}% (${pos}): window melebar ${Math.round(MIC_EXTRA * (scale / 100))} px`,
        extraPx === Math.round(MIC_EXTRA * (scale / 100)), `${off.width} -> ${on.width} (delta ${extraPx})`);
      if (pos === 'right') {
        check(`micExtra @${scale}% (right): x bergeser kiri tepat selebar strip, tepi kanan tetap`,
          off.x - on.x === extraPx && on.x + on.width === off.x + off.width,
          `x off=${off.x} on=${on.x} | kanan off=${off.x + off.width} on=${on.x + on.width} | extra=${extraPx}`);
      } else {
        check(`micExtra @${scale}% (${pos}): x badan island TIDAK bergeser`,
          on.x === off.x, `x off=${off.x} on=${on.x}`);
      }
    }
  }

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

  /* --- lirik otomatis (main/lyrics.ts) --- */
  const lyricsMod = require('./dist/main/lyrics.js');
  const tp = lyricsMod.trackParts('Kavi Rao - Neon Harbor');
  check('trackParts: "Artis - Judul" terpecah', tp.artist === 'Kavi Rao' && tp.title === 'Neon Harbor', JSON.stringify(tp));
  const tp2 = lyricsMod.trackParts('Neon Harbor');
  check('trackParts: judul saja, artis kosong', tp2.artist === '' && tp2.title === 'Neon Harbor', JSON.stringify(tp2));
  check('pickSynced: ambil syncedLyrics pertama yang ada',
    lyricsMod.pickSynced([{ syncedLyrics: null }, { syncedLyrics: '[00:05] hai' }]) === '[00:05] hai',
    JSON.stringify(lyricsMod.pickSynced([{ syncedLyrics: null }, { syncedLyrics: '[00:05] hai' }])));
  /* Old expectation was null for a plain-only result. That contradicts the
     current product rule (plain text is a valid fallback, the renderer scrolls
     it at 4 s per line and labels it "teks polos"), so it is restated here
     instead of being dropped: synced still wins, plain is the fallback, and a
     result with no lyric at all stays null. */
  check('pickSynced: hanya teks polos -> dipakai sebagai fallback',
    lyricsMod.pickSynced([{ plainLyrics: 'baris polos' }]) === 'baris polos',
    JSON.stringify(lyricsMod.pickSynced([{ plainLyrics: 'baris polos' }])));
  check('pickSynced: synced menang atas plain',
    lyricsMod.pickSynced([{ plainLyrics: 'polos' }, { syncedLyrics: '[00:03] hai' }]) === '[00:03] hai',
    JSON.stringify(lyricsMod.pickSynced([{ plainLyrics: 'polos' }, { syncedLyrics: '[00:03] hai' }])));
  check('pickSynced: tanpa lirik sama sekali -> null',
    lyricsMod.pickSynced([{}]) === null && lyricsMod.pickSynced([]) === null,
    JSON.stringify([lyricsMod.pickSynced([{}]), lyricsMod.pickSynced([])]));
  const lyricFetches = [];
  let lyricReplies = [];
  electronMock.net.fetch = async (url) => {
    lyricFetches.push(String(url));
    return lyricReplies.length ? lyricReplies.shift() : { ok: false, json: async () => [] };
  };
  lyricReplies = [{ ok: true, json: async () => ({ syncedLyrics: '[00:01.00] baris satu\n[00:04.00] baris dua' }) }];
  const lrc1 = await lyricsMod.fetchLyrics('Kavi Rao - Neon Harbor');
  check('fetchLyrics: endpoint get berhasil, LRC tersinkron kembali',
    lrc1 === '[00:01.00] baris satu\n[00:04.00] baris dua' && lyricFetches[0].includes('/get?'), String(lrc1));
  const lrcCalls = lyricFetches.length;
  await lyricsMod.fetchLyrics('Kavi Rao - Neon Harbor');
  check('fetchLyrics: cache mencegah fetch ulang untuk judul sama', lyricFetches.length === lrcCalls,
    `${lyricFetches.length} vs ${lrcCalls}`);
  lyricReplies = [
    { ok: false, json: async () => [] },
    { ok: true, json: async () => [{ plainLyrics: 'nope' }, { syncedLyrics: '[00:09] fallback' }] },
  ];
  const lrc2 = await lyricsMod.fetchLyrics('Penyanyi X - Lagu Baru');
  check('fetchLyrics: get gagal -> fallback search memilih synced',
    lrc2 === '[00:09] fallback' && lyricFetches.length === lrcCalls + 2, String(lrc2));
  lyricReplies = [{ ok: true, json: async () => [] }];
  const lrc3 = await lyricsMod.fetchLyrics('Tanpa Hasil Apapun');
  check('fetchLyrics: tidak ketemu -> null jujur', lrc3 === null, String(lrc3));
  lyricReplies = [{ ok: true, json: async () => ({ syncedLyrics: null, plainLyrics: 'baris satu\nbaris dua' }) }];
  const lrc4 = await lyricsMod.fetchLyrics('Penyanyi Y - Hanya Teks');
  check('fetchLyrics: get hanya punya plainLyrics -> teks polos dipakai',
    lrc4 === 'baris satu\nbaris dua', String(lrc4));

  /* --- mute mic asli (main/micMute.ts) --- */
  const micMod = require('./dist/main/micMute.js');
  check('parse state: muted=true', micMod.parseMuteReply('muted=true') === true);
  check('parse state: muted=false', micMod.parseMuteReply('muted=false') === false);
  check('parse state: output aneh -> null', micMod.parseMuteReply('error kata powershell') === null);
  const psCalls = [];
  let psReplies = [];
  micMod.setMuteExecutor(async (mode) => { psCalls.push(mode); return psReplies.shift() ?? 'error'; });
  psReplies = ['muted=false'];
  check('getMicMuted: false terbaca', (await micMod.getMicMuted()) === false && psCalls[0] === 'get',
    JSON.stringify(psCalls));
  psReplies = ['muted=false', 'muted=true'];
  const t1 = await micMod.toggleMicMute();
  check('toggleMicMute: baca dulu lalu bisukan, hasil true',
    t1 === true && JSON.stringify(psCalls.slice(-2)) === JSON.stringify(['get', 'on']),
    JSON.stringify(psCalls.slice(-2)));
  psReplies = ['error'];
  check('toggleMicMute: helper gagal -> null (tombol state unknown)', (await micMod.toggleMicMute()) === null);

  /* --- kamera: shortcut per aplikasi meeting (main/camToggle.ts) --- */
  const camMod = require('./dist/main/camToggle.js');
  check('cam: Zoom -> Alt+V', camMod.camShortcutFor('zoom') === 'alt+v', String(camMod.camShortcutFor('zoom')));
  check('cam: Teams -> Ctrl+Shift+O', camMod.camShortcutFor('msteams') === 'ctrl+shift+o');
  check('cam: Meet -> Ctrl+E', camMod.camShortcutFor('meet') === 'ctrl+e');
  check('cam: app tanpa shortcut -> null', camMod.camShortcutFor('discord') === null);
  const camSend = camMod.camDecision('zoom', 'zoom');
  check('cam: app fokus -> kirim shortcut', camSend.send === 'alt+v' && !camSend.hint, JSON.stringify(camSend));
  const camHint = camMod.camDecision('Zoom', 'chrome');
  check('cam: app tidak fokus -> hint jujur, tanpa kirim',
    !camHint.send && (camHint.hint || '').includes('Zoom'), JSON.stringify(camHint));

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

  let opened = await ipcHandle.get('notice:open')(null, 'WhatsApp Web', 'Halo');
  check('WhatsApp -> protokol whatsapp://', opened.ok === true && externalOpens[0] === 'whatsapp://', externalOpens);
  opened = await ipcHandle.get('notice:open')(null, 'Discord', 'ping');
  check('Discord -> protokol discord://', opened.ok === true && externalOpens[1] === 'discord://', JSON.stringify(externalOpens));
  opened = await ipcHandle.get('notice:open')(null, 'Zoom Meeting', 'x');
  check('Zoom -> protokol zoommtg://', opened.ok === true && externalOpens[2] === 'zoommtg://');
  const beforeUnknown = externalOpens.length;
  opened = await ipcHandle.get('notice:open')(null, 'Aplikasi Tak Dikenal', 'isi pesan penting');
  check('Aplikasi tak dikenal -> ok:false, tanpa pencarian web',
    opened.ok === false && opened.code === 'unknown-app'
    && externalOpens.length === beforeUnknown, { opened, opens: externalOpens });

  /* the setting blocks every app now, via the real save API (cache-aware) */
  settingsLive.saveSettings({ ...settingsLive.current(), noticeOpenLinks: false });
  const before = externalOpens.length;
  opened = await ipcHandle.get('notice:open')(null, 'WhatsApp', 'isi');
  check('noticeOpenLinks off: aplikasi dikenal juga tidak membuka apa pun',
    opened.ok === false && opened.code === 'disabled' && externalOpens.length === before,
    { opened, delta: externalOpens.length - before });
  settingsLive.saveSettings({ ...settingsLive.current(), noticeOpenLinks: true });

  /* media IPC handlers forward to the key stubs without touching real hardware */
  send('media:prev');
  send('media:next');
  check('media:prev/next meneruskan ke tombol media',
    mediaKeys.includes('prev') && mediaKeys.includes('next'), JSON.stringify(mediaKeys));

  /* --- notice:reply = clipboard + deep-link open --- */
  check('IPC notice:reply terdaftar (handle)', ipcHandle.has('notice:reply'));
  check('IPC island:open terdaftar (klik notch expand)', ipcHandle.has('island:open'));
  check('IPC mic:mute-state dan mic:mute-toggle terdaftar',
    ipcHandle.has('mic:mute-state') && ipcHandle.has('mic:mute-toggle'));
  check('IPC cam:toggle terdaftar', ipcHandle.has('cam:toggle'));

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
  check('notice:reply WhatsApp: tidak menyalin teks', clipWrites.length === 0, JSON.stringify(clipWrites));
  check('notice:reply WhatsApp: aplikasi dibuka tanpa teks',
    replyKnown.ok === true && replyKnown.via === 'protocol' && externalOpens.includes('whatsapp://')
    && externalOpens.every((u) => !/send\?text=/.test(u)), JSON.stringify(replyKnown));
  check('notice:reply WhatsApp: petunjuk jujur untuk pengguna',
    replyKnown.hint === 'Aplikasi dibuka · ketik dan kirim di sana', replyKnown.hint);
  const replyUnknown = await ipcHandle.get('notice:reply')(null, 'Aplikasi Anonim', 'x', 'hai');
  check('notice:reply aplikasi tanpa protokol: ok:false + alasan',
    replyUnknown.ok === false && replyUnknown.code === 'unknown-app'
    && replyUnknown.hint === 'Aplikasi sumber tidak dikenali.', JSON.stringify(replyUnknown));
  settingsLive.saveSettings({ ...settingsLive.current(), noticeOpenLinks: false });
  const opensBeforeBlock = externalOpens.length;
  const replyBlocked = await ipcHandle.get('notice:reply')(null, 'WhatsApp', 'x', 'hai');
  check('noticeOpenLinks off: Balas tidak membuka apa pun',
    replyBlocked.ok === false && replyBlocked.code === 'disabled'
    && externalOpens.length === opensBeforeBlock, JSON.stringify(replyBlocked));
  settingsLive.saveSettings({ ...settingsLive.current(), noticeOpenLinks: true });

  /* --- lagu jalan menahan pill: notch tidak menelan kontrol musik ---
     Driven through the real poller (pollIntervalMs 500) and the real 2 s
     pollMedia timer; only readMedia and the foreground window are stubs. The
     mock cursor sits on the island, so it is parked off screen first, otherwise
     the hover timer keeps the card open and the base state never settles. */
  const restoreCursor = electronMock.screen.getCursorScreenPoint;
  electronMock.screen.getCursorScreenPoint = () => ({ x: 5, y: 900 });
  const lastIslandState = () => {
    const u = electronMock._wcSends.filter((s) => s.ch === 'island:update').pop();
    return u && u.payload.state;
  };
  const restoreActiveWindow = stubs.activeWindow.getActiveWindow;
  /* Stale contract: this scenario was written when the shipped default was
     'keep'. Pin it explicitly so it still tests "media holds the pill open"
     regardless of the new 'mini' default (assertions unchanged). */
  settingsLive.saveSettings({ ...settingsLive.current(), miniTrigger: 'maximized', mediaMiniBehavior: 'keep' });
  stubs.activeWindow.getActiveWindow = () => ({
    process: 'chrome', title: 'QA', maximized: true, fullscreen: false,
    rect: { x: 0, y: 0, width: 1920, height: 1080 },
  });
  await new Promise((r) => setTimeout(r, 1400));
  check('window maximized tanpa lagu -> island mengecil ke notch', lastIslandState() === 'mini',
    String(lastIslandState()));
  stubs.media.readMedia = () => ({ playing: true, title: 'Nirvana - Smells Like Teen Spirit' });
  await new Promise((r) => setTimeout(r, 3200));
  check('lagu jalan + window maximized -> pill tetap terbuka', lastIslandState() === 'pill',
    String(lastIslandState()));
  stubs.media.readMedia = () => ({ playing: false, title: '' });
  await new Promise((r) => setTimeout(r, 3200));
  check('lagu berhenti -> island kembali mengecil ke notch', lastIslandState() === 'mini',
    String(lastIslandState()));
  stubs.activeWindow.getActiveWindow = restoreActiveWindow;
  settingsLive.saveSettings({ ...settingsLive.current(), miniTrigger: 'fullscreen' });

  /* --- banner/notch race: a banner must hold the pill open --- */
  const bannerHandler = ipcOn.get('banner:show');
  /* Start from a healthy pill base, THEN raise a banner and only afterwards
     let a fullscreen app appear. The old code set base=mini mid banner and
     clipped the 4200 ms notice into a 14 px notch. */
  stubs.activeWindow.getActiveWindow = () => ({
    process: 'explorer', title: 'Desktop', maximized: false, fullscreen: false,
    rect: { left: 0, top: 0, right: 1920, bottom: 1080 },
  });
  await new Promise((r) => setTimeout(r, 1200));
  const pillBefore = lastIslandState();
  if (bannerHandler) {
    bannerHandler(null, true);
    await new Promise((r) => setTimeout(r, 160));
    stubs.activeWindow.getActiveWindow = () => ({
      process: 'game', title: 'Game', maximized: false, fullscreen: true,
      rect: { left: 0, top: 0, right: 1920, bottom: 1080 },
    });
    await new Promise((r) => setTimeout(r, 1300));
    check('banner aktif + fullscreen muncul: badan tetap pil, tidak terpotong notch',
      pillBefore === 'pill' && lastIslandState() === 'pill',
      `sebelum=${pillBefore} saat=${lastIslandState()}`);
    bannerHandler(null, false);
    await new Promise((r) => setTimeout(r, 1300));
    check('banner selesai: fullscreen kembali mengecil ke notch (tidak macet lebar)',
      lastIslandState() === 'mini', String(lastIslandState()));
  } else {
    check('banner aktif + fullscreen muncul: badan tetap pil, tidak terpotong notch', false,
      'ipc banner:show belum terdaftar');
  }
  stubs.activeWindow.getActiveWindow = restoreActiveWindow;

  /* --- openAction mengikuti musik: kartu dibuka langsung ke tab Music --- */
  const lastIslandUpdate = () => electronMock._wcSends.filter((s) => s.ch === 'island:update').pop();
  check('tanpa lagu: openAction tetap dari settings',
    Boolean(lastIslandUpdate()) && lastIslandUpdate().payload.openAction === settingsLive.current().openAction,
    String(lastIslandUpdate() && lastIslandUpdate().payload.openAction));
  /* readMedia is stubbed, so the real 2 s pollMedia timer is what flips the
     main process into "media playing"; nothing is faked past that point. */
  stubs.media.readMedia = () => ({ playing: true, title: 'Nirvana - Smells Like Teen Spirit' });
  await new Promise((r) => setTimeout(r, 2400));
  const playingUpdate = lastIslandUpdate();
  check('pollMedia: lagu jalan -> island:update membawa media true',
    Boolean(playingUpdate) && playingUpdate.payload.media === true
      && playingUpdate.payload.mediaTitle === 'Nirvana - Smells Like Teen Spirit',
    JSON.stringify(playingUpdate && { media: playingUpdate.payload.media, title: playingUpdate.payload.mediaTitle }));
  check('lagu jalan: openAction jadi music', playingUpdate.payload.openAction === 'music',
    String(playingUpdate.payload.openAction));
  await ipcHandle.get('island:open')(null);
  await new Promise((r) => setImmediate(r));
  const openUpdate = lastIslandUpdate();
  check('kartu dibuka saat lagu jalan -> state open + openAction music',
    Boolean(openUpdate) && openUpdate.payload.state === 'open' && openUpdate.payload.openAction === 'music',
    JSON.stringify(openUpdate && { state: openUpdate.payload.state, openAction: openUpdate.payload.openAction }));
  electronMock.screen.getCursorScreenPoint = restoreCursor;

  /* --- warna sampul lagu (helper murni musicColors) --- */
  const mc = require('./dist/main/musicColors.js');
  mc.clearColorCache();
  const bgra = Buffer.alloc(36 * 4);
  const put = (i, r, g, b) => {
    const o = i * 4;
    bgra[o] = b; bgra[o + 1] = g; bgra[o + 2] = r; bgra[o + 3] = 255;
  };
  for (let i = 0; i < 12; i += 1) put(i, 200, 60, 40);
  for (let i = 12; i < 24; i += 1) put(i, 40, 180, 70);
  for (let i = 24; i < 34; i += 1) put(i, 50, 80, 210);
  put(34, 10, 10, 10);
  put(35, 250, 250, 250);
  const pal = mc.dominantColors(bgra, 6, 6);
  check('musicColors: kuantisasi 5 bit per kanal stabil',
    mc.quantizeKey(200, 60, 40) === '25,7,5' && mc.quantizeKey(203, 63, 43) === '25,7,5',
    `${mc.quantizeKey(200, 60, 40)} / ${mc.quantizeKey(203, 63, 43)}`);
  check('musicColors: 3 warna dominan berbeda, hex valid',
    Boolean(pal) && ['c1', 'c2', 'c3'].every((k) => /^#[0-9a-f]{6}$/i.test(pal[k]))
      && new Set([pal.c1, pal.c2, pal.c3]).size === 3, JSON.stringify(pal));
  const flat = Buffer.alloc(12 * 4);
  for (let i = 0; i < 12; i += 1) {
    const o = i * 4;
    flat[o] = 5; flat[o + 1] = 5; flat[o + 2] = 5; flat[o + 3] = 255;
  }
  check('musicColors: bitmap near-hitam saja -> null (fallback hash)',
    mc.dominantColors(flat, 4, 3) === null && mc.dominantColors(Buffer.alloc(0), 4, 3) === null);
  check('musicColors: thumbnail 100x100 dinaikkan ke 300x300',
    mc.upgradeArtwork('https://is1-ssl.mzstatic.com/image/thumb/abc/100x100bb.jpg')
      === 'https://is1-ssl.mzstatic.com/image/thumb/abc/300x300bb.jpg',
    mc.upgradeArtwork('https://is1-ssl.mzstatic.com/image/thumb/abc/100x100bb.jpg'));
  const rows = { results: [
    { trackName: 'Other Song', artworkUrl100: 'https://x/other/100x100bb.jpg' },
    { trackName: 'Bad Guy', artworkUrl100: 'https://x/bad/100x100bb.jpg' },
  ] };
  check('musicColors: hasil dengan trackName cocok diprioritaskan',
    mc.pickArtworkUrl(rows, 'bad guy') === 'https://x/bad/100x100bb.jpg',
    String(mc.pickArtworkUrl(rows, 'bad guy')));
  check('musicColors: tanpa artwork -> null',
    mc.pickArtworkUrl({ results: [{ trackName: 'Bad Guy' }] }, 'bad guy') === null);
  check('musicColors: cacheKey memisah Artist - Song',
    mc.cacheKey('Billie Eilish - bad guy') === 'billie eilish::bad guy',
    mc.cacheKey('Billie Eilish - bad guy'));
  mc.clearColorCache();
  const offline1 = await mc.fetchTrackColors('Offline Artist - No Network');
  const sizeAfter = mc.colorCacheSize();
  const offline2 = await mc.fetchTrackColors('Offline Artist - No Network');
  check('musicColors: offline -> null tanpa throw, hasil null di-cache',
    offline1 === null && offline2 === null && mc.colorCacheSize() === sizeAfter && sizeAfter === 1,
    JSON.stringify({ offline1, sizeAfter, now: mc.colorCacheSize() }));

  /* --- palet gelap untuk latar kartu dinamis --- */
  const hslRound = mc.rgbToHsl(255, 0, 0);
  check('musicColors: rgbToHsl merah -> hue 0',
    Math.abs(hslRound.h) < 0.01 && Math.abs(hslRound.s - 1) < 0.01 && Math.abs(hslRound.l - 0.5) < 0.01,
    JSON.stringify(hslRound));
  check('musicColors: hslToHex round-trip merah',
    mc.hslToHex(0, 1, 0.5) === '#ff0000', mc.hslToHex(0, 1, 0.5));
  check('musicColors: toDeepPalette null -> null',
    mc.toDeepPalette(null) === null);
  const deepReal = mc.toDeepPalette({ c1: '#231a14', c2: '#a49c91', c3: '#847c73' });
  const chromaOf = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    return Math.max(...c) - Math.min(...c);
  };
  check('musicColors: toDeepPalette gelap & terwarnai (bukan panel abu-abu)',
    Boolean(deepReal) && ['c1', 'c2', 'c3'].every((k) => {
      const h = mc.rgbToHsl(...[1, 3, 5].map((i) => parseInt(deepReal[k].slice(i, i + 2), 16)));
      return /^#[0-9a-f]{6}$/i.test(deepReal[k]) && chromaOf(deepReal[k]) >= 55 && h.l >= 0.2 && h.l <= 0.34;
    }), JSON.stringify(deepReal));
  const deepGray = mc.toDeepPalette({ c1: '#808080', c2: '#7a7a7a', c3: '#909090' });
  check('musicColors: palet achromatic dapat 3 hue acuan, tidak identik',
    Boolean(deepGray) && new Set([deepGray.c1, deepGray.c2, deepGray.c3]).size === 3
      && ['c1', 'c2', 'c3'].every((k) => chromaOf(deepGray[k]) >= 55), JSON.stringify(deepGray));

  /* --- first-run greeting for an upgrading install --- */
  const statePath = path.join(tmp, 'state.json');
  fs.writeFileSync(statePath, JSON.stringify({ lastTab: 'web', clips: [] }), 'utf8');
  delete require.cache[require.resolve('./dist/main/store.js')];
  const upgraded = require('./dist/main/store.js').load();
  check('upgrade: state.json lama tanpa greetingSeen tetap menyapa sekali',
    upgraded.greetingSeen === false, JSON.stringify({ greetingSeen: upgraded.greetingSeen }));
  fs.writeFileSync(statePath, JSON.stringify({ lastTab: 'web', clips: [], greetingSeen: true }), 'utf8');
  delete require.cache[require.resolve('./dist/main/store.js')];
  const alreadySeen = require('./dist/main/store.js').load();
  check('install yang sudah menyapa tidak mengulang sapaan',
    alreadySeen.greetingSeen === true, JSON.stringify({ greetingSeen: alreadySeen.greetingSeen }));

  const failed = results.filter((r) => !r.ok);
  console.log(`\nQA_FEATURES ${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) { console.log('FAILED:', failed.map((f) => f.name)); process.exitCode = 1; }
  process.exit(process.exitCode || 0);
})().catch((err) => { console.error('PROBE ERROR', err); process.exit(1); });
