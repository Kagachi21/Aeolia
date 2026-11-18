import { spawn } from 'node:child_process';

/* Camera privacy through the HKCU webcam consent store.
   The old MeetingMuteCam script used
   DeviceAccess\Global\{E5323777-...}, which is ABSENT on current Windows 10/11
   builds. The live keys are the CapabilityAccessManager consent store below;
   `webcam` is the global "let apps access your camera" switch and
   `webcam\NonPackaged` is the one that covers desktop meeting apps (Zoom,
   Teams, Chrome/Meet, Discord). Only these two Value properties are written.
   The toggle is per-user and needs no administrator rights. */

const ROOT_KEY = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\webcam';
const NONPACKAGED_KEY = `${ROOT_KEY}\\NonPackaged`;

export function webcamConsentPaths(): { root: string; nonPackaged: string; value: string } {
  return { root: ROOT_KEY, nonPackaged: NONPACKAGED_KEY, value: 'Value' };
}

export type ConsentRead = {
  root: 'Allow' | 'Deny' | null;
  nonPackaged: 'Allow' | 'Deny' | null;
  enabled: boolean;
  read: boolean;
};

/** Pure parse of the helper's two-line reply. A missing NonPackaged value
    inherits the root consent, so it does not by itself mean "blocked". */
export function parseConsentReply(reply: string): ConsentRead {
  const text = String(reply || '');
  const rootMatch = /^webcam=(Allow|Deny)$/m.exec(text);
  const npMatch = /^nonpackaged=(Allow|Deny)$/m.exec(text);
  const root = (rootMatch ? rootMatch[1] : null) as ConsentRead['root'];
  const nonPackaged = (npMatch ? npMatch[1] : null) as ConsentRead['nonPackaged'];
  const enabled = root === 'Allow' && nonPackaged !== 'Deny';
  return { root, nonPackaged, enabled, read: root !== null };
}

const READ_BLOCK = `
function Read-Consent($key) {
  if (-not (Test-Path -LiteralPath $key)) { return 'Unknown' }
  $v = (Get-ItemProperty -LiteralPath $key -Name Value -ErrorAction SilentlyContinue).Value
  if ($v -eq 'Allow') { return 'Allow' }
  if ($v -eq 'Deny')  { return 'Deny' }
  return 'Unknown'
}
`;

function buildScript(mode: 'get' | 'on' | 'off', key?: string): string {
  const emit = 'Write-Output ("webcam=" + (Read-Consent $root)); Write-Output ("nonpackaged=" + (Read-Consent $np))';
  const header = `$root = '${ROOT_KEY}';\n$np = '${NONPACKAGED_KEY}';\n$ErrorActionPreference = 'Stop'\n${READ_BLOCK}`;
  if (mode === 'get') return `${header}${emit}`;
  const want = mode === 'on' ? 'Allow' : 'Deny';
  // Create only the key that is actually missing; never touch DeviceAccess.
  return `${header}if (-not (Test-Path -LiteralPath '${key}')) { New-Item -Path '${key}' -Force | Out-Null }\n` +
    `Set-ItemProperty -LiteralPath '${key}' -Name Value -Value '${want}'\n${emit}`;
}

export type ConsentExecutor = (script: string) => Promise<string>;
let executor: ConsentExecutor | null = null;

/** Probes inject here; production leaves it null (real PowerShell). */
export function setConsentExecutor(fn: ConsentExecutor | null): void { executor = fn; }

async function run(mode: 'get' | 'on' | 'off', key?: string): Promise<ConsentRead> {
  const script = buildScript(mode, key);
  try {
    if (executor) return parseConsentReply(await executor(script));
    if (process.platform !== 'win32' || !process.versions.electron) {
      return { root: null, nonPackaged: null, enabled: false, read: false };
    }
    const reply = await new Promise<string>((resolve) => {
      let settled = false;
      const done = (v: string): void => { if (!settled) { settled = true; resolve(v); } };
      const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true });
      let out = '';
      p.stdout.on('data', (d) => { out += String(d); });
      p.on('error', () => done(''));
      p.on('close', (code) => done(code === 0 ? out : ''));
      setTimeout(() => { try { p.kill(); } catch { /* already gone */ } done(''); }, 8000);
    });
    return parseConsentReply(reply);
  } catch {
    return { root: null, nonPackaged: null, enabled: false, read: false };
  }
}

export type PrivacyCamResult = {
  ok: boolean;
  verified: boolean;
  enabled: boolean | null;
  code: 'privacy-verified' | 'privacy-unverified' | 'privacy-read-failed' | 'privacy-write-failed';
  hint: string;
};

export async function readWebcamConsent(): Promise<ConsentRead> { return run('get'); }

/** Flip the two consent values, then READ THEM BACK. No branch reports
    verified unless that read-back actually happened and matched the request. */
export async function toggleWebcamConsent(): Promise<PrivacyCamResult> {
  const before = await run('get');
  if (!before.read) {
    return { ok: false, verified: false, enabled: null, code: 'privacy-read-failed',
      hint: 'Izin kamera Windows tidak bisa dibaca · buka Settings > Privacy > Camera' };
  }
  const want = !before.enabled;
  // Write replies are not trusted as proof: only the final read-back decides.
  // A write that silently fails shows up as an unchanged/missing consent value.
  await run(want ? 'on' : 'off', ROOT_KEY);
  await run(want ? 'on' : 'off', NONPACKAGED_KEY);
  const after = await run('get');
  const verified = after.read && after.enabled === want;
  return {
    ok: verified,
    verified,
    enabled: verified ? after.enabled : null,
    code: verified ? 'privacy-verified' : 'privacy-unverified',
    hint: verified
      ? (want ? 'Kamera diizinkan lagi · status terbaca dari Windows' : 'Kamera diblokir di Windows · status terbaca')
      : 'Perubahan izin kamera tidak dapat diverifikasi · cek Settings > Privacy > Camera',
  };
}
