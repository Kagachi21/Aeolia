/* R15 MIC/CAM probe (fails before the mic-hint / camera-privacy work).
   Part A: mic helper failures must carry an explicit error hint.
   Part B: camera privacy consent toggle must read back before claiming verified.
   Part C: main IPC routes cameraMode ('shortcut' vs 'privacy') and emits a mic
   error hint. Part D: UI/type wiring.
   Run: node _probe-r15-miccam.js */
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const root = __dirname;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aeolia-r15-miccam-'));
fs.writeFileSync(path.join(tmp, 'settings.json'), JSON.stringify({
  pollIntervalMs: 2000, cameraMode: 'privacy', meetingAuto: false, miniMode: 'clock',
  mini: { width: 64, height: 14 }, pill: { width: 150, height: 36 }, open: { width: 360, height: 92 },
}), 'utf8');
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  :: ' + detail}`);
};
const originalLoad = Module._load;
const loadReal = (rel) => originalLoad.call(Module, path.join(root, rel));

/* ------------------------------------------------ Part A: mic error hint */
const mic = loadReal('dist/main/micMute.js');
mic.setMuteExecutor(async () => 'error');
(async () => {
  const nullState = await mic.getMicMuted();
  check('mic helper failure still yields an honest null', nullState === null, String(nullState));
  const hint = typeof mic.lastMicError === 'function' ? mic.lastMicError() : null;
  check('mic helper exposes an explicit error hint', typeof hint === 'string' && hint.length > 0, String(hint));

  /* --------------------------------------- Part B: camera privacy consent */
  let privacyExists = true;
  try { loadReal('dist/main/cameraPrivacy.js'); } catch { privacyExists = false; }
  check('cameraPrivacy module exists', privacyExists);
  if (privacyExists) {
    const cp = loadReal('dist/main/cameraPrivacy.js');
    const paths = typeof cp.webcamConsentPaths === 'function' ? cp.webcamConsentPaths() : {};
    check('uses the Win10/11 webcam consent keys, not the absent DeviceAccess key',
      /CapabilityAccessManager\\ConsentStore\\webcam/.test(String(paths.root || ''))
        && /NonPackaged/.test(String(paths.nonPackaged || ''))
        && !/DeviceAccess/.test(JSON.stringify(paths)), JSON.stringify(paths));
    check('parses consent values from the PowerShell reply',
      typeof cp.parseConsentReply === 'function'
        && cp.parseConsentReply('webcam=Allow\nnonpackaged=Allow').enabled === true
        && cp.parseConsentReply('webcam=Deny\nnonpackaged=Allow').enabled === false);

    let writes = 0;
    cp.setConsentExecutor(async (script) => {
      if (/Set-ItemProperty/.test(script)) { writes += 1; return ''; }
      return writes > 0 ? 'webcam=Deny\nnonpackaged=Deny' : 'webcam=Allow\nnonpackaged=Allow';
    });
    const toggled = await cp.toggleWebcamConsent();
    check('privacy toggle writes Deny and verifies by reading back',
      toggled.verified === true && toggled.enabled === false && writes === 2, JSON.stringify(toggled));

    cp.setConsentExecutor(async (script) => (/Set-ItemProperty/.test(script) ? '' : 'error'));
    const failed = await cp.toggleWebcamConsent();
    check('failed read-back is never reported as verified',
      failed.verified === false && failed.ok === false && /hint/.test(JSON.stringify(failed)), JSON.stringify(failed));
    cp.setConsentExecutor(null);
  }

  /* --------------------------------------------- Part C: main IPC routing */
  const sent = [];
  const ipcHandle = new Map();
  const ipcOn = new Map();
  const display = { bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
  let focusProcess = 'zoom';
  const electronMock = {
    app: {
      requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(),
      on: () => {}, quit: () => {}, focus: () => {}, setPath: () => {}, getPath: () => tmp, setLoginItemSettings: () => {},
    },
    BrowserWindow: class {
      constructor() { this.webContents = { send: (ch, p) => sent.push({ ch, p }), once: () => {}, on: () => {} }; }
      setBounds() {} getBounds() { return { x: 0, y: 0, width: 150, height: 36 }; }
      setMinimumSize() {} setMaximumSize() {} setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {}
      setContentProtection() {} setIgnoreMouseEvents() {} isDestroyed() { return false; }
      show() {} showInactive() {} hide() {} focus() {} loadFile() {} once() {} on() {}
    },
    clipboard: { readText: () => Promise.resolve(''), writeText: () => {} },
    globalShortcut: { unregisterAll: () => {}, register: () => {} },
    ipcMain: { on: (c, fn) => ipcOn.set(c, fn), handle: (c, fn) => ipcHandle.set(c, fn) },
    powerMonitor: { getSystemIdleTime: () => 0, on: () => {} },
    screen: { getPrimaryDisplay: () => display, getDisplayNearestPoint: () => display, getCursorScreenPoint: () => ({ x: 960, y: 5 }) },
    shell: { openExternal: () => {}, openPath: () => Promise.resolve('') },
    dialog: { showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }) },
    net: { fetch: () => Promise.reject(new Error('offline')) },
    desktopCapturer: { getSources: () => Promise.resolve([]) },
    session: { fromPartition: () => ({}) },
  };
  let shortcutSends = 0;
  const stubs = {
    thinFrame: { dropThickFrame: () => {} },
    activeWindow: {
      BROWSERS: new Set(), browserShouldShrink: () => false, isBusyProcess: () => false, browserTabCount: () => 0,
      getActiveWindow: () => ({ process: focusProcess, title: 'Zoom Meeting', fullscreen: false, maximized: false, hwnd: '1' }),
      getWindowTitles: () => [], focusProcessWindow: () => true,
    },
    media: { readMedia: () => ({ playing: false, title: '' }) },
    power: { readPower: () => ({ percent: 80, charging: false }) },
    keys: { mediaPlayPause: () => {}, mediaPrev: () => {}, mediaNext: () => {}, sendShortcut: () => { shortcutSends += 1; return true; } },
    systemControl: { brightnessRange: () => ({ supported: false, current: 0 }), setBrightness: () => false, pasteShortcut: () => {}, toggleMute: () => {}, volumeStep: () => {} },
    ramClean: { cpuPercent: () => 1, memoryInfo: () => ({ usedMb: 1, totalMb: 2, percent: 1 }), cleanRam: () => ({ freedMb: 0, trimmed: 0 }) },
    capture: { registerCapture: () => {}, disposeCapture: () => {} },
    desktopGlass: { setDesktopGlass: () => {} },
    extras: {
      disposeExtras: () => {}, getExtras: () => ({ meeting: false, meetingApp: 'zoom', online: true, weather: null, weatherError: '', calendarEvents: [], calendarError: '', lastDownload: '', resumeOffer: false }),
      isMeeting: () => false, openPath: () => {}, pickFile: () => Promise.resolve(''), pickFolder: () => Promise.resolve(''),
      registerExtras: () => {}, dismissResumeOffer: () => {},
    },
    lyrics: { fetchLyrics: () => Promise.resolve(null) },
    musicColors: { fetchTrackColors: () => Promise.resolve(null), toDeepPalette: () => null },
    noticeLaunch: { open: () => Promise.resolve({}), reply: () => Promise.resolve({}) },
    micMute: { getMicMuted: () => Promise.resolve(false), toggleMicMute: () => Promise.resolve(null), lastMicError: () => 'helper gagal (stderr: Add-Type)' },
    cameraPrivacy: { toggleWebcamConsent: () => Promise.resolve({ ok: true, verified: true, enabled: false, code: 'privacy-verified', hint: 'Kamera diblokir dan terbaca' }) },
  };
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electronMock;
    if (typeof request === 'string' && request.startsWith('./')) {
      const key = path.basename(request, '.js');
      if (Object.prototype.hasOwnProperty.call(stubs, key)) return stubs[key];
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  require(path.join(root, 'dist/main/main.js'));
  await new Promise((r) => setTimeout(r, 30));
  const invoke = (ch, ...args) => ipcHandle.get(ch)(null, ...args);

  const privacyResult = await invoke('cam:toggle');
  check('cameraMode privacy: IPC reports a read-back verified state',
    privacyResult.verified === true && privacyResult.ok === true && shortcutSends === 0, JSON.stringify(privacyResult));

  await invoke('settings:set', 'cameraMode', 'shortcut');
  shortcutSends = 0;
  const shortcutResult = await invoke('cam:toggle');
  check('cameraMode shortcut: IPC sends the per-app shortcut, never claims verified',
    shortcutSends === 1 && shortcutResult.verified === false && shortcutResult.sent === true,
    JSON.stringify(shortcutResult));

  sent.length = 0;
  const micResult = await invoke('mic:mute-toggle');
  check('mic failure emits an explicit honest error hint over IPC',
    micResult === null && sent.some((m) => m.ch === 'mic:error' && /helper/.test(String(m.p))),
    JSON.stringify(sent));

  /* ------------------------------------------------------ Part D: wiring */
  const mainSrc = fs.readFileSync(path.join(root, 'src/main/main.ts'), 'utf8');
  const settingsUi = fs.readFileSync(path.join(root, 'src/settings/settings.ts'), 'utf8');
  const rendererSrc = fs.readFileSync(path.join(root, 'src/renderer/renderer.ts'), 'utf8');
  const types = fs.readFileSync(path.join(root, 'src/renderer/global.d.ts'), 'utf8');
  check('main settings exposes cameraMode', /cameraMode/.test(fs.readFileSync(path.join(root, 'src/main/settings.ts'), 'utf8')));
  check('Settings UI offers shortcut / privacy / both', /cameraMode/.test(settingsUi) && /Keduanya|Both/.test(settingsUi));
  check('renderer reports verified camera state and mic hint', /r\.verified/.test(rendererSrc) && /onMicError/.test(rendererSrc));
  check('CamToggleResult type allows verified results', /verified:\s*boolean/.test(types));
  check('main routes on cameraMode in cam:toggle', /cameraMode/.test(mainSrc));

  Module._load = originalLoad;
  const failed = results.filter((r) => !r.ok);
  console.log(`\nR15_MICCAM ${results.length - failed.length}/${results.length} FAILED=${failed.length}`);
  process.exit(failed.length === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
