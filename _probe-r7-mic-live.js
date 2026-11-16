/* R7 mic proof on a real BrowserWindow, real preload and real renderer.
   The microphone is read back through PowerShell Core Audio OUTSIDE the click
   path. setMuteExecutor is never called; the production helper stays real.
   Run: env -u ELECTRON_RUN_AS_NODE electron.exe _probe-r7-mic-live.js */
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { app, BrowserWindow, ipcMain } = require('electron');
const micToggleCalls = { n: 0 };
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => {
  if (channel === 'mic:mute-toggle') {
    return originalHandle(channel, (...args) => {
      micToggleCalls.n += 1;
      return handler(...args);
    });
  }
  return originalHandle(channel, handler);
};

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'aeolia-r7-mic-')));
process.env.ISLAND_FORCE_STATE = 'pill';
process.env.ISLAND_OPEN_SETTINGS = '0';

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  :: ' + JSON.stringify(detail)}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let islandWin = null;
app.on('browser-window-created', (_e, win) => { if (!islandWin) islandWin = win; });

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === './activeWindow') {
    return {
      getActiveWindow: () => ({
        process: 'discord', exe: 'Discord.exe', title: 'Discord',
        maximized: false, fullscreen: false,
        rect: { x: 0, y: 0, width: 1920, height: 1080 },
      }),
      getWindowTitles: () => ['Discord'],
      isBusyProcess: () => false, BROWSERS: new Set(), browserShouldShrink: () => false, browserTabCount: () => 0,
      focusProcessWindow: () => false,
    };
  }
  if (request === './extras') {
    return {
      getExtras: () => ({
        meeting: true, meetingApp: 'Discord', online: true, weather: null,
        weatherError: '', calendarEvents: [], calendarError: '',
        lastDownload: '', resumeOffer: false,
      }),
      isMeeting: () => true,
      registerExtras: () => {},
      dismissResumeOffer: () => {},
      disposeExtras: () => {},
      openPath: () => {},
      pickFile: () => '',
      pickFolder: () => '',
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

/* Independent PowerShell read/write. Uses the same compiled interop assembly
   as the product but is a separate process and a separate source file. */
const dll = path.join(os.tmpdir(), 'aeolia-micmute-v3.dll');
const psPath = path.join(os.tmpdir(), 'aeolia-r7-mic-read.ps1');
const PS = String.raw`param([string]$Mode, [string]$Dll)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path $Dll)) {
$src = @'
using System;
using System.Runtime.InteropServices;
public class MicMute {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
  class MMDeviceEnumeratorComObject {}
  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
  }
  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, out IAudioEndpointVolume volume);
  }
  [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioEndpointVolume {
    int RegisterControlChangeNotify(IntPtr notify);
    int UnregisterControlChangeNotify(IntPtr notify);
    int GetChannelCount(out uint channelCount);
    int SetMasterVolumeLevel(float levelDB, Guid context);
    int SetMasterVolumeLevelScalar(float level, Guid context);
    int GetMasterVolumeLevel(out float levelDB);
    int GetMasterVolumeLevelScalar(out float level);
    int SetChannelVolumeLevel(uint channel, float levelDB, Guid context);
    int SetChannelVolumeLevelScalar(uint channel, float level, Guid context);
    int GetChannelVolumeLevel(uint channel, out float levelDB);
    int GetChannelVolumeLevelScalar(uint channel, out float level);
    int SetMute(bool mute, Guid context);
    int GetMute(out bool mute);
  }
  private static IAudioEndpointVolume Volume(int role) {
    var en = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
    IMMDevice dev;
    int hr = en.GetDefaultAudioEndpoint(1, role, out dev);
    if (hr != 0) throw new InvalidOperationException("endpoint " + hr);
    var iid = typeof(IAudioEndpointVolume).GUID;
    IAudioEndpointVolume vol;
    hr = dev.Activate(ref iid, 1, IntPtr.Zero, out vol);
    if (hr != 0) throw new InvalidOperationException("activate " + hr);
    return vol;
  }
  public static bool IsMuted(int role) { bool m; if (Volume(role).GetMute(out m) != 0) throw new Exception("getmute"); return m; }
  public static void SetMuted(bool mute, int role) { if (Volume(role).SetMute(mute, Guid.Empty) != 0) throw new Exception("setmute"); }
}
'@
Add-Type -TypeDefinition $src -OutputAssembly $Dll | Out-Null
}
[void][Reflection.Assembly]::LoadFrom($Dll)
if ($Mode -eq 'get') { Write-Output ("muted=" + [MicMute]::IsMuted(2).ToString().ToLower()) }
else {
  $want = $Mode -eq 'on'
  foreach ($r in @(2,1,0)) { try { [MicMute]::SetMuted($want, $r) } catch {} }
  Write-Output ("muted=" + [MicMute]::IsMuted(2).ToString().ToLower())
}
`;
fs.writeFileSync(psPath, PS, 'utf8');
const ps = (mode) => execFileSync('powershell.exe',
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psPath, '-Mode', mode, '-Dll', dll],
  { encoding: 'utf8', timeout: 20000 }).trim();
const readMute = () => {
  const line = ps('get');
  const m = /muted=(true|false)/.exec(line);
  if (!m) throw new Error('external read failed: ' + line);
  return m[1] === 'true';
};

const js = (code) => islandWin.webContents.executeJavaScript(code);
/* PowerShell COM startup is not instant. Wait for the read-back-driven UI
   state and report the latency instead of sampling an arbitrary instant. */
async function settleMute(expected) {
  const started = Date.now();
  for (;;) {
    const ui = await js(`(() => {
      const r = document.getElementById('island');
      const b = document.getElementById('meetingMic');
      return { muted: r.dataset.micMuted, pressed: b.getAttribute('aria-pressed'),
        state: r.dataset.state, banner: document.querySelector('#banner:not([hidden]) #bnBody')?.textContent || '' };
    })()`);
    if (ui.muted === String(expected) && ui.pressed === String(expected)) {
      return { ui, ms: Date.now() - started };
    }
    if (Date.now() - started > 6000) return { ui, ms: Date.now() - started, timeout: true };
    await sleep(120);
  }
}
const clickMic = () => js(`(() => {
  const b = document.getElementById('meetingMic');
  const r = b.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const el = document.elementFromPoint(cx, cy);
  if (!el || !el.closest('#meetingMic')) return { hit: false, tag: el && el.tagName };
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true,
    view: window, clientX: cx, clientY: cy }));
  return { hit: true };
})()`);

let baseline = null;
async function run() {
  require(path.join(__dirname, 'dist', 'main', 'main.js'));
  await sleep(1800);
  check('real BrowserWindow with real preload and renderer booted',
    Boolean(islandWin) && !islandWin.isDestroyed());
  const bridge = await js(`({ api: typeof window.api, island: typeof window.island })`);
  check('real contextBridge api exposed', bridge.api === 'object' && bridge.island === 'object', bridge);

  let pill = null;
  for (let i = 0; i < 40; i += 1) {
    pill = await js(`(() => {
      const r = document.getElementById('island');
      const p = document.getElementById('micPill');
      return { state: r.dataset.state, hidden: p.hidden, mic: r.dataset.mic,
        api: typeof window.api.micMuteToggle };
    })()`);
    if (pill.mic === 'on') break;
    await sleep(150);
  }
  check('mic capsule visible in the real pill state',
    pill.state === 'pill' && pill.hidden === false && pill.mic === 'on', pill);

  baseline = readMute();
  console.log('OS_MUTE_BASELINE ' + baseline);

  const first = await clickMic();
  await sleep(700);
  const afterOne = readMute();
  const settledOne = await settleMute(afterOne);
  const uiOne = settledOne.ui;
  console.log('OS_MUTE_SETTLE_MS ' + settledOne.ms);
  check('real hit test reaches the mic capsule and OS mute flips',
    first.hit === true && afterOne !== baseline, { first, baseline, afterOne });
  check('renderer state matches the OS read-back after first click',
    settledOne.timeout !== true && uiOne.state === 'pill', { uiOne, afterOne, ms: settledOne.ms });
  check('clicking the capsule did not open the card', uiOne.state === 'pill');

  const second = await clickMic();
  await sleep(700);
  const afterTwo = readMute();
  const settledTwo = await settleMute(afterTwo);
  check('second real click flips OS mute back',
    second.hit === true && afterTwo === baseline, { second, afterTwo, baseline });
  check('renderer state follows the second OS read-back',
    settledTwo.timeout !== true, { ui: settledTwo.ui, afterTwo, ms: settledTwo.ms });

  /* Two rapid clicks must not queue two PowerShell round trips. The first
     wins; the second is visibly refused while the latch is held. */
  const rapidStart = readMute();
  const callsBeforeRapid = micToggleCalls.n;
  const rapidUi = await js(`(() => {
    const b = document.getElementById('meetingMic');
    const r = b.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const el = document.elementFromPoint(cx, cy) || b;
    const mk = () => new MouseEvent('click', { bubbles: true, cancelable: true,
      view: window, clientX: cx, clientY: cy });
    el.dispatchEvent(mk());
    el.dispatchEvent(mk());
    return { hit: Boolean(el && el.closest('#meetingMic')),
      disabled: b.disabled, ariaDisabled: b.getAttribute('aria-disabled') };
  })()`);
  check('rapid clicks expose an in-flight latch',
    rapidUi.hit && (rapidUi.disabled === true || rapidUi.ariaDisabled === 'true'), rapidUi);
  const rapidSettle = await settleMute(!rapidStart);
  const rapidAfter = readMute();
  check('two rapid clicks cause exactly one OS toggle',
    rapidAfter === !rapidStart && rapidSettle.timeout !== true
    && micToggleCalls.n - callsBeforeRapid === 1,
    { rapidStart, rapidAfter, ms: rapidSettle.ms,
      ipcCalls: micToggleCalls.n - callsBeforeRapid });
  const latchReleased = await js(`(() => {
    const b = document.getElementById('meetingMic');
    return { disabled: b.disabled, ariaDisabled: b.getAttribute('aria-disabled'),
      muted: document.getElementById('island').dataset.micMuted };
  })()`);
  check('latch is released and UI matches the single read-back',
    latchReleased.disabled === false && latchReleased.ariaDisabled !== 'true'
    && latchReleased.muted === String(rapidAfter), latchReleased);

  check('setMuteExecutor was not used by this probe',
    !fs.readFileSync(path.join(__dirname, '_probe-r7-mic-live.js'), 'utf8').includes('setMuteExecutor' + '('));

  const failed = results.filter((r) => !r.ok);
  console.log(`\nR7_MIC_LIVE ${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) console.log('FAILED: ' + failed.map((f) => f.name).join(' | '));
  const code = failed.length ? 1 : 0;
  finallyRestore(code);
}

function finallyRestore(code) {
  try {
    const now = readMute();
    if (baseline !== null && now !== baseline) {
      ps(baseline ? 'on' : 'off');
      console.log('OS_MUTE_RESTORED ' + readMute());
    } else {
      console.log('OS_MUTE_UNCHANGED ' + now);
    }
  } catch (err) {
    console.log('OS_MUTE_RESTORE_FAILED ' + String(err && err.message || err));
  }
  app.exit(code);
}

run().catch((err) => {
  console.error('R7_MIC_LIVE ERROR', err && err.stack || err);
  finallyRestore(2);
});
