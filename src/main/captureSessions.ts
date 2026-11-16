import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* Active microphone (capture) sessions through Windows Core Audio.
 *
 * Window titles are not enough to notice a Discord voice channel: Discord
 * keeps its title at "Discord | #general | Server". The reliable signal is a
 * live WASAPI capture stream. IMMDeviceEnumerator lists active CAPTURE
 * endpoints; on each one IMMDevice::Activate(IID_IAudioSessionManager2)
 * exposes the session enumerator. A session whose AudioSessionState is Active
 * (1) owns a running capture stream, and IAudioSessionControl2::GetProcessId
 * gives us the owning process.
 *
 * The COM interfaces live behind a small PowerShell/C# helper compiled once
 * into %TEMP%, the same approach as micMute.ts. Every failure path (no
 * PowerShell, compile error, COM error, timeout, unexpected output) resolves
 * to an empty list; the island must never crash because audio enumeration
 * failed. Probes inject setCaptureExecutor() to avoid touching the OS.
 */

const CSHARP = `
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;

public class CaptureSessions {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
  class MMDeviceEnumeratorComObject {}

  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
  }

  [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceCollection {
    [PreserveSig] int GetCount(out uint count);
    [PreserveSig] int Item(uint index, out IMMDevice device);
  }

  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, out IAudioSessionManager2 manager);
  }

  /* IAudioSessionManager2 vtable = IAudioSessionManager (2) + its own 5. */
  [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionManager2 {
    [PreserveSig] int GetAudioSessionControl(IntPtr sessionGuid, int flags, out IntPtr control);
    [PreserveSig] int GetSimpleAudioVolume(IntPtr sessionGuid, int flags, out IntPtr volume);
    [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator sessions);
    [PreserveSig] int RegisterSessionNotification(IntPtr notification);
    [PreserveSig] int UnregisterSessionNotification(IntPtr notification);
    [PreserveSig] int RegisterDuckNotification(IntPtr sessionId, IntPtr notification);
    [PreserveSig] int UnregisterDuckNotification(IntPtr notification);
  }

  [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionEnumerator {
    [PreserveSig] int GetCount(out int count);
    [PreserveSig] int GetSession(int index, out IAudioSessionControl2 session);
  }

  /* IAudioSessionControl2 vtable = IAudioSessionControl (9) + its own 5.
     GetProcessId is slot 14 (IUnknown 3 + 9 + 2), matching the Win32 ABI. */
  [ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionControl2 {
    [PreserveSig] int GetState(out int state);
    [PreserveSig] int GetDisplayName(out IntPtr name);
    [PreserveSig] int SetDisplayName(IntPtr name, IntPtr context);
    [PreserveSig] int GetIconPath(out IntPtr path);
    [PreserveSig] int SetIconPath(IntPtr path, IntPtr context);
    [PreserveSig] int GetGroupingParam(out Guid grouping);
    [PreserveSig] int SetGroupingParam(IntPtr grouping, IntPtr context);
    [PreserveSig] int RegisterAudioSessionNotification(IntPtr notification);
    [PreserveSig] int UnregisterAudioSessionNotification(IntPtr notification);
    [PreserveSig] int GetSessionIdentifier(out IntPtr id);
    [PreserveSig] int GetSessionInstanceIdentifier(out IntPtr id);
    [PreserveSig] int GetProcessId(out uint pid);
    [PreserveSig] int IsSystemSoundsSession();
    [PreserveSig] int SetDuckingPreference(bool optOut);
  }

  public static string List() {
    var lines = new List<string>();
    uint deviceCount = 0;
    int totalSessions = 0;
    try {
      var en = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
      IMMDeviceCollection devices;
      // dataFlow 1 = eCapture, stateMask 1 = DEVICE_STATE_ACTIVE.
      int hr = en.EnumAudioEndpoints(1, 1, out devices);
      if (hr != 0 || devices == null) {
        lines.Add("diag|enumEndpoints=" + hr);
        return string.Join("\\n", lines);
      }
      hr = devices.GetCount(out deviceCount);
      if (hr != 0) {
        lines.Add("diag|getCount=" + hr);
        return string.Join("\\n", lines);
      }
      for (uint d = 0; d < Math.Min(deviceCount, 32U); d++) {
        IMMDevice dev;
        hr = devices.Item(d, out dev);
        if (hr != 0 || dev == null) continue;
        var iid = typeof(IAudioSessionManager2).GUID;
        IAudioSessionManager2 mgr;
        hr = dev.Activate(ref iid, 23, IntPtr.Zero, out mgr);
        if (hr != 0 || mgr == null) continue;
        IAudioSessionEnumerator sessions;
        hr = mgr.GetSessionEnumerator(out sessions);
        if (hr != 0 || sessions == null) continue;
        int sessionCount;
        hr = sessions.GetCount(out sessionCount);
        if (hr != 0) continue;
        totalSessions += Math.Min(sessionCount, 256);
        for (int i = 0; i < Math.Min(sessionCount, 256); i++) {
          IAudioSessionControl2 session;
          hr = sessions.GetSession(i, out session);
          if (hr != 0 || session == null) continue;
          int state;
          // 1 = AudioSessionStateActive: a real, running capture stream.
          if (session.GetState(out state) != 0 || state != 1) continue;
          uint pid;
          if (session.GetProcessId(out pid) != 0 || pid == 0) continue;
          string name = "";
          try { name = Process.GetProcessById((int)pid).ProcessName; } catch { }
          if (name.Length == 0) continue;
          lines.Add("pid=" + pid + "|name=" + name + "|state=1");
        }
      }
    } catch (Exception e) {
      lines.Add("error=" + e.GetType().Name);
    }
    // Ignored by parseCaptureSessions; makes a silent enumeration failure
    // distinguishable from "no microphone is in use" when debugging.
    lines.Insert(0, "diag|devices=" + deviceCount + "|sessions=" + totalSessions);
    return string.Join("\\n", lines);
  }
}
`.trim();

const PS_SCRIPT = `
param([string]$Dll)
$ErrorActionPreference = 'Stop'
$src = @'
${CSHARP}
'@
if (-not (Test-Path $Dll)) { Add-Type -TypeDefinition $src -OutputAssembly $Dll | Out-Null }
[void][System.Reflection.Assembly]::LoadFrom($Dll)
Write-Output ([CaptureSessions]::List())
`.trim();

const scriptPath = (): string => join(tmpdir(), 'aeolia-capture-sessions.ps1');
const dllPath = (): string => join(tmpdir(), 'aeolia-capture-sessions.dll');

function ensureScript(): void {
  if (!existsSync(scriptPath())) writeFileSync(scriptPath(), PS_SCRIPT, 'utf8');
}

export type CaptureExecutor = () => Promise<string>;
let executor: CaptureExecutor | null = null;

/** Probes inject here; production leaves it null (real PowerShell). */
export function setCaptureExecutor(fn: CaptureExecutor | null): void { executor = fn; }

/** Pure parser so probes can pin the wire contract without Windows COM.
    Only well-formed ACTIVE sessions count; error/junk lines are ignored. */
export function parseCaptureSessions(reply: string): string[] {
  const out: string[] = [];
  for (const rawLine of String(reply || '').split(/\r?\n/)) {
    const match = /^pid=(\d+)\|name=([^|]+)\|state=1$/.exec(rawLine.trim());
    if (!match) continue;
    const name = match[2].trim().toLowerCase()
      .replace(/\.exe$/i, '')
      .replace(/[^a-z0-9._-]/g, '');
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

function runPs(): Promise<string> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: string): void => { if (!settled) { settled = true; resolve(v); } };
    try {
      ensureScript();
      const p = spawn('powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath(), '-Dll', dllPath()],
        { windowsHide: true });
      let out = '';
      p.stdout.on('data', (d) => { out += String(d); });
      p.on('error', () => done(''));
      p.on('close', (code) => done(code === 0 ? out : ''));
      setTimeout(() => { try { p.kill(); } catch { /* already gone */ } done(''); }, 6000);
    } catch {
      done('');
    }
  });
}

/** Names of processes with a live microphone stream, or [] on any failure.
    Injected executors always run (QA); the real COM helper only runs inside
    an Electron main process on Windows, so plain-node QA harnesses never
    spawn PowerShell or touch the machine's audio devices. */
export async function getActiveCaptureProcesses(): Promise<string[]> {
  try {
    if (executor) return parseCaptureSessions(await executor());
    if (process.platform !== 'win32' || !process.versions.electron) return [];
    return parseCaptureSessions(await runPs());
  } catch {
    return [];
  }
}
