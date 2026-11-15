import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* Real system microphone mute through Windows Core Audio.
   The capture endpoint's IAudioEndpointVolume::SetMute is the only supported
   switch; it lives behind COM, so a small PowerShell helper (C# interop,
   compiled once to %TEMP%) does the call. Every failure path returns null so
   the button can show an honest "unknown" state instead of a lie. */

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

  private static IAudioEndpointVolume Volume() {
    var en = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
    IMMDevice dev;
    // dataFlow 1 = capture (microphone), role 0 = console (default device).
    int hr = en.GetDefaultAudioEndpoint(1, 0, out dev);
    if (hr != 0) throw new InvalidOperationException("GetDefaultAudioEndpoint " + hr);
    var iid = typeof(IAudioEndpointVolume).GUID;
    IAudioEndpointVolume vol;
    hr = dev.Activate(ref iid, 1, IntPtr.Zero, out vol);
    if (hr != 0) throw new InvalidOperationException("Activate " + hr);
    return vol;
  }

  public static bool IsMuted() {
    bool m;
    int hr = Volume().GetMute(out m);
    if (hr != 0) throw new InvalidOperationException("GetMute " + hr);
    return m;
  }

  public static void SetMuted(bool mute) {
    int hr = Volume().SetMute(mute, Guid.Empty);
    if (hr != 0) throw new InvalidOperationException("SetMute " + hr);
  }
}
`.trim();

const PS_SCRIPT = `
param([string]$Mode, [string]$Dll)
$ErrorActionPreference = 'Stop'
$src = @'
${CSHARP}
'@
if (-not (Test-Path $Dll)) { Add-Type -TypeDefinition $src -OutputAssembly $Dll | Out-Null }
[void][System.Reflection.Assembly]::LoadFrom($Dll)
switch ($Mode) {
  'get' { Write-Output ("muted=" + [MicMute]::IsMuted().ToString().ToLower()) }
  'on'  { [MicMute]::SetMuted($true);  Write-Output ("muted=" + [MicMute]::IsMuted().ToString().ToLower()) }
  'off' { [MicMute]::SetMuted($false); Write-Output ("muted=" + [MicMute]::IsMuted().ToString().ToLower()) }
}
`.trim();

const scriptPath = (): string => join(tmpdir(), 'aeolia-micmute.ps1');
const dllPath = (): string => join(tmpdir(), 'aeolia-micmute.dll');

function ensureScript(): void {
  if (!existsSync(scriptPath())) writeFileSync(scriptPath(), PS_SCRIPT, 'utf8');
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
      p.stdout.on('data', (d) => { out += String(d); });
      p.on('error', () => done('error'));
      p.on('close', (code) => done(code === 0 ? out : 'error'));
      setTimeout(() => { try { p.kill(); } catch { /* already gone */ } done('error'); }, 8000);
    } catch {
      done('error');
    }
  });
}

export async function getMicMuted(): Promise<boolean | null> {
  return parseMuteReply(await (executor ?? runPs)('get'));
}

/** Read state, flip it, return the NEW state; null when Core Audio refused. */
export async function toggleMicMute(): Promise<boolean | null> {
  const cur = await getMicMuted();
  if (cur === null) return null;
  return parseMuteReply(await (executor ?? runPs)(cur ? 'off' : 'on'));
}
