# Notch Scale + Hover Peek + Mini Banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the mini notch small again, scale its font/cat with the island size setting, expand the island on hover over the notch, and show notification/meeting banners even while in the notch state.

**Architecture:** Pure geometry stays in `bounds.ts` (mini now scales with `effectiveScalePct`). `Island` gains `peek()` (hover expansion, base unchanged) and `setBanner` learns to wake the notch (mini -> pill on show, back to mini on hide). The renderer zooms the `#mini` layer and allows banner show in mini. `miniOpensCard` is removed: hover on the notch now always peeks and arms the card-open timer.

**Tech Stack:** Electron 45 + TypeScript, existing QA harnesses `_qa-features.js` / `_qa-ui.js` / `_qa-main.js`.

**Spec:** User request 2026-11-15: (1) font dan icon kucing sesuai ukuran island, (2) notch kecil, jangan menutupi tab browser, (3) kursor di atas notch -> buka island dan kartu bisa diakses, (4) tiap notif tetap menggerakkan island meski jadi notch (banner meeting/pesan).

## Global Constraints

- Antislop rules active (no em dash in UI copy, honest states, cursor pointer, focus visible).
- Indonesian user-visible copy.
- Keep TDD: update/extend `_qa-features.js` (node mock) and `_qa-ui.js` (electron) per task, RED before GREEN.
- Never break existing suites: AUDIT, SETTINGS, MAIN, UI, LIVE, FEATURES must stay green.
- Electron runs need `env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe`.

## Review Focus

- Custom mini size saved by the user must survive migration (only the exact 150x32 and 64x14 defaults migrate).
- Banner arrives while user is hovering the notch: peek + banner must not fight (banner path wins, hover poll re-peeks if it shrinks).
- Screen scale 75% must not make the notch clip its clock (26 x 0.75 = 20 px tall; clock 10 px fits).
- Leaving the notch after a peek must return to mini (base state untouched by peek).
- Banner queue in mini drains FIFO without duplicating meeting banners on every status push.

---

### Task 1: Notch kecil lagi (mini default 112x26 + migrasi + CSS mini)

**Files:**
- Modify: `src/main/settings.ts` (DEFAULTS.mini, merge migration)
- Modify: `src/renderer/styles.css` (.mini-clock / .mini-date sizes)
- Test: `_qa-features.js` (default + migration checks)

**Interfaces:**
- Produces: `DEFAULTS.mini = { width: 112, height: 26 }`; migration rule `raw.mini === {150,32} | {64,14} -> base`.

- [ ] Step 1 (RED): update `_qa-features.js` size checks: default mini is 112x26; migration `64x14 -> 112x26` AND new `150x32 -> 112x26`; custom `{200,40}` untouched. Run: `node _qa-features.js` expect FAIL.
- [ ] Step 2 (GREEN): settings.ts: `mini: { width: 112, height: 26 }`; in merge() add `if (raw.mini && raw.mini.width === 150 && raw.mini.height === 32) merged.mini = { ...base.mini };`
- [ ] Step 3: styles.css: `.mini-clock` font-size 8px -> 10px; `.mini-date` 7px -> 8px (legible in the 26 px notch; zoom scales them further with islandScale).
- [ ] Step 4: run `_qa-features.js` expect PASS; run `npx tsc --noEmit` clean.
- [ ] Step 5: commit `feat: notch mini kembali kecil (112x26) + migrasi default lama`

### Task 2: Font & ikon kucing ikut skala island (mini diskalakan)

**Files:**
- Modify: `src/main/bounds.ts` (scale mini)
- Modify: `src/renderer/renderer.ts` (applyScale zooms #mini)
- Test: `_qa-features.js` (mini scale checks), `_qa-ui.js` (zoom check)

**Interfaces:**
- Consumes: `effectiveScalePct` (existing).
- Produces: `boundsFor('mini', ...)` returns `{ width: round(stored.width*scale), height: round(stored.height*scale) }`; `#mini` layer gets the same zoom treatment as pill/banner/open layers.

- [ ] Step 1 (RED): `_qa-features.js`: replace "scale 130: notch mini tetap 150x32" with `bigMini.width === Math.round(150*1.3) && bigMini.height === Math.round(32*1.3)`; update `micExtra tidak mengubah notch mini` to expect scaled 195 width (micExtra still ignored). `_qa-ui.js`: after a status emit with `scaleEffective: 130`, `document.getElementById('mini').style.zoom === '1.3'`. Run both, expect FAIL.
- [ ] Step 2 (GREEN): bounds.ts: remove the `state === 'mini' ? 1 :` special case, scale mini size like the others: `: { width: Math.round(stored.width * scale), height: Math.round(stored.height * scale) }`; update the stale 14 px comment.
- [ ] Step 3: renderer.ts: `applyScale()` loop includes `document.getElementById('mini')`.
- [ ] Step 4: run both harnesses expect PASS; `npx tsc --noEmit` clean.
- [ ] Step 5: commit `feat: ukuran notch mini ikut skala island (font & kucing ikut zoom)`

### Task 3: Hover di notch membuka island (peek) + hapus miniOpensCard

**Files:**
- Modify: `src/main/island.ts` (add `peek()`)
- Modify: `src/main/main.ts` (pollHoverZone always peeks + arms hover)
- Modify: `src/main/settings.ts`, `src/renderer/global.d.ts`, `src/settings/settings.ts` (remove miniOpensCard)
- Modify: `_probe-preload.js`, `_qa-main.js`, `_qa-live.js`, `_qa-preload.js`, `_shot-preload.js` (drop the field)
- Test: `_qa-features.js` (new Island peek section), `_qa-main.js` (Bug2 hover rewrite)

**Interfaces:**
- Produces: `Island.peek(): void` — transitions mini -> pill without touching `base`; `close()` still returns to base.

- [ ] Step 1 (RED): `_qa-features.js`: new section builds a fake win (`getBounds`/`setBounds` over a plain object) + Island with `animationMs: 16`; assert `peek()` from mini moves window to pill width and `baseState` stays `'mini'`; `close()` returns to mini bounds. `_qa-main.js`: rewrite Bug2 hover block: mini + hover inside -> `lastStatus().state === 'pill'` (peek) AND a 333 ms hover timer is armed; pill hover unchanged; remove both miniOpensCard cases and its `settings:set` calls. Run, expect FAIL.
- [ ] Step 2 (GREEN): island.ts adds `peek()`; main.ts pollHoverZone inside-branch becomes: `cancelLeave(); if (island.current === 'mini') island.peek(); if (settings.hiddenUntilHover) pushStatus(); armHover();` (drop the miniOpensCard condition).
- [ ] Step 3: remove miniOpensCard from settings type/DEFAULTS/merge boolean list, global.d.ts, and the settings UI row; delete the field from the five preload/QA mock payloads.
- [ ] Step 4: run `_qa-features.js`, `_qa-main.js` expect PASS; `npx tsc --noEmit` clean.
- [ ] Step 5: commit `feat: hover pada notch membuka island (peek) + hapus miniOpensCard`

### Task 4: Banner notifikasi & meeting jalan saat notch (mini wake)

**Files:**
- Modify: `src/main/island.ts` (setBanner wakes the notch)
- Modify: `src/renderer/renderer.ts` (banner allowed in mini)
- Test: `_qa-features.js` (Island banner-from-mini), `_qa-ui.js` (banner shows in mini)

**Interfaces:**
- Consumes: `setBanner(active)` IPC `banner:show` (existing).
- Produces: `setBanner(true)` while mini transitions to pill (window widened by BANNER_EXTRA, scaled); `setBanner(false)` while pill && base mini transitions back to mini.

- [ ] Step 1 (RED): `_qa-features.js` Island section: `setBanner(true)` from mini -> window width becomes `round((150+250)*scale)`; `setBanner(false)` -> back to mini width; base stays mini throughout. `_qa-ui.js`: after the existing banner block drains, emit status `{ state: 'mini' }`, push a fresh notice, assert `dataset.banner === 'true'` and banner layer visible. Run, expect FAIL.
- [ ] Step 2 (GREEN): island.ts setBanner: after storing `bannerExtra`, `if (this.state === 'pill') setBounds(...)` else `if (active && this.state === 'mini') this.transition('pill')` else `if (!active && this.state === 'pill' && this.base === 'mini') this.transition('mini')`. renderer.ts: the three state guards (`showNextBanner` ok-state, renderStatus queued-banner flush, meeting rising edge + notice enqueue) accept `'mini'` alongside `'pill'`.
- [ ] Step 3: run `_qa-features.js`, `_qa-ui.js`, `_qa-live.js` expect PASS; `npx tsc --noEmit` clean.
- [ ] Step 4: commit `feat: banner notifikasi tetap muncul meski island jadi notch`

### Task 5: Build, QA penuh, deploy, push

**Files:**
- Build: `dist/` via `node scripts/build-win.js all`

- [ ] Step 1: full QA: `_qa-features.js`, `_qa-ui.js`, `_qa-live.js`, `_qa-main.js`, `_qa-settings.js`, `_qa-audit.js` all green, 0 console errors.
- [ ] Step 2: `node scripts/build-win.js all`; backup installed dist, copy new `dist/` to `C:\Users\Lycaon\AppData\Local\Programs\Aeolia Island\resources\app\dist`; SHA256 verify.
- [ ] Step 3: smoke run with `ISLAND_OPEN_SETTINGS` unset; verify notch size, hover peek, banner in notch manually via probes.
- [ ] Step 4: ledger update in `.superpowers/sdd/2026-11-15-notch-scale-banner-mini/progress.md`; memory log append.
- [ ] Step 5: `git push origin main`.
