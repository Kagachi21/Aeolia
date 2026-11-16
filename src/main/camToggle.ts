/* Camera toggle for the meeting pill. Windows has no global camera switch a
   normal user process may flip, so the honest lever is the meeting app's own
   camera shortcut, sent only while that app is focused.

   Not every call app ships one. Discord has no camera keybind at all, so the
   first version of this module answered "no shortcut" by writing a hint into
   button.title - inside a 39 px window nobody can read. From the user's seat
   that is a dead button. The decision now has three honest outcomes instead of
   two: send, bring the app forward, or explain. */

const BROWSER_PROCESSES = new Set([
  'chrome', 'msedge', 'firefox', 'brave', 'opera', 'vivaldi', 'arc', 'chromium',
]);

/** Google Meet lives inside a browser process, so the process name alone
    hides the app's real camera shortcut. The foreground tab title is the
    signal we actually have; route Ctrl+E to Meet, not the browser shell. */
export function cameraAppFor(process: string, title: string): string {
  const proc = String(process || '').trim().toLowerCase().replace(/\.exe$/, '');
  const label = String(title || '');
  if (BROWSER_PROCESSES.has(proc)
      && /(meet\.google|google meet|\bmeet\b)/i.test(label)) return 'Google Meet';
  return proc || label.trim().slice(0, 40);
}

const CAM_APPS: { shortcut: string; phrases: string[] }[] = [
  { shortcut: 'alt+v', phrases: ['zoom meeting', 'zoom'] },
  { shortcut: 'ctrl+shift+m', phrases: ['microsoft teams', 'ms teams', 'msteams', 'teams'] },
  { shortcut: 'ctrl+shift+v', phrases: ['cisco webex', 'webex'] },
  { shortcut: 'ctrl+e', phrases: ['google meet', 'meet'] },
];

function tokens(value: string): string[] {
  return String(value || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function containsParts(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    if (needle.every((word, j) => haystack[i + j] === word)) return true;
  }
  return false;
}

/** Whole-token map: process name -> camera shortcut; null when we do not know
    one. "MeetNow" must not inherit Meet's shortcut. */
export function camShortcutFor(app: string): string | null {
  const parts = tokens(app);
  for (const entry of CAM_APPS) {
    if (entry.phrases.some((phrase) => containsParts(parts, tokens(phrase)))) {
      return entry.shortcut;
    }
  }
  return null;
}

/** Whole-token/basename focus comparison. "Zoom Meeting" matches zoom.exe;
    "MeetNow" does not match meet. */
export function focusedAppMatches(app: string, focusedProcess: string): boolean {
  const appParts = tokens(app);
  const processName = String(focusedProcess || '').toLowerCase().split(/[\\/]/).pop() || '';
  const processParts = tokens(processName.replace(/\.[a-z0-9]+$/i, ''));
  if (appParts.length === 0 || processParts.length === 0) return false;
  return containsParts(appParts, processParts) || containsParts(processParts, appParts);
}

/** Whether the capsule can really toggle the camera in this app. */
export function camShortcutKnown(app: string): boolean {
  return camShortcutFor(app) !== null;
}

export type CamDecision = {
  app?: string;
  send?: string;
  hint?: string;
  focus?: boolean;
  observedFocus: boolean;
  code?: 'no-shortcut' | 'need-focus' | 'unknown-app';
};
export type CamCode = 'unverified-shortcut' | 'need-focus' | 'no-shortcut' | 'unknown-app' | 'send-failed';

/* Aeolia never observes the meeting app's camera state, so ok and verified
   stay false in R7. A sent shortcut is only a best-effort action. */
export type CamToggleResult = {
  ok: false;
  verified: false;
  sent: boolean;
  focused: boolean;
  shortcut: string;
  code: CamCode;
  hint: string;
};

/** Pure decision the IPC handler applies.
 *  - known shortcut + app focused   -> send it (a real toggle)
 *  - known shortcut + app in back   -> focus it and ask for a second press
 *  - no known shortcut              -> focus it and name the app in the hint,
 *                                      so the click always produces something
 *                                      the user can see. */
export function camDecision(app: string, focusedProcess: string): CamDecision {
  const name = String(app || '').trim();
  const combo = camShortcutFor(name);
  const isFocused = focusedAppMatches(name, focusedProcess);
  if (!name) {
    return {
      app: name, code: 'unknown-app', focus: false, observedFocus: false,
      hint: 'Aplikasi rapat tidak dikenali · matikan kamera di aplikasi rapat',
    };
  }

  if (!combo) {
    return {
      app: name, code: 'no-shortcut', observedFocus: isFocused,
      focus: !isFocused,
      hint: `${name} tidak punya shortcut kamera · klik ikon kamera di aplikasinya`,
    };
  }
  if (!isFocused) {
    return { app: name, code: 'need-focus', focus: true, observedFocus: false,
      hint: `Fokuskan ${name} dulu, lalu tekan lagi · shortcut ${combo}` };
  }
  return { app: name, send: combo, observedFocus: true };
}

/** Maps the pure decision plus the observed send/focus outcome to the IPC
    result. Every branch is honest about not having read camera state. */
export function camResult(decision: CamDecision, sent: boolean, focused: boolean): CamToggleResult {
  const name = decision.app || 'Aplikasi rapat';
  const base = {
    ok: false as const, verified: false as const, sent,
    focused: decision.observedFocus || focused,
  };
  if (decision.send && sent) {
    return { ...base, shortcut: decision.send, code: 'unverified-shortcut',
      hint: `Shortcut kamera dikirim ke ${name} · cek status kamera di aplikasi (best effort)` };
  }
  if (decision.send) {
    return { ...base, sent: false, shortcut: decision.send, code: 'send-failed',
      hint: 'Shortcut kamera gagal dikirim · matikan kamera di aplikasi rapat (best effort)' };
  }
  return { ...base, shortcut: '', code: decision.code ?? 'no-shortcut',
    hint: `${decision.hint || `${name} tidak dikenali · matikan kamera di aplikasi rapat`} (best effort)` };
}
