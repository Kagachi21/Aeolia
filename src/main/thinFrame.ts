import type { BrowserWindow } from 'electron';

/* koffi ships as CommonJS. */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const koffi = require('koffi') as any;

const user32 = koffi.load('user32.dll');

const GWL_STYLE = -16;
const WS_THICKFRAME = 0x00040000;
const WS_MAXIMIZEBOX = 0x00010000;

const GetWindowLongPtrW = user32.func('int64 GetWindowLongPtrW(void *hWnd, int nIndex)');
const SetWindowLongPtrW = user32.func(
  'int64 SetWindowLongPtrW(void *hWnd, int nIndex, int64 dwNewLong)'
);
const SetWindowPos = user32.func(
  'bool SetWindowPos(void *hWnd, void *after, int x, int y, int cx, int cy, uint flags)'
);

const SWP_NOMOVE = 0x0002;
const SWP_NOZORDER = 0x0004;
const SWP_NOACTIVATE = 0x0010;
const SWP_FRAMECHANGED = 0x0020;

/**
 * Windows refuses to size a WS_THICKFRAME window below SM_CYMINTRACK (39 px),
 * which is what kept the mini notch too tall. Dropping the style is the only
 * way to get a genuinely 14 px tall window; Electron's `thickFrame: false`
 * does not survive `transparent: true`.
 */
export function dropThickFrame(win: BrowserWindow): boolean {
  try {
    const handle = win.getNativeWindowHandle();
    const hwnd = koffi.decode(handle, 'void *');
    const style = Number(GetWindowLongPtrW(hwnd, GWL_STYLE));
    if (!style) return false;

    const next = style & ~WS_THICKFRAME & ~WS_MAXIMIZEBOX;
    if (next === style) return true;

    SetWindowLongPtrW(hwnd, GWL_STYLE, next);
    SetWindowPos(hwnd, null, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
    return true;
  } catch (err) {
    console.warn('[thinFrame] failed:', err);
    return false;
  }
}
