# Round 4 — Mic/Cam actually work, real notifications, no box shadow, Control Center

Date: 2026-11-15
Repo: `D:/Project/Aeolia/dynamic-island`
Scope: 5 workstreams. Every item below is backed by evidence gathered in
Phase 1, not by assumption.

---

## Evidence summary (Phase 1 results)

| # | User report | Proven root cause |
|---|---|---|
| A | "Pill Mic tidak berfungsi" | `micMute.ts` calls `GetDefaultAudioEndpoint(1, 0)` — capture + **eConsole** role only. Discord/VoIP capture from the **eCommunications** default endpoint. When the two defaults differ, we mute a device Discord never opens. Helper itself is healthy: `muted=false`, exit 0. |
| B | "Pill Cam tidak berfungsi" | `camShortcutFor('discord')` returns `null` (map has only zoom/msteams/teams/meet). `camDecision` then returns `{hint}`, IPC returns `{ok:false}`, and the renderer writes that hint into `button.title` — a tooltip inside a ~39 px window, i.e. invisible. Net effect: click does literally nothing. |
| C | "Notifikasi tidak muncul" | No Windows toast capture exists at all. `pushServiceNotice()` is exported with **zero callers**. Only `watchDownloads()` produces notices, so nothing but file downloads ever banners. |
| D | "Liquid glass ada shadow tipis bayangan kotak" + "notch card ada shadow" | `#island[data-surface=…]` carries `box-shadow: 0 12px 30px rgba(0,0,0,.34)`. The pill window is ~39 px tall, so the 30 px blur is clipped into a hard rectangle. `hasShadow:false` proves it is CSS, not the OS. Same shadow applies to the mini notch card. |
| E | Control panel must match macOS Control Center, bottom row → CPU / RAM / Clear RAM | Current panel is a vertical stack (2 horizontal sliders + stats row + 2×3 button grid). IPC for `stats:get` and `ram:clean` already exists and works. |

Verified enablers:

- `node:sqlite` works **inside Electron 45** (embedded Node 24.22.2), no flag.
- Live `wpndatabase.db` read + byte-array payload decode + `<text>` extraction
  returns real titles/bodies (WhatsApp, WorkBuddy, AAD broker).
- `#micPill .meeting-mic/.meeting-cam { pointer-events: auto }` is present, so
  pointer-events is **not** the click problem — the handler runs and its result
  is simply thrown away.
- `ramClean.ts` already exposes CPU (`GetSystemTimes`) and RAM
  (`MEMORYSTATUSEX`).

---

## A. Microphone: mute the device Discord actually uses

**Change** — `src/main/micMute.ts`

1. `Volume()` takes a role and the C# helper exposes
   `IsMuted(int role)` / `SetMuted(bool, int role)`.
2. Mute/read across **all three roles**: `0 = eConsole`, `1 = eMultimedia`,
   `2 = eCommunications`. Write all three, read the communications one first
   (that is what a call app follows), fall back to console.
3. Treat "endpoint missing for a role" as `continue`, not as failure — a laptop
   with no mic must still return a clean `null`, not a partial write.
4. Keep the existing 8 s timeout and `null`-on-failure contract.

**Change** — `src/main/main.ts`
No signature change; `mic:mute-toggle` keeps returning `boolean | null`.

**Renderer** — `src/renderer/renderer.ts`
On `null`, do not only set `title`; set `root.dataset.micMuted='unknown'` **and**
show the inline hint bubble (shared with B) so the user sees why.

**Probe** — `_probe-mic-roles.js` (pure, no Electron)
- helper source contains roles 0/1/2
- `parseMuteReply` still accepts only `muted=true|false`
- a failing role does not abort the others (simulated executor returns
  `muted=false` for console and `error` for comms → result is still boolean)

**Acceptance** — clicking Mic in a Discord voice channel turns the capsule red
*and* Discord transmits silence. Manual check with `muted` state read back.

---

## B. Camera: stop pretending, start responding

**Change** — `src/main/camToggle.ts`

- Extend `CAM_SHORTCUTS` with every app that genuinely has one
  (`zoom: alt+v`, `msteams|teams: ctrl+shift+m`, `meet: ctrl+e`,
  `webex: ctrl+shift+v`). Discord is **not** added: it ships no camera keybind,
  so sending a combo would be a lie.
- `camDecision(app, focused)` gains a third outcome:
  `{ hint, focus: true }` when the app is known to be a call app but has no
  shortcut, so the caller can bring that window forward.
- New export `camShortcutKnown(app)` for the renderer.

**Change** — `src/main/keys.ts`
Add `focusProcessWindow(processName)` using `user32.SetForegroundWindow` +
`ShowWindow(SW_RESTORE)` on the first top-level window whose PID matches.
Best-effort; returns `false` when nothing matched.

**Change** — `src/main/main.ts`
`cam:toggle` returns `{ ok, hint, focused, shortcut }` so the renderer can tell
"sent" from "focused the app for you".

**Renderer** — `src/renderer/renderer.ts`
- Replace `title`-only feedback with `showIslandHint(text)` — a small bubble
  rendered inside `#island` (the only place a 39 px window can show text).
- Hint auto-hides after 3.2 s, is `aria-live="polite"`, and is also used by A.

**Probe** — `_probe-cam-decision.js`
- Zoom focused → `send: 'alt+v'`
- Discord focused → `hint` present, no `send`
- Discord unfocused → `focus: true`, no `send`
- unknown app → `hint` names the app

**Acceptance** — Zoom: Cam button really toggles the camera. Discord: button
brings Discord forward and shows "Discord tidak punya shortcut kamera · klik
ikon kamera di Discord" — visible, not a swallowed tooltip.

---

## C. Real Windows notifications

**New file** — `src/main/notifications.ts`

- `openDb()` → `new DatabaseSync(%LOCALAPPDATA%\Microsoft\Windows\Notifications\wpndatabase.db, { readOnly: true })`.
  Every query uses `CAST(... AS TEXT)` on `Id`, `ArrivalTime`, `HandlerId`
  (bigint columns) — already proven necessary.
- Query: `Notification n JOIN NotificationHandler h ON h.RecordId = n.HandlerId`,
  `WHERE n.Id > ?`, ordered ascending, capped at 20 per tick.
- `decodePayload(payload)` — handles `Buffer`, `Uint8Array`, XML string, and the
  comma-separated byte string. Returns `''` on anything else.
- `parseToast(xml)` — pulls `<text>` nodes in order → `title` = first,
  `body` = second; HTML-unescapes `&amp; &lt; &gt; &quot; &#39;`; strips
  remaining tags. Returns `null` when both are empty (badge-only toasts).
- `friendlyApp(aumid)` — table for the common AUMIDs
  (`5319275A.WhatsAppDesktop…` → WhatsApp, `WorkBuddy.WorkBuddyAI` → WorkBuddy,
  `Microsoft.AAD.BrokerPlugin…` → Windows, `Microsoft.WindowsStore…` → Store,
  `Discord` → Discord, `Slack` → Slack, `…ZuneMusic…` → Media), else the part
  before `_`/`!` with the publisher suffix trimmed.
- `startNotificationWatch(onNotice)` — first tick records the current max `Id`
  **without emitting** (no replay of history on launch), then polls every
  3 s. `SQLITE_BUSY` / missing DB / locked file → skip the tick silently and
  keep polling; the DB is re-opened on the next tick after an error.
- Self-filter: skip AUMIDs containing `aeolia` so our own notices cannot loop.

**Change** — `src/main/extras.ts`
`pushServiceNotice` stays as the public entry; `registerExtras` starts the
watcher and forwards into the existing `notify` callback (which already calls
`pushNotice` → `broadcast()` → renderer banner queue). No change to the banner
pipeline — it works, it just had no source.

**Change** — `src/main/main.ts`
Start the watcher inside `registerExtras` wiring; stop it in `before-quit`.

**Probe** — `_probe-toast-parse.js`
- byte-array payload decodes to the same XML as a raw XML string
- `ToastText02` → title + body in order
- `&amp;`/`&lt;` unescape
- empty/badge payload → `null`
- FILETIME → ms conversion: `134392295027547510` → `2026-11-15T…` (UTC)

**Acceptance** — send yourself a WhatsApp message or a Windows test toast; the
banner appears within ~3 s with the real app name, title and body, and the row
is added to the Notifications panel.

---

## D. Remove the box shadow (glass + notch)

**Change** — `src/renderer/styles.css`

1. Delete `0 12px 30px rgba(0,0,0,0.34)` from the
   `#island[data-surface="Liquid glass"] / [data-surface="Translucent"]` rule.
   Keep the inset rim/contour lines — those are the glass edge, not a drop
   shadow.
2. Audit every remaining outer `box-shadow` on `#island` and the mini card and
   remove the ones that can be clipped (`#island`, `#mini`, `[data-state="mini"]`
   variants). Inner shadows stay.
3. Compensate for the lost depth with the existing specular rim: bump the top
   inset highlight slightly so the edge still reads as glass on a light
   wallpaper.
4. Same treatment for the notch card so `image#4`'s pointed-box shadow is gone.

**Probe** — extend `_probe-glass-upgrade.js`
- no `box-shadow` on `#island`/`#mini` contains a non-inset offset
  (regex: `box-shadow` blocks whose first token is not `inset` and whose blur
  is > 0)
- the 6 glass layers are still present and unmasked at the rim

**Acceptance** — no rectangular halo around the pill, the card, or the notch on
both a light and a dark wallpaper.

---

## E. Control Center panel (macOS layout, CPU/RAM/Clear RAM)

**Markup** — `src/renderer/index.html`, `data-panel="controls"`

```
<div class="cc">
  <div class="cc-sliders">
    <div class="cc-slider" data-kind="brightness">
      <span class="cc-slider-label">☀</span>
      <input id="brightnessSlider" type="range" min="0" max="100" value="50" />
      <b id="brightnessValue">50</b>
    </div>
    <div class="cc-slider" data-kind="volume"> … same shape … </div>
  </div>
  <div class="cc-tiles">
    <button class="cc-tile" data-settings="ms-settings:network-wifi">…Wi-Fi…</button>
    <button class="cc-tile" data-settings="ms-settings:bluetooth">…Bluetooth…</button>
    <button class="cc-tile" data-settings="ms-settings:nightlight">…Night light…</button>
    <button class="cc-tile" data-settings="ms-settings:quiethours">…Focus…</button>
    <button class="cc-tile" id="muteBtn">…Mute…</button>
  </div>
</div>
<div class="cc-strip">
  <span class="cc-cell"><b id="statCpu">–</b><i>CPU</i></span>
  <span class="cc-cell"><b id="statRam">–</b><i>RAM</i></span>
  <button class="cc-cell cc-action" id="cleanRam">Clear RAM</button>
</div>
```

**Styles** — `src/renderer/styles.css`
- `.cc` = 2-column grid, `grid-template-columns: 78px 1fr`, gap 8 px.
- `.cc-sliders` = `display:flex; gap:8px` — two tall rounded wells
  (`background: rgba(255,255,255,.07)`, `border-radius:14px`, height ~96 px).
- Vertical range: `writing-mode: vertical-rl; direction: rtl;` (Chromium 140 in
  Electron 45 supports this; `appearance: slider-vertical` is not used because
  it is deprecated). Track and thumb restyled to a 6 px rounded rail with a
  14 px circular thumb.
- `.cc-tiles` = `grid-template-columns: repeat(2, 1fr); gap:6px`, tiles are
  rounded squares with icon over label, `.active` state gets the accent fill
  already used by `.chip-on`.
- `.cc-strip` = `display:grid; grid-template-columns: 1fr 1fr 1.2fr; gap:0`,
  one rounded pill split by `border-left` hairlines — the macOS segmented look.
  `#cleanRam` is the third segment, right-aligned, with a 1.5 s "…" busy state.
- All new colours go through existing vars; no hardcoded text colour that breaks
  the light surface.

**Renderer** — `src/renderer/renderer.ts`
- Keep the existing `stats:get` poller; write into `#statCpu` / `#statRam` and
  drive `--cc-cpu` / `--cc-ram` for the tile tint.
- `#cleanRam` → `ram:clean`, disable while running, restore on the pushed notice.
- Slider labels show live value (`#brightnessValue`, `#volumeValue`).
- Remove the now-dead `.toggles`/`.stats`/`.slider` CSS only if nothing else
  references it (grep first — `.chip` is shared).

**Probe** — `_probe-controls.js`
- panel contains exactly 2 vertical sliders, 5 tiles, 3 strip cells
- `#cleanRam` exists and is inside `.cc-strip`
- no `Battery` / `Balanced` / `Performance` strings anywhere in the panel
- vertical slider rule present

**Acceptance** — panel looks like macOS Control Center at 100 % and 130 % scale,
nothing overflows the card, Clear RAM frees memory and posts a notice.

---

## Execution order

1. D (shadow) — smallest, unblocks visual review of everything else.
2. E (Control Center) — biggest visual change, needs D's clean edge to judge.
3. A (mic roles) + B (cam honesty) — shared `showIslandHint`.
4. C (notifications) — independent, highest risk, done last with live testing.

## Verification gate (before deploy)

- `npx tsc --noEmit` clean
- every probe green, including the 5 pre-existing ones
  (`_probe-glass-upgrade`, `_probe-catgap`, `_probe-shell-fullscreen`,
  `_probe-glass-notch`, `_probe-micclick`, `_qa-audit`)
- launch the app, exercise: mic toggle in Discord, cam in Discord + Zoom,
  one real toast, hover/peek, Clear RAM
- `robocopy /MIR` deploy + SHA-256 compare (33+ files)
- append the round to `.workbuddy-ai/memory/2026-11-15.md`

## Out of scope

- A true Windows-wide camera switch (does not exist; per-app shortcuts only).
- Toggling Wi-Fi / Bluetooth / Night light programmatically (needs admin); the
  tiles keep opening the matching Settings page, as today.
