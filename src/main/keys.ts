const koffi = require('koffi') as any;

const user32 = koffi.load('user32.dll');
const keybd_event = user32.func(
  'void keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, uintptr dwExtraInfo)'
);

const VK_MEDIA_PREV = 0xb1;
const VK_MEDIA_NEXT = 0xb0;
const VK_MEDIA_PLAY_PAUSE = 0xb3;
const KEYEVENTF_KEYUP = 0x0002;

function sendKey(vk: number): void {
  try {
    keybd_event(vk, 0, 0, 0);
    keybd_event(vk, 0, KEYEVENTF_KEYUP, 0);
  } catch (err) {
    console.warn('[keys] media key failed:', err);
  }
}

/** Sends the media play/pause key to whatever owns the session. */
export function mediaPlayPause(): void {
  sendKey(VK_MEDIA_PLAY_PAUSE);
}

/** Previous track via the media key. */
export function mediaPrev(): void {
  sendKey(VK_MEDIA_PREV);
}

/** Next track via the media key. */
export function mediaNext(): void {
  sendKey(VK_MEDIA_NEXT);
}

const VK_MAP: Record<string, number> = {
  ctrl: 0x11, alt: 0x12, shift: 0x10, win: 0x5b,
  a: 0x41, b: 0x42, c: 0x43, d: 0x44, e: 0x45, f: 0x46, g: 0x47, h: 0x48,
  i: 0x49, j: 0x4a, k: 0x4b, l: 0x4c, m: 0x4d, n: 0x4e, o: 0x4f, p: 0x50,
  q: 0x51, r: 0x52, s: 0x53, t: 0x54, u: 0x55, v: 0x56, w: 0x57, x: 0x58,
  y: 0x59, z: 0x5a,
};

/** Sends a modifier+letter combo (e.g. "alt+v", "ctrl+shift+m") to the
    focused window — the meeting app's own camera toggle. */
export function sendShortcut(combo: string): boolean {
  const parts = String(combo || '').toLowerCase().split('+').filter(Boolean);
  const mods = parts.filter((p) => p in VK_MAP && ['ctrl', 'alt', 'shift', 'win'].includes(p));
  const key = parts[parts.length - 1];
  if (!key || !(key in VK_MAP)) return false;
  try {
    for (const m of mods) keybd_event(VK_MAP[m], 0, 0, 0);
    keybd_event(VK_MAP[key], 0, 0, 0);
    keybd_event(VK_MAP[key], 0, KEYEVENTF_KEYUP, 0);
    for (const m of mods.reverse()) keybd_event(VK_MAP[m], 0, KEYEVENTF_KEYUP, 0);
    return true;
  } catch (err) {
    console.warn('[keys] shortcut failed:', err);
    return false;
  }
}
