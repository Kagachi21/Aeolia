/* Probe: enumerate top-level windows with rect + process, to see whether the
   live wallpaper (Lively) creates a monitor-covering window that could be
   mistaken for a fullscreen app by getActiveWindow(). Run with plain node. */
const koffi = require('koffi');
const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');

const RECT = koffi.struct('RECT', {
  left: 'long', top: 'long', right: 'long', bottom: 'long',
});
const EnumWindows = user32.func('bool EnumWindows(void *cb, void *p)');
const EnumWindowsProc = koffi.proto('bool EnumWindowsProc(void *hWnd, void *lParam)');
const GetWindowRect = user32.func('bool GetWindowRect(void *hWnd, _Out_ RECT *r)');
const GetWindowTextW = user32.func('int GetWindowTextW(void *hWnd, _Out_ uint16 *t, int n)');
const IsWindowVisible = user32.func('bool IsWindowVisible(void *hWnd)');
const GetWindowThreadProcessId = user32.func('uint32 GetWindowThreadProcessId(void *hWnd, _Out_ uint32 *pid)');
const OpenProcess = kernel32.func('void *OpenProcess(uint32 a, bool i, uint32 pid)');
const QueryFullProcessImageNameW = kernel32.func('bool QueryFullProcessImageNameW(void *h, uint32 f, _Out_ uint16 *n, _Inout_ uint32 *s)');
const CloseHandle = kernel32.func('bool CloseHandle(void *h)');
const GetForegroundWindow = user32.func('void *GetForegroundWindow()');
const MONITOR = { w: 1920, h: 1080 };

function pname(pid) {
  const h = OpenProcess(0x1000, false, pid);
  if (!h) return '';
  try {
    const buf = Buffer.alloc(2048);
    const sz = koffi.alloc('uint32', 1);
    koffi.encode(sz, 'uint32', 1024);
    if (!QueryFullProcessImageNameW(h, 0, buf, sz)) return '';
    const n = koffi.decode(sz, 'uint32');
    return buf.toString('utf16le', 0, n * 2).split('\\').pop();
  } finally { CloseHandle(h); }
}

const rows = [];
const cb = koffi.register((hwnd) => {
  try {
    const r = { left: 0, top: 0, right: 0, bottom: 0 };
    const got = GetWindowRect(hwnd, r);
    const pidOut = koffi.alloc('uint32', 1);
    koffi.encode(pidOut, 'uint32', 0);
    GetWindowThreadProcessId(hwnd, pidOut);
    const pid = koffi.decode(pidOut, 'uint32');
    const proc = pid ? pname(pid) : '';
    const tb = Buffer.alloc(1024);
    const len = GetWindowTextW(hwnd, tb, 512);
    const title = len > 0 ? tb.toString('utf16le', 0, len * 2) : '';
    const vis = !!IsWindowVisible(hwnd);
    const covers = got && r.left <= 0 && r.top <= 0 && r.right >= MONITOR.w && r.bottom >= MONITOR.h;
    if (vis && (covers || /lively|wallpaper|progman|workerw|explorer/i.test(proc || title))) {
      rows.push({ hwnd: String(hwnd), proc, title, vis, covers, rect: `${r.left},${r.top},${r.right},${r.bottom}` });
    }
  } catch (e) { /* window vanished */ }
  return true;
}, koffi.pointer(EnumWindowsProc));
try { EnumWindows(cb, null); } finally { koffi.unregister(cb); }

const fg = GetForegroundWindow();
const fgPid = koffi.alloc('uint32', 1);
koffi.encode(fgPid, 'uint32', 0);
GetWindowThreadProcessId(fg, fgPid);
console.log('FOREGROUND PID', koffi.decode(fgPid, 'uint32'), 'PROC', pname(koffi.decode(fgPid, 'uint32')));
console.log('COVERING / WALLPAPER WINDOWS:');
for (const r of rows) console.log(JSON.stringify(r));
console.log('TOTAL', rows.length);
