import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* Real system microphone mute through Windows Core Audio.
   The capture endpoint's IAudioEndpointVolume::SetMute is the only supported
   switch; it lives behind COM, so a small PowerShell helper (C# interop,
   compiled once to %TEMP%) does the call. Every failure path returns null so
   the button can show an honest "unknown" state instead of a lie.

   Windows keeps THREE default capture endpoints per device: eConsole (0),
   eMultimedia (1) and eCommunications (2). Voice chat - Discord, Teams, Zoom,
   any WASAPI VoIP client - opens the eCommunications default. The first
   version of this helper only ever touched eConsole, so on a machine where the
   two defaults differ the island muted a device Discord never read: the pill
   changed colour and the call kept transmitting. All three roles are written
   now, and the state is read back from eCommunications first. */

const CSHARP = `
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
    // dataFlow 1 = capture (microphone), role 0/1/2 = console/multimedia/comms.
    int hr = en.GetDefaultAudioEndpoint(1, role, out dev);
    if (hr != 0) throw new InvalidOperationException("GetDefaultAudioEndpoint " + hr);
    var iid = typeof(IAudioEndpointVolume).GUID;
    IAudioEndpointVolume vol;
    hr = dev.Activate(ref iid, 1, IntPtr.Zero, out vol);
    if (hr != 0) throw new InvalidOperationException("Activate " + hr);
    return vol;
  }

  public static bool IsMuted(int role) {
    bool m;
    int hr = Volume(role).GetMute(out m);
    if (hr != 0) throw new InvalidOperationException("GetMute " + hr);
    return m;
  }

  public static void SetMuted(bool mute, int role) {
    int hr = Volume(role).SetMute(mute, Guid.Empty);
    if (hr != 0) throw new InvalidOperationException("SetMute " + hr);
  }
}
`.trim();

/* Roles in read priority: communications first, because that is the endpoint a
   call app actually records from; console last as the broadest fallback.

   Read-First deliberately does NOT return the value it read. A function used in
   an expression context (if (-not (Read-First))) has its whole output stream
   consumed by the condition, so "muted=false" printed from inside it vanished
   and the caller saw an empty reply - which parsed as null and made every click
   look like a Core Audio failure. It now stashes the state and only returns a
   boolean; the value is printed by the caller. */
const PS_SCRIPT = `
param([string]$Mode, [string]$Dll)
$ErrorActionPreference = 'Stop'
$src = @'
${CSHARP}
'@
if (-not (Test-Path $Dll)) { Add-Type -TypeDefinition $src -OutputAssembly $Dll | Out-Null }
[void][System.Reflection.Assembly]::LoadFrom($Dll)
$roles = @(2, 1, 0)
$script:State = $null

function Read-First {
  foreach ($r in $roles) {
    try {
      $script:State = [MicMute]::IsMuted($r)
      return $true
    } catch { }
  }
  return $false
}

function Emit-State {
  if ($script:State -ne $null) {
    Write-Output ("muted=" + $script:State.ToString().ToLower())
  } else {
    Write-Output 'muted=error'
  }
}

switch ($Mode) {
  'get' {
    [void](Read-First)
    Emit-State
  }
  'on' {
    $touched = $false
    foreach ($r in $roles) {
      try { [MicMute]::SetMuted($true, $r); $touched = $true } catch { }
    }
    if (-not $touched) { Write-Output 'muted=error'; break }
    [void](Read-First)
    Emit-State
  }
  'off' {
    $touched = $false
    foreach ($r in $roles) {
      try { [MicMute]::SetMuted($false, $r); $touched = $true } catch { }
    }
    if (-not $touched) { Write-Output 'muted=error'; break }
    [void](Read-First)
    Emit-State
  }
}
`.trim();

/* Versioned file names on purpose. The helper compiles once to %TEMP%, so a
   v1 DLL left over from an older build would be loaded and every call to the
   new role-aware API would throw MissingMethodException. Bumping the version
   guarantees the new assembly is the one that gets built. */
const HELPER_VERSION = 'v3';
const scriptPath = (): string => join(tmpdir(), `aeolia-micmute-${HELPER_VERSION}.ps1`);
const dllPath = (): string => join(tmpdir(), `aeolia-micmute-${HELPER_VERSION}.dll`);

/** Rewrites the script when its content changed, not only when it is missing:
    an upgraded build must never reuse last version's helper. */
function ensureScript(): void {
  const target = scriptPath();
  if (existsSync(target) && readFileSync(target, 'utf8') === PS_SCRIPT) return;
  writeFileSync(target, PS_SCRIPT, 'utf8');
}

export type MuteExecutor = (mode: 'get' | 'on' | 'off') => Promise<string>;
let executor: MuteExecutor | null = null;

/** Probes inject here; production leaves it null (real PowerShell). */
export function setMuteExecutor(fn: MuteExecutor | null): void { executor = fn; }

/** Pure parse so probes can pin the contract: only "muted=true|false" counts. */
export function parseMuteReply(reply: string): boolean | null {
  const m = /muted=(true|false)/.exec(String(reply || ''));
  return m ? m[1] === 'true' : null;
}

function runPs(mode: 'get' | 'on' | 'off'): Promise<string> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: string): void => { if (!settled) { settled = true; resolve(v); } };
    try {
      ensureScript();
      const p = spawn('powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath(), '-Mode', mode, '-Dll', dllPath()],
        { windowsHide: true });
      let out = '';
      let err = '';
      p.stdout.on('data', (d) => { out += String(d); });
      p.stderr.on('data', (d) => { err += String(d); });
      /* A compile/COM failure used to collapse to the bare string "error" and
         the pill silently showed "unknown". Keep the first stderr line so the
         caller can show the user a real reason instead of a dead button. */
      const detail = (): string => err.split(/\r?\n/).map((s) => s.trim()).find(Boolean)?.slice(0, 160) || '';
      p.on('error', (e) => done(`error|spawn: ${e instanceof Error ? e.message : String(e)}`));
      p.on('close', (code) => done(code === 0 ? out : `error|exit ${code}${detail() ? `: ${detail()}` : ''}`));
      setTimeout(() => { try { p.kill(); } catch { /* already gone */ } done('error|timeout'); }, 8000);
    } catch (e) {
      done(`error|${e instanceof Error ? e.message : String(e)}`);
    }
  });
}

let lastError: string | null = null;

/** The last mic failure reason, or null after a successful read. */
export function lastMicError(): string | null { return lastError; }

function hintFromReply(reply: string): string {
  const text = String(reply || '');
  if (/muted=error/.test(text)) return 'Core Audio menolak akses ke mikrofon (COM error)';
  const m = /^error\|(.*)$/m.exec(text);
  if (m && m[1]) return `PowerShell gagal: ${m[1]}`;
  return 'State mikrofon tidak bisa dibaca';
}

/** Parse and remember why a read failed. null is still the honest value; the
    hint is delivered separately so existing boolean|null callers stay valid. */
function readState(reply: string): boolean | null {
  const value = parseMuteReply(reply);
  lastError = value === null ? hintFromReply(reply) : null;
  return value;
}

export async function getMicMuted(): Promise<boolean | null> {
  return readState(await (executor ?? runPs)('get'));
}

/** Read state, flip it, return the NEW state; null when Core Audio refused. */
export async function toggleMicMute(): Promise<boolean | null> {
  const cur = await getMicMuted();
  if (cur === null) return null;
  return readState(await (executor ?? runPs)(cur ? 'off' : 'on'));
}
