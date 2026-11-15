# Island Polish: Mic Pill, Glass Themes, Size Slider, macOS Dimensions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate animated mic pill next to the island during meetings, iOS-like Liquid Glass + new Translucent theme with adjustable glass solidity, slider-based island size control (Auto + range), and island default sizes matched to the macOS notch / iOS Dynamic Island proportions.

**Architecture:** All changes live in the existing Electron app at `D:\Project\Aeolia\dynamic-island`. Main process owns geometry (`bounds.ts`, `island.ts`) and settings validation (`settings.ts`); renderer owns mic-pill states and glass CSS variables (CSSOM, since CSP blocks inline styles); settings window owns the slider controls. Probe harness `_qa-features.js` (node, mocked electron) is extended for every main-process decision.

**Tech Stack:** Electron 45 + TypeScript, vanilla DOM/CSS, koffi (untouched), node probe harnesses.

**Spec:** User message 2026-11-15 with 3 reference screenshots:
1. On joining a meeting: small dark capsule with mic icon + pulsing orange dot appears first (image 1), then it becomes a mic capsule SEPARATE from the clock pill — a gap between island and mic pill (image 2). Not joined into one shape.
2. Liquid Glass looks bad vs iOS; add a "Translucent" theme; both themes get a thickness/solidity control (reference: iOS Liquid Glass).
3. The "Otomatis" island-size control must be a slider (scroll-bar style), not number buttons.
4. Island normal size should match macOS (MacBook notch / Dynamic Island proportions).

## Global Constraints

- Responses and UI copy in Indonesian; code comments in English.
- CSP blocks inline style attributes in markup; dynamic values go through CSSOM (`element.style.setProperty`) or `data-*` attributes.
- The 14 px-era mini notch is click-through; its geometry is owned by `boundsFor` (`state === 'mini'` returns stored size, never scaled).
- `merge()` in `src/main/settings.ts` must clamp/validate every new setting (settings.json is user-editable).
- All QA suites must stay green: `_qa-audit` (4), `_qa-settings` (14), `_qa-main` (40), `_qa-ui` (44, run under electron.exe), `_qa-live` (23, under electron.exe), `_qa-features` (extended here).
- No `rm`/script-patch tricks; edit files with the Edit tool.
- Default progress style is 'Wave'; default islandScale is 'auto'.

## Review Focus

- **Mic pill while card is open:** pill-state-only feature; opening the card must remove the mic pill and restore width (test: Island.setMicPill then open()).
- **Meeting ends mid-join-animation:** the "joining" timer must be cancelled when meeting goes false, or a ghost mic pill lingers (test: renderer probe).
- **islandScale arbitrary integers:** slider writes any 75–130 integer; old whitelist must not reject e.g. 108 (test in `_qa-features.js`).
- **Glass level extremes:** 20% must keep text readable (floor), 90% must not become fully opaque black (test: CSS var bounds in renderer probe).
- **Old settings files:** exact old defaults (mini 64×14, pill width 138) migrate to the new macOS-like defaults; genuinely customized sizes must NOT be overwritten (test in `_qa-features.js`).

---

### Task 1: Settings — glassLevel, free-step islandScale, macOS-like size defaults

**Files:**
- Modify: `src/main/settings.ts`
- Test: `_qa-features.js`

**Interfaces:**
- Produces: `Settings.glassLevel: number` (default 55, clamped 20–90); `islandScale: number | 'auto'` now accepts any integer 75–130 (whitelist replaced by clamp); DEFAULTS `mini: { width: 150, height: 32 }`, `pill: { width: 150, height: 36 }`; exported constant `GLASS_LEVEL_MIN = 20`, `GLASS_LEVEL_MAX = 90`.
- Migration inside `merge()`: if `raw.mini` equals the old default `{64,14}` exactly → use new DEFAULTS.mini; if `raw.pill.width === 138` → use new DEFAULTS.pill.width. `merged.pill.height = base.pill.height` already forces the new height.

- [ ] **Step 1: Write failing tests in `_qa-features.js`** — in the validation section replace the step-whitelist block: `{islandScale: 108}` accepted as 108; `{islandScale: 140}` clamped to 130; `{islandScale: 40}` clamped to 75; `{islandScale: 'auto'}` stays 'auto'; `glassLevel` default 55; `{glassLevel: 5}` → 20; `{glassLevel: 99}` → 90; `{mini:{width:64,height:14}}` → 150×32; `{mini:{width:200,height:40}}` kept; `{pill:{width:138,height:28}}` → width 150, height 36; `{pill:{width:160}}` kept 160.
- [ ] **Step 2: Run** `node _qa-features.js` — expect FAIL (property missing / values rejected).
- [ ] **Step 3: Implement** in `src/main/settings.ts`: add `glassLevel` to type+DEFAULTS+merge clamp; replace `ISLAND_SCALES.includes(...)` branch with clamp `Math.min(130, Math.max(75, Math.round(Number(merged.islandScale))))` keeping 'auto' pass-through and the `ISLAND_SCALE_MIGRATE` map before the clamp; update DEFAULTS mini/pill; add the two old-default migrations before spread merge.
- [ ] **Step 4: Run** `node _qa-features.js` — expect PASS.
- [ ] **Step 5: Commit** `feat(island): glassLevel setting, free-step scale, macOS-like default sizes`

### Task 2: Main — mic pill geometry beside the island

**Files:**
- Modify: `src/main/island.ts`, `src/main/bounds.ts`, `src/main/main.ts`
- Test: `_qa-features.js`

**Interfaces:**
- Produces: `Island.setMicPill(active: boolean): void` — when true, pill bounds gain `MIC_PILL_EXTRA = 86` logical px (gap 10 + capsule 76), scaled like the rest of the pill; stored so `boundsFor('pill', ...)` stays the single source of truth. New optional 5th param `micExtra?: number` on `boundsFor`.
- Consumes: extras.ts `isMeeting()` already polled in main.ts pollMeeting.

- [ ] **Step 1: Failing test** — in `_qa-features.js` after the media-pill test: `boundsFor('pill', s, undefined, 138, 86)` returns width `Math.round((138+86)*scale)`; `boundsFor('open', s, 200, 86)` unaffected by micExtra.
- [ ] **Step 2: Run** — expect FAIL (arity mismatch).
- [ ] **Step 3: Implement** `boundsFor` 5th param added to pill width only; `Island.setMicPill` mirrors `setMedia` (store, re-bounds if state==='pill'); in `main.ts` meeting poll: `island.setMicPill(Boolean(meeting) && s.meetingMicButton)`, and push `meeting` + `meetingMicButton` in pushStatus (already there).
- [ ] **Step 4: Run** `node _qa-features.js` — PASS.
- [ ] **Step 5: Commit** `feat(island): reserve room for a separate mic pill during meetings`

### Task 3: Renderer — animated mic pill UI

**Files:**
- Modify: `src/renderer/index.html`, `src/renderer/renderer.ts`, `src/renderer/styles.css`, `src/renderer/global.d.ts` (if new status fields)
- Test: `_qa-ui.js` (electron harness) + manual smoke

**Interfaces:**
- Consumes: `root.dataset.meeting` ('true'/'false'), `root.dataset.meetingMic`, existing mute click handler.
- Produces: `#micPill` layer inside `#island` (sibling of `#pill`), states via `root.dataset.mic = 'off' | 'joining' | 'on'`; CSS animations `mic-pop` (scale-in from the island side), `mic-dot` (orange pulse) in joining, green dot in on, red + slashed mic in muted (`meetingMicBtn.classList 'muted'` logic moves to the new button, id stays `meetingMic`).

- [ ] **Step 1: index.html** — move the `<button class="meeting-mic" id="meetingMic">` out of `#pill` into a new `<div id="micPill" class="layer" hidden>` placed after `#pill`; button gets `<span class="mic-dot">` and `<span class="mic-label">Mic</span>` besides the existing svg.
- [ ] **Step 2: renderer.ts** — replace `updateMeetingMic()`: on meeting rising edge set `data-mic='joining'`, show pill, after 1400 ms setTimeout (id kept in `micJoinTimer`, cleared on meeting falling edge / state!=='pill') set `data-mic='on'`; hide + reset when meeting false or state==='open' (hook into the state dataset write); keep aria-pressed + muted class toggle.
- [ ] **Step 3: styles.css** — `#micPill { position:absolute; top:0; width:calc(76px*var(--zoom,1)); }` anchored `right:0` for center/left positions, `left:0` when `#island[data-pos="right"]`/`right-side`; capsule background dark `rgba(20,24,26,0.92)` like reference; `@keyframes mic-pop { from { transform: scale(.4); opacity:0 } }`; `@keyframes mic-pulse` orange dot; `.meeting-mic.muted svg` adds slash line via `::after` border rotation or extra path.
- [ ] **Step 4: Verify** `env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe _qa-ui.js` — 44/44 plus any new assertions (add one: `#micPill` exists and is hidden by default).
- [ ] **Step 5: Commit** `feat(mic): separate animated mic pill with joining state`

### Task 4: Glass themes — iOS-like Liquid Glass, Translucent, thickness control

**Files:**
- Modify: `src/renderer/styles.css`, `src/renderer/renderer.ts`, `src/settings/settings.ts` (SURFACES + swatch), `src/settings/settings.css` (swatch colors)
- Test: `_qa-ui.js` additions

**Interfaces:**
- Consumes: `settings.glassLevel` (Task 1).
- Produces: CSS var `--glass-a` on `#island` = `glassLevel/100` (written via CSSOM in the same `applyScale`-style function, called on load, onSettingsChanged, and status push); `#island[data-surface="Liquid glass"]` and `#island[data-surface="Translucent"]` use `--glass-a` for their tint alpha; 'Translucent' added to SURFACES at the end (index 15 swatch).

- [ ] **Step 1: styles.css** — rewrite the Liquid glass block: iOS-like = low-alpha dark tint `rgba(18,20,28,calc(0.30 + 0.5*var(--glass-a)))`, bright 1.5px top rim, soft inner sheen, outer shadow; add matching `#island[data-surface="Translucent"]` = light frosted look `rgba(235,238,245,calc(0.25 + 0.55*var(--glass-a)))` with dark-text-safe rules (`.tab` color, `.row` background flip). Both share `#open`, `.tabs`, `.row` overrides — factor into a shared selector list.
- [ ] **Step 2: renderer.ts** — in the function that applies `data-surface`, add `root.style.setProperty('--glass-a', String(Math.min(0.9, Math.max(0.2, (s.glassLevel ?? 55) / 100))))` (also in onSettingsChanged and the initial getSettings path).
- [ ] **Step 3: settings UI** — append `'Translucent'` to SURFACES; swatch `data-si="15"` light frosted gradient in settings.css; when current surface is one of the two glass names, render a slider row `Kekentalan kaca` (`slider('glassLevel', 20, 90, 5, '%')`) on the Appearance page after Theme.
- [ ] **Step 4: Verify** `_qa-ui.js` (add check: choosing Translucent sets `data-surface`) and quick manual CSS read for dark-text contrast on Translucent.
- [ ] **Step 5: Commit** `feat(glass): iOS-like Liquid Glass, Translucent theme, thickness control`

### Task 5: Settings UI — size slider + Auto toggle

**Files:**
- Modify: `src/settings/settings.ts`, `src/settings/settings.css`
- Test: `_qa-settings.js` addition

**Interfaces:**
- Consumes: `islandScale` free-step semantics (Task 1), `settingsApi.screenInfo()`.
- Produces: `Ukuran island` section = a toggle-style row `Otomatis` + `input[type=range]` min 75 max 130 step 5 bound to `islandScale` (writes integer, disabled when Auto on); keep the dynamic note.

- [ ] **Step 1: settings.ts** — replace the `segment('islandScale', ...)` block with: `row('Otomatis', 'Ikuti lebar layar.', toggleFor('islandScale', v => v === 'auto', () => 'auto'))` (reuse existing toggle helper adapted for 'auto') + range input styled like existing `slider()` but writing via `settingsApi.set('islandScale', Number(v))`; slider.value falls back to `screenInfo().autoScalePct` when auto.
- [ ] **Step 2: settings.css** — style the range to look like the reference scroll bar (accent fill via `background: linear-gradient(90deg, accent p%, track p%)` set through JS on input).
- [ ] **Step 3: Verify** `node _qa-settings.js` — add/keep 14+ checks green (segment removal must not break audit's unwired-control scan: grep `_qa-audit.js` for 'islandScale' expectations and update if present).
- [ ] **Step 4: Commit** `feat(settings): slider + Auto toggle for island size`

### Task 6: Full verification, packages, installed update

**Files:** none (verification only)

- [ ] **Step 1:** `npx tsc --noEmit` clean.
- [ ] **Step 2:** `npm run build`, then run all suites: `node _qa-features.js && node _qa-audit.js && node _qa-settings.js && node _qa-main.js`, and under electron: `_qa-ui.js`, `_qa-live.js`. All green, 0 console errors.
- [ ] **Step 3:** `node scripts/build-win.js all` (background); when done, update installed app: stop check (`Get-Process -Name "Aeolia Island"`), backup `resources/app/dist` → `dist-backup-<stamp>`, copy new dist, verify SHA256 of `dist/main/main.js` both sides, grep markers (`setMicPill`, `Translucent`, `glassLevel`).
- [ ] **Step 4:** Smoke: `env -u ELECTRON_RUN_AS_NODE timeout 8 "…/Aeolia Island.exe"` — no errors, note pill bounds include new defaults.
- [ ] **Step 5:** Append memory log; commit remaining; final Indonesian report.
