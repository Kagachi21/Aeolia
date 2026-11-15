# Notifications Unheld, Call Detect, Banner, Reply, Buttons, GitHub — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline, established preference in this session). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Notifications always come through (never held), calls auto-detected from any app drive the animated mic pill, notices appear as an animated banner, the notice card gains inline reply + open-app, card buttons get an elegant restyle, and the project is pushed to GitHub.

**Architecture:** Same Electron app. Detection lives in `extras.ts` (pure matcher exported for probes). Banner reuses the mic-pill widening pattern (`Island.setBanner` + `boundsFor` extra). Reply is honest: clipboard + deep-link open (Windows exposes no toast reply API).

**Tech Stack:** Electron 45 + TypeScript, vanilla CSS, node probe harnesses, git/GitHub.

**Spec:** User message 2026-11-15 10:07 with 4 screenshots:
1. "Rapat terdeteksi · whatsapp.root — Notifikasi ditahan" shown while NOT in a meeting → notifications must never be held, meeting or not.
2. Any app's Voice/Video Call must pop the mic pill with the join animation; the cat moves "going to a meeting" style; then clock pill + separate green Mic pill (already built — keep), mute from the island (already built).
3. A "Meeting mode" banner (round avatar, bold title, body, "sekarang") appears on meeting start; new notices appear as animated banners; the full list lives in the notifications card.
4. Notice card: round avatars, title + body + relative time, "N notices / Clear all"; direct reply for WhatsApp/Telegram-like chats; click opens the app. Plus: restyle card buttons elegantly. Push to https://github.com/Kagachi21/Aeolia.git.

## Global Constraints

- UI copy Indonesian, code comments English; CSP blocks inline styles (CSSOM/data-attrs only).
- No notification may ever be dropped for meeting reasons (spec: "mau sedang meeting atau tidak jangan di hold").
- WhatsApp/Telegram/LINE/Signal running alone must NOT count as a meeting (the whatsapp.root false positive); only call-context titles do.
- Reply flow must be labelled honestly (teks disalin + aplikasi dibuka) — no fake "sent" state.
- All suites stay green: AUDIT 4, SETTINGS 14, MAIN 40, UI (electron), LIVE (electron), FEATURES.
- Git identity: local config `Kagachi21` + `Kagachi21@users.noreply.github.com`; remote exists with a `master` branch — inspect before pushing; prefer a new `main` branch over force-pushing.

## Review Focus

- **Notice flood while banner shows:** a rapid burst must queue, not overlap or leak timers.
- **Meeting rising edge while the card is open:** banner must be skipped (svc-bar already covers it) and the window must not widen in open state.
- **Chat app false positives:** "Telegram" in the taskbar title alone must not start Meeting mode (test in probes).
- **Reply on unknown app:** reply box only for chat protocols; unknown apps get open-only rows.
- **Push safety:** never force-push `master`; inspect the remote commit first.

---

### Task 1: Never hold notices + call-context detection

**Files:** Modify `src/main/extras.ts`, `src/main/main.ts`; Test `_qa-features.js`

**Interfaces:** Produces exported `matchesCall(label: string): boolean` (pure); `ExtrasState.meeting` unchanged for consumers. `shouldHoldNotice` deleted; main.ts notice callback pushes unconditionally.

- [ ] Step 1 RED: probe requires `./dist/main/extras.js`; `matchesCall('WhatsApp - keren')` false; `matchesCall('Discord | Wibverse 3.0')` true (meeting app window); `matchesCall('Zoom Meeting')` true; `matchesCall('Telegram')` false; `matchesCall('Voice call with Bila')` true; `matchesCall('Panggilan video WhatsApp')` true.
- [ ] Step 2: run, expect FAIL.
- [ ] Step 3 GREEN: rewrite pollMeeting — chat apps (whatsapp|telegram|line|signal) removed from MEETING_APPS; detection = MEETING_APPS(apps) OR CALL_WORDS /(voice|video)[ -]?(call|chat)|incoming|outgoing|ringing|in call|panggilan|meeting|rapat|meet\.google/i on any window title. Delete shouldHoldNotice; main.ts pushes unconditionally; svc-bar copy becomes "Meeting mode · {app} aktif. Notifikasi tetap masuk."
- [ ] Step 4: run probe + `_qa-main` + `_qa-audit` (audit scans unwired settings; hold had no setting, safe).
- [ ] Step 5: ledger (no git yet — Task 7 initializes).

### Task 2: Banner geometry — Island.setBanner

**Files:** Modify `src/main/bounds.ts`, `src/main/island.ts`, `src/main/main.ts`; Test `_qa-features.js`

**Interfaces:** `boundsFor(..., micExtra?, bannerExtra?)` (6th param, pill only); `Island.setBanner(active: boolean)` adds `BANNER_EXTRA = 250`; IPC `banner:show` (bool) → island.setBanner.

- [ ] Step 1 RED: `boundsFor('pill', s, undefined, undefined, 0, 250)` width = (150+250)*scale; open/mini unaffected.
- [ ] Step 2: FAIL.
- [ ] Step 3 GREEN: mirror Task-2-of-previous-plan pattern; wire IPC.
- [ ] Step 4: probe PASS.
- [ ] Step 5: ledger.

### Task 3: Banner UI + cat call animation

**Files:** Modify `src/renderer/index.html`, `renderer.ts`, `styles.css`; Test `_qa-ui.js`

**Interfaces:** `#banner` layer (sibling of #pill, in the widened area, `hidden` by default); renderer `bannerQueue: {app,title,body,tone}[]`, 4200 ms per item; triggers: meeting rising edge (tone 'meeting', body `${app} · notifikasi tetap masuk`) and new top-notice id in onState (tone 'notice'); skipped when `data-state!=='pill'`; `root.dataset.callAnim='true'` for 2400 ms on meeting edge (CSS cat hop). `applyScale` includes #banner.

- [ ] Step 1 RED (_qa-ui): emit status meeting:true → `#banner` visible with tone=meeting, data-call-anim=true; after 4.4s hidden; emit card with a new notice → banner tone=notice; banner layer hidden in state 'open'.
- [ ] Step 2: FAIL.
- [ ] Step 3 GREEN: index.html banner markup (avatar+title+body+sekarang); renderer queue + timers; CSS slide-down pop, meeting tone green like reference, notice tone neutral; cat hop keyframes; reduced-motion off.
- [ ] Step 4: `_qa-ui` PASS.
- [ ] Step 5: ledger.

### Task 4: Notice card — inline reply + open

**Files:** Modify `src/main/main.ts`, `src/preload/preload.ts`, `src/renderer/global.d.ts`, `renderer.ts`; Test `_qa-features.js` + `_qa-ui.js`

**Interfaces:** IPC `notice:reply` (app, body, text) → clipboard.writeText(text) → same protocol map as notice:open → returns `{opened:boolean}` via `ipcMain.handle`; api `noticeReply(app, body, text): Promise<{opened:boolean}>`; chat apps set = keys of NOTICE_PROTOCOLS except gmail.

- [ ] Step 1 RED: features probe invokes handler 'notice:reply' → externalOpens gets protocol AND clipboard mock recorded text; unknown app returns {opened:false}.
- [ ] Step 2: FAIL.
- [ ] Step 3 GREEN: handler + preload + types; renderer: rows for chat apps get a reply toggle → inline input + kirim button; on send calls api, then row note "Teks disalin — tempel di chat aplikasinya."; hint text updated; open-on-click unchanged.
- [ ] Step 4: probes PASS (add _qa-ui check: reply input appears for WhatsApp row).
- [ ] Step 5: ledger.

### Task 5: Elegant card buttons restyle

**Files:** Modify `src/renderer/styles.css` (+ minor index.html classes if needed); Test `_qa-ui.js` a11y check stays green

- [ ] Step 1: unified `.chip, .clip-act, .mt-btn, .svc-bar button, .clear-all, .tab-arrow` pill style: shared border-radius, hover lift (translateY(-1px) + shadow), active press, focus-visible accent ring, disabled dim. No dead controls.
- [ ] Step 2: `_qa-ui` (a11y + console) PASS; visual sanity via styles review.
- [ ] Step 3: ledger.

### Task 6: Full QA + packages + installed update

- [ ] tsc, build, all suites; `node scripts/build-win.js all` (background); backup + copy dist to installed app; hash verify; smoke run.

### Task 7: Git init + push to GitHub

**Files:** Create `.gitignore` in `dynamic-island/`

- [ ] Inspect remote: `git ls-remote` done (master @ 3962c29); fetch and `git ls-tree master --name-only` to see what's there before deciding.
- [ ] `git init -b main`; local identity `Kagachi21` / `Kagachi21@users.noreply.github.com`; `.gitignore`: node_modules/, dist/, dist-release/, msix-staging/, .superpowers/, _archive output none. QA scripts `_qa-*.js` and `_probe-*.js` ARE committed (they are the test suite).
- [ ] Commit all source; if remote master is just an init/README commit, push local main as `main` (no force); report that GitHub default branch may need switching in the web UI.
- [ ] Verify: `git log --oneline -1`, `git status` clean, `git ls-remote` shows the new branch.
