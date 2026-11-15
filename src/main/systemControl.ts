/* Real volume (relative stepping) and brightness (DDC/CI) control. */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const koffi = require('koffi') as any;

const user32 = koffi.load('user32.dll');
const dxva2 = koffi.load('dxva2.dll');

const keybd_event = user32.func(
  'void keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, uintptr dwExtraInfo)'
);
const GetDesktopWindow = user32.func('void *GetDesktopWindow()');
const MonitorFromWindow = user32.func('void *MonitorFromWindow(void *hwnd, uint32 flags)');
const GetNumberOfPhysicalMonitorsFromHMONITOR = dxva2.func(
  'bool GetNumberOfPhysicalMonitorsFromHMONITOR(void *hMonitor, _Out_ uint32 *count)'
);
const GetPhysicalMonitorsFromHMONITOR = dxva2.func(
  'bool GetPhysicalMonitorsFromHMONITOR(void *hMonitor, uint32 count, _Out_ void *monitors)'
);
const GetMonitorBrightness = dxva2.func(
  'bool GetMonitorBrightness(void *hMonitor, _Out_ uint32 *min, _Out_ uint32 *cur, _Out_ uint32 *max)'
);
const SetMonitorBrightness = dxva2.func(
  'bool SetMonitorBrightness(void *hMonitor, uint32 value)'
);
const DestroyPhysicalMonitors = dxva2.func(
  'bool DestroyPhysicalMonitors(uint32 count, void *monitors)'
);

const VK_VOLUME_UP = 0xaf;
const VK_VOLUME_DOWN = 0xae;
const VK_VOLUME_MUTE = 0xad;
const VK_CONTROL = 0x11;
const VK_V = 0x56;
const KEYEVENTF_KEYUP = 0x0002;
const MONITOR_DEFAULTTOPRIMARY = 1;

/* Each VK_VOLUME_UP/DOWN press moves the system volume by 2 %. */
export function volumeStep(direction: 'up' | 'down', steps: number): void {
  const vk = direction === 'up' ? VK_VOLUME_UP : VK_VOLUME_DOWN;
  const count = Math.max(0, Math.min(50, Math.round(steps)));
  for (let i = 0; i < count; i++) {
    keybd_event(vk, 0, 0, 0);
    keybd_event(vk, 0, KEYEVENTF_KEYUP, 0);
  }
}

export function toggleMute(): void {
  keybd_event(VK_VOLUME_MUTE, 0, 0, 0);
  keybd_event(VK_VOLUME_MUTE, 0, KEYEVENTF_KEYUP, 0);
}

/** Ctrl+V into whatever currently has focus. The island window is created with
    focusable:false, so the keystroke reaches the user's own app. */
export function pasteShortcut(): void {
  keybd_event(VK_CONTROL, 0, 0, 0);
  keybd_event(VK_V, 0, 0, 0);
  keybd_event(VK_V, 0, KEYEVENTF_KEYUP, 0);
  keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0);
}

/* Brightness goes through DDC/CI. Laptop panels without it report
   unsupported instead of pretending the slider works. */
function primaryMonitor(): { handle: unknown; monitor: unknown } | null {
  try {
    const desktop = GetDesktopWindow();
    const hMonitor = MonitorFromWindow(desktop, MONITOR_DEFAULTTOPRIMARY);
    if (!hMonitor) return null;
    const countBuf = koffi.alloc('uint32', 1);
    if (!GetNumberOfPhysicalMonitorsFromHMONITOR(hMonitor, countBuf)) return null;
    const count = koffi.decode(countBuf, 'uint32') as number;
    if (count < 1) return null;
    // PHYSICAL_MONITOR = HANDLE (8) + WCHAR[128] (256) on x64.
    const arr = Buffer.alloc(count * 264);
    if (!GetPhysicalMonitorsFromHMONITOR(hMonitor, count, arr)) return null;
    const handle = koffi.decode(arr, 0, 'void *');
    return { handle, monitor: arr };
  } catch (err) {
    console.warn('[brightness] monitor lookup failed:', err);
    return null;
  }
}

export function brightnessRange(): { supported: boolean; min: number; max: number; current: number } {
  const m = primaryMonitor();
  if (!m) return { supported: false, min: 0, max: 100, current: 0 };
  const mn = koffi.alloc('uint32', 1);
  const cur = koffi.alloc('uint32', 1);
  const mx = koffi.alloc('uint32', 1);
  try {
    if (!GetMonitorBrightness(m.handle, mn, cur, mx)) {
      return { supported: false, min: 0, max: 100, current: 0 };
    }
    const minimum = koffi.decode(mn, 'uint32') as number;
    const current = koffi.decode(cur, 'uint32') as number;
    const maximum = koffi.decode(mx, 'uint32') as number;
    const span = Math.max(1, maximum - minimum);
    return {
      supported: true,
      min: minimum,
      max: maximum,
      current: Math.round(((current - minimum) / span) * 100),
    };
  } finally {
    try { DestroyPhysicalMonitors(1, m.monitor); } catch { /* already gone */ }
  }
}

export function setBrightness(percent: number): boolean {
  const m = primaryMonitor();
  if (!m) return false;
  const range = brightnessRange();
  if (!range.supported) return false;
  const span = Math.max(1, range.max - range.min);
  const raw = Math.round(range.min + (Math.max(0, Math.min(100, percent)) / 100) * span);
  const ok = SetMonitorBrightness(m.handle, raw);
  try { DestroyPhysicalMonitors(1, m.monitor); } catch { /* already gone */ }
  return ok;
}
