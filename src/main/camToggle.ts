/* Camera toggle for the meeting pill. Windows has no global camera switch a
   normal user process may flip, so the honest lever is the meeting app's own
   camera shortcut, sent only while that app is focused. */

const CAM_SHORTCUTS: Record<string, string> = {
  zoom: 'alt+v',
  msteams: 'ctrl+shift+m',
  teams: 'ctrl+shift+m',
  meet: 'ctrl+e',
  'google meet': 'ctrl+e',
};

/** Pure map: process name -> camera shortcut; null when we do not know one. */
export function camShortcutFor(app: string): string | null {
  const a = String(app || '').toLowerCase();
  for (const [key, combo] of Object.entries(CAM_SHORTCUTS)) {
    if (a.includes(key)) return combo;
  }
  return null;
}

export type CamDecision = { send?: string; hint?: string };

/** Pure decision the IPC handler applies: send the shortcut when the meeting
    app owns the focus, otherwise return an honest hint naming the app. */
export function camDecision(app: string, focusedProcess: string): CamDecision {
  const combo = camShortcutFor(app);
  if (!combo) {
    return { hint: `Kamera dikontrol di aplikasi ${app || 'rapat'} · tidak ada shortcut yang dikenal` };
  }
  const focused = String(focusedProcess || '').toLowerCase();
  if (!focused.includes(String(app || '').toLowerCase())) {
    return { hint: `Fokuskan ${app} dulu, lalu tekan lagi · shortcut ${combo}` };
  }
  return { send: combo };
}
