import { basename } from 'node:path';

/* koffi ships as CommonJS; requiring it keeps the build free of type friction. */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const koffi = require('koffi') as any;

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');

const RECT = koffi.struct('RECT', {
  left: 'long',
  top: 'long',
  right: 'long',
  bottom: 'long',
});

const GetForegroundWindow = user32.func('void *GetForegroundWindow()');
const GetWindowRect = user32.func('bool GetWindowRect(void *hWnd, _Out_ RECT *rect)');
const IsZoomed = user32.func('bool IsZoomed(void *hWnd)');
const GetWindowThreadProcessId = user32.func(
  'uint32 GetWindowThreadProcessId(void *hWnd, _Out_ uint32 *pid)'
);
const GetWindowTextW = user32.func('int GetWindowTextW(void *hWnd, _Out_ uint16 *text, int maxCount)');
const EnumWindows = user32.func('bool EnumWindows(void *lpEnumFunc, void *lParam)');
const EnumWindowsProc = koffi.proto('bool EnumWindowsProc(void *hWnd, void *lParam)');
const OpenProcess = kernel32.func('void *OpenProcess(uint32 access, bool inherit, uint32 pid)');
const QueryFullProcessImageNameW = kernel32.func(
  'bool QueryFullProcessImageNameW(void *hProcess, uint32 flags, _Out_ uint16 *name, _Inout_ uint32 *size)'
);
const CloseHandle = kernel32.func('bool CloseHandle(void *h)');

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

export type ActiveWindow = {
  process: string;
  exe: string;
  maximized: boolean;
  fullscreen: boolean;
  rect: { left: number; top: number; right: number; bottom: number } | null;
};

const EMPTY: ActiveWindow = {
  process: '',
  exe: '',
  maximized: false,
  fullscreen: false,
  rect: null,
};

function processName(pid: number): string {
  const handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
  if (!handle) return '';
  try {
    const buf = Buffer.alloc(2048);
    const size = koffi.alloc('uint32', 1);
    koffi.encode(size, 'uint32', 1024);
    const ok = QueryFullProcessImageNameW(handle, 0, buf, size);
    if (!ok) return '';
    const chars = koffi.decode(size, 'uint32') as number;
    return buf.toString('utf16le', 0, chars * 2);
  } finally {
    CloseHandle(handle);
  }
}

/**
 * Foreground window snapshot. `monitor` is the primary display bounds; a window
 * whose rect covers it is treated as fullscreen even when it is not zoomed.
 */
export function getActiveWindow(monitor: {
  x: number;
  y: number;
  width: number;
  height: number;
}): ActiveWindow {
  try {
    const hwnd = GetForegroundWindow();
    if (!hwnd) return { ...EMPTY };

    const rect = { left: 0, top: 0, right: 0, bottom: 0 };
    const gotRect = GetWindowRect(hwnd, rect);
    const pidOut = koffi.alloc('uint32', 1);
    koffi.encode(pidOut, 'uint32', 0);
    GetWindowThreadProcessId(hwnd, pidOut);
    const pid = koffi.decode(pidOut, 'uint32') as number;

    const exe = processName(pid);
    const process = exe ? basename(exe).replace(/\.exe$/i, '').toLowerCase() : '';

    const maximized = !!IsZoomed(hwnd);
    const covers =
      gotRect &&
      rect.left <= monitor.x &&
      rect.top <= monitor.y &&
      rect.right >= monitor.x + monitor.width &&
      rect.bottom >= monitor.y + monitor.height;

    return {
      process,
      exe: exe ? basename(exe) : '',
      maximized,
      fullscreen: !!covers,
      rect: gotRect ? rect : null,
    };
  } catch (err) {
    console.warn('[activeWindow] failed:', err);
    return { ...EMPTY };
  }
}

export type WindowInfo = { process: string; title: string };

/* Titles of all top-level windows. Browsers put the active tab name here,
   which is how playback in Firefox/Chrome becomes visible without SMTC. */
export function getWindowTitles(): WindowInfo[] {
  const out: WindowInfo[] = [];
  const pidOut = koffi.alloc('uint32', 1);
  const cb = koffi.register((hwnd: any) => {
    try {
      const buf = Buffer.alloc(1024);
      const len = GetWindowTextW(hwnd, buf, 512);
      if (len <= 0) return true;
      const title = buf.toString('utf16le', 0, len * 2).trim();
      if (!title) return true;
      koffi.encode(pidOut, 'uint32', 0);
      GetWindowThreadProcessId(hwnd, pidOut);
      const pid = koffi.decode(pidOut, 'uint32') as number;
      const exe = pid ? processName(pid) : '';
      out.push({ process: exe ? basename(exe).toLowerCase() : '', title });
    } catch {
      // A window can disappear between enumeration and this read.
    }
    return true;
  }, koffi.pointer(EnumWindowsProc));
  try {
    EnumWindows(cb, null);
  } finally {
    koffi.unregister(cb);
  }
  return out;
}

export const BROWSERS = new Set([
  'chrome',
  'msedge',
  'firefox',
  'brave',
  'opera',
  'vivaldi',
  'arc',
  'chromium',
  'thorium',
]);

export const WORD = 'winword';

export function isBusyProcess(process: string): boolean {
  return BROWSERS.has(process) || process === WORD;
}
