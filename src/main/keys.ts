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
