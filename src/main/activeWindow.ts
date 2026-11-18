import { basename, join } from 'node:path';
import { execFileSync } from 'node:child_process';

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
const IsWindowVisible = user32.func('bool IsWindowVisible(void *hWnd)');
const GetWindowTextLengthW = user32.func('int GetWindowTextLengthW(void *hWnd)');
/* GWL_STYLE / WS_POPUP: a genuinely fullscreen app replaces the resizable
   window with a popup. A merely MAXIMIZED app keeps WS_THICKFRAME and reports
   IsZoomed=true, so rectangle coverage alone must not mean "fullscreen". */
const GetWindowLongW = user32.func('int32 GetWindowLongW(void *hWnd, int nIndex)');
const GWL_STYLE = -16;
const WS_POPUP = 0x80000000;
/* GetWindowRect returns PHYSICAL pixels. Electron's display.bounds is logical
   DIPs, so comparing them directly reports a false fullscreen on scaled
   displays. Ask Win32 for the monitor's physical rcMonitor instead. */
const MONITORINFO = koffi.struct('MONITORINFO', {
  cbSize: 'uint32',
  rcMonitor: RECT,
  rcWork: RECT,
  dwFlags: 'uint32',
});
const MonitorFromWindow = user32.func('void *MonitorFromWindow(void *hWnd, uint32 dwFlags)');
const GetMonitorInfoW = user32.func('bool GetMonitorInfoW(void *hMonitor, _Out_ MONITORINFO *lpmi)');
const MONITOR_DEFAULTTONEAREST = 2;
const MONITORINFO_SIZE = 40;
const ShowWindow = user32.func('bool ShowWindow(void *hWnd, int cmd)');
const SetForegroundWindow = user32.func('bool SetForegroundWindow(void *hWnd)');
const keybd_event = user32.func(
  'void keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, uintptr dwExtraInfo)'
);
const OpenProcess = kernel32.func('void *OpenProcess(uint32 access, bool inherit, uint32 pid)');
const QueryFullProcessImageNameW = kernel32.func(
  'bool QueryFullProcessImageNameW(void *hProcess, uint32 flags, _Out_ uint16 *name, _Inout_ uint32 *size)'
);
const CloseHandle = kernel32.func('bool CloseHandle(void *h)');

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

export type ActiveWindow = {
  process: string;
  exe: string;
  title: string;
  maximized: boolean;
  fullscreen: boolean;
  hwnd: string;
  rect: { left: number; top: number; right: number; bottom: number } | null;
};

const EMPTY: ActiveWindow = {
  process: '',
  exe: '',
  title: '',
  maximized: false,
  fullscreen: false,
  hwnd: '',
  rect: null,
};

/**
 * Windows shell / live-wallpaper surfaces are not applications. They paint a
 * window that covers the whole monitor (Program Manager, the WorkerW desktop,
 * TextInputHost, Lively's renderer), so a pure "rect covers the screen" test
 * mistakes them for a fullscreen app and shrinks the island to the 14 px notch
 * whenever the desktop has focus. Treat those as desktop, never as fullscreen.
 * Kept pure so it can be unit-tested without a live desktop.
 */
export function isDesktopShell(process: string, title: string): boolean {
  const p = (process || '').toLowerCase().replace(/\.exe$/, '');
  const t = (title || '').toLowerCase().trim();
  if (p === 'textinputhost' || p === 'lively' || p === 'lively.watchdog') return true;
  if (p === 'wallpaperengine' || p === 'wallpaper32' || p === 'wallpaper64') return true;
  if (/^lively/.test(p) || /wallpaper|rainmeter/.test(p)) return true;
  if (t === 'program manager' || t === 'workerw' || t === 'progman') return true;
  return false;
}

/** Rect/monitor comparison, both in the same (physical) coordinate space. */
export function rectCoversMonitor(
  rect: { left: number; top: number; right: number; bottom: number } | null,
  monitor: { x: number; y: number; width: number; height: number }
): boolean {
  if (!rect) return false;
  return rect.left <= monitor.x
    && rect.top <= monitor.y
    && rect.right >= monitor.x + monitor.width
    && rect.bottom >= monitor.y + monitor.height;
}

/** Fullscreen decision shared by the live probe and the unit tests. A window
    that is maximized (IsZoomed) is not fullscreen even when it covers every
    pixel. The popup-style argument is the Win32 GWL_STYLE bit; it defaults to
    true for callers that only know about coverage. */
export function resolveFullscreen(
  covers: boolean,
  process: string,
  title: string,
  maximized = false,
  popupStyle = true,
): boolean {
  if (!covers || maximized || isDesktopShell(process, title)) return false;
  return Boolean(popupStyle);
}

/** Physical monitor rect for the window's own monitor; null when Win32 cannot
    answer. Used instead of the logical display.bounds before coverage tests. */
function physicalMonitorRect(hwnd: unknown): { x: number; y: number; width: number; height: number } | null {
  const handle = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
  if (!handle) return null;
  const info = {
    cbSize: MONITORINFO_SIZE,
    rcMonitor: { left: 0, top: 0, right: 0, bottom: 0 },
    rcWork: { left: 0, top: 0, right: 0, bottom: 0 },
    dwFlags: 0,
  };
  if (!GetMonitorInfoW(handle, info)) return null;
  const r = info.rcMonitor;
  if (r.right <= r.left || r.bottom <= r.top) return null;
  return { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top };
}

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
 * Foreground window snapshot. Windows gives us a PHYSICAL GetWindowRect, so the
 * monitor used for coverage is also physical (GetMonitorInfoW on the window's
 * own monitor). The caller-supplied bounds are DIPs and only a fallback.
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

    const titleBuf = Buffer.alloc(1024);
    const titleLen = GetWindowTextW(hwnd, titleBuf, 512);
    const title = titleLen > 0 ? titleBuf.toString('utf16le', 0, titleLen * 2).trim() : '';

    const maximized = !!IsZoomed(hwnd);
    const style = Number(GetWindowLongW(hwnd, GWL_STYLE));
    const popupStyle = (style & WS_POPUP) !== 0;
    const physical = physicalMonitorRect(hwnd);
    const covers = rectCoversMonitor(gotRect ? rect : null, physical ?? monitor);

    return {
      process,
      exe: exe ? basename(exe) : '',
      title,
      maximized,
      fullscreen: resolveFullscreen(covers, process, title, maximized, popupStyle),
      hwnd: String(hwnd),
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

/**
 * Bring the first visible top-level window owned by `process` to the front.
 *
 * Used by the meeting camera capsule: Windows has no global camera switch, so
 * for an app without a camera shortcut the honest move is to put that app in
 * front of the user and let them press its own camera button. Best-effort by
 * design - Windows refuses SetForegroundWindow for a process that does not own
 * the foreground, so a throwaway ALT keypress is sent first to release that
 * lock, and any failure simply returns false.
 */
export function focusProcessWindow(process: string): boolean {
  const want = basename(String(process || '')).toLowerCase().replace(/\.exe$/, '');
  if (!want) return false;
  let found: unknown = null;
  const pidOut = koffi.alloc('uint32', 1);
  const cb = koffi.register((hwnd: any) => {
    try {
      if (!IsWindowVisible(hwnd)) return true;
      if (GetWindowTextLengthW(hwnd) <= 0) return true;
      koffi.encode(pidOut, 'uint32', 0);
      GetWindowThreadProcessId(hwnd, pidOut);
      const pid = koffi.decode(pidOut, 'uint32') as number;
      if (!pid) return true;
      const exe = basename(processName(pid)).toLowerCase().replace(/\.exe$/, '');
      if (exe !== want) return true;
      found = hwnd;
      return false; // stop enumerating: first match wins
    } catch {
      return true;
    }
  }, koffi.pointer(EnumWindowsProc));
  try {
    EnumWindows(cb, null);
  } finally {
    koffi.unregister(cb);
  }
  if (!found) return false;
  try {
    ShowWindow(found, 9); // SW_RESTORE
    keybd_event(0x12, 0, 0, 0);        // VK_MENU down  - releases the lock
    keybd_event(0x12, 0, 0x0002, 0);   // VK_MENU up
    return Boolean(SetForegroundWindow(found));
  } catch {
    return false;
  }
}

export const BROWSERS = new Set(['chrome',
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

/** Office apps that mean "the user is doing real work" for the busy trigger. */
export const WORK_APPS = new Set([
  'winword', // Word (.docx)
  'excel',   // Excel (.xlsx)
  'powerpnt',// PowerPoint (.pptx)
]);

export function isBusyProcess(process: string): boolean {
  return BROWSERS.has(process) || WORK_APPS.has(process);
}

/* A browser with one or two tabs is not "busy work" just because it is a
   browser. The notch is for a genuinely crowded window, so a browser only
   shrinks the island at this many tabs (or when fullscreen, handled by caller).
   Kept pure so the trigger can be pinned without launching a browser. */
export const BROWSER_TAB_THRESHOLD = 8;

export function browserShouldShrink(
  process: string,
  _title: string,
  fullscreen: boolean,
  tabCount: number,
): boolean {
  if (fullscreen) return true;
  const name = basename(String(process || '')).toLowerCase().replace(/\.exe$/, '');
  if (!BROWSERS.has(name)) return false;
  return Number(tabCount) >= BROWSER_TAB_THRESHOLD;
}

let tabCountCache: { hwnd: string; count: number; at: number } | null = null;

/* UI Automation is the only reliable way to count Chrome/Edge tabs: the
   window title only names the active tab. The island looks at the foreground
   window twice a second, so a short cache spawned PowerShell 33-120 times a
   minute. A 12 s cache keeps the 8-tab decision correct for a foreground
   window (opening many tabs is a human-speed action) while cutting the churn
   by ~6x. Failures are cached too: without that, a machine where the helper
   cannot compile retried on every single poll. Tradeoff: a tab burst settles
   into the notch up to 12 s late; fullscreen detection is independent of the
   count and stays immediate. */
const TAB_COUNT_CACHE_MS = 12000;
export function browserTabCount(hwnd: string): number {
  const h = String(hwnd || '');
  if (!h) return 0;
  const now = Date.now();
  if (tabCountCache && tabCountCache.hwnd === h && now - tabCountCache.at < TAB_COUNT_CACHE_MS) {
    return tabCountCache.count;
  }
  try {
    const out = execFileSync('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      join(__dirname, 'browser-tab-count.ps1'), h,
    ], { encoding: 'utf8', timeout: 1200, windowsHide: true });
    const count = Math.max(0, Number.parseInt(out.trim(), 10) || 0);
    tabCountCache = { hwnd: h, count, at: now };
    return count;
  } catch {
    const fallback = tabCountCache && tabCountCache.hwnd === h ? tabCountCache.count : 0;
    tabCountCache = { hwnd: h, count: fallback, at: now };
    return fallback;
  }
}
