# Island Content & Island Behavior — Native Content Parity inventory

**Wayfinder ticket:** #2 (`Research: Inventory Island Content and Island Behavior`), child of map #1.
**Question answered:** What exact Island Content and Island Behavior exist in the current working tree and must be preserved under Native Content Parity (ACDR-0002)?

## Scope, vocabulary, and method

- **Vocabulary** follows `GLOSSARY.md` (read from the main working tree; the research branch was cut before those docs were added): *Island Content* = text/data/status/controls shown on the Dynamic Island; *Island Behavior* = how it reacts to clicks, drag, state changes, notifications, and settings; *Pill* / *Expanded Mode* are the two visible shapes; *Native Content Parity* = same content + behavior, **not** pixel parity.
- **Binding decisions:** ADR-0001 (full native replacement), ADR-0002 (source of truth = current working tree; content+behavior parity), ADR-0003 (user-supplied HLSL is the glass source of truth; repository has no HLSL). Repo-specific agent conventions from `docs/agents/*`.
- **Source of truth:** the committed tree at `8d2246c`, read in this worktree (`D:/Project/Aeolia/_worktrees/inventory-island-content`, branch `research/inventory-island-content`). The main tree `D:/Project/Aeolia/dynamic-island` has only uncommitted CSP `connect-src` additions in `src/renderer/index.html` and `src/settings/settings.html` plus untracked tooling/probes; those are implementation/security details, not content or behavior, so they do not change this inventory. `src/main/desktopGlass.ts` exists only untracked in the main tree and is a capture implementation detail.
- **Method:** primary-source reading of `src/main`, `src/renderer`, `src/settings`, the preload bridges, and `dist/settings/settings.html`. `dist/settings/settings.html` is byte-identical to `src/settings/settings.html` apart from the CSP line. CSS contains no generated text (`content:` scan clean). Probes (`_probe-*`, `_qa-*`) exist as behavioral test seams but were not needed to derive the inventory; they corroborate contracts noted below.
- **Implementation detail deliberately excluded** (per ticket): Win32/koffi call mechanics, Electron BrowserWindow flags, PowerShell helper internals, CSS recipes. Behavior outcomes are included.

All line pointers are worktree-relative (`src/...:line`).

---

## 1. Island states, shape, and anchoring (behavior)

**State machine** (`src/main/island.ts:5`, `src/main/bounds.ts:4`, `src/renderer/global.d.ts:4`):

- Three states: `mini` (compact notch), `pill` (compact summary), `open` (Expanded Mode card). A separate *base* state (`mini` | `pill`) is remembered so a hover-peek or banner can temporarily leave the notch and return (`src/main/island.ts:10-18,154-178`).
- `mini → pill` on peek (cursor over notch) or banner; `pill → open` on click / hover timer / hotkey / `island:open` IPC; `open → base` on close (`src/main/island.ts:164-190`; `src/main/main.ts:206-215,461-468,609-610`).
- Ease-out bounds animation over `animationMs` (default 250 ms; settings offer Relaxed 400 / Normal 250 / Quick 120) (`src/main/island.ts:196-213`; `src/settings/settings.ts:920-922`).

**Mini-notch trigger** — when the island shrinks (`src/main/main.ts:380-441`):

- `miniMode` values: `off`, `hide`, `clock`, `clock-date`, `cat` (`src/main/settings.ts:59`; UI names at `src/settings/settings.ts:926-932`).
- `miniTrigger`: `fullscreen`, `busy`, `maximized` (default `fullscreen`). "Busy" = browsers with ≥ 8 tabs (`BROWSER_TAB_THRESHOLD`, `src/main/activeWindow.ts:316-328`) or Word/Excel/PowerPoint (`src/main/activeWindow.ts:299-310`). Desktop shell windows and merely-maximized windows never count as fullscreen (`src/main/activeWindow.ts:89-124`).
- `mediaMiniBehavior`: `keep` (pill stays while media plays), `mini` (shrink), `hide` (shrink + transparent until hover) (default `mini`; `src/main/settings.ts:63,167`; `src/main/main.ts:419-434`). Fullscreen always wins over media.
- `word` flag: `true` when foreground process is `winword`, pushed to renderer (`src/main/main.ts:436-440`).

**Placement / anchor** (`src/main/bounds.ts:77-140`; UI `src/settings/settings.ts:901-916`):

- `islandPosition`: `left | center | right | left-side | right-side` (default `center`); `edgeMargin` (0–40 px, default 4); `monitor: main | cursor` (default `main`).
- `islandStyle`: `dynamic` (floating gap) or `notched` (flush to top edge) (`src/main/bounds.ts:122-125`).
- `islandScale`: `auto` (screen width / 1920, clamped 75–130%) or fixed steps 75/90/100/115/130 (`src/main/bounds.ts:17-27`; UI slider 75–130 step 5 at `src/settings/settings.ts:816-882`). All states including the notch scale together.
- Geometry constants: `MIC_PILL_EXTRA = 172`, `BANNER_EXTRA = 250` logical px widen the pill for capsules/banner (`src/main/bounds.ts:29-35`). Open-card height follows measured panel content clamped to 72–420 (`src/main/island.ts:103-109`; `src/renderer/renderer.ts:981-1008`).

**Drag** (`src/renderer/renderer.ts:1474-1514`; `src/main/island.ts:70-101`; `src/main/main.ts:612-635`):

- Frameless window; JS drag: `pointerdown` on island body starts gesture (excluded targets: `button, input, select, textarea, a, .tabs, .panels, [data-no-drag], #micPill`), deltas sent to main which calls `setBounds` clamped to active display; final `islandOffset` persisted to settings. A drag suppresses the click-to-open that follows it (`dragJustMoved`, `src/renderer/renderer.ts:174-191,1506-1512`). Dragging suspends hover-open and pointer IPC (`src/main/main.ts:488-490,545-547`).

**Click-through** (`src/main/main.ts:356-368`; `src/main/main.ts:131-132`):

- Window is **click-through only in `mini`** (`win.setIgnoreMouseEvents(true, {forward:true})`); pill and open receive clicks. Always-on-top at `screen-saver` level, visible on all workspaces including fullscreen, frameless, transparent, not focusable, skipped from taskbar (`src/main/main.ts:100-134`). Clicking the notch/pill body opens the card (`src/renderer/renderer.ts:178-191`).
- A cursor zone is polled every 80 ms because the gap between screen top and a floating island belongs to no window: horizontal island ±6 px, from display top to island top; resting there peeks then hover-opens (`src/main/main.ts:470-543`). `micHot` (pointer on Mic/Cam capsule) and the mic strip rectangle are excluded so clicks reach the capsules (`src/main/main.ts:61-64,511-522`; `src/renderer/renderer.ts:404-413,499-504`).

**Hover/timing** (`src/main/main.ts:443-468,537-542`; `src/settings/settings.ts:746,755,917-922`):

- `openDelayMs` (default 150), `openDelayBusyMs` (default 400), `hoverIdleResetMs` (default 60), `hiddenUntilHover` (default false), `animationMs`, `pollIntervalMs` (default 500). A passing cursor never opens; every move restarts the wait.

---

## 2. Pill / notch content (Island Content)

The `#island` root carries the state/contract attributes (`src/renderer/index.html:76`): `data-state`, `data-island-style`, `data-island-content`, `data-cat-pos`, `data-cat-rail`, `data-greeting`, `data-mini-mode`, `data-mic`.

- **Notch layer** `#mini` (`src/renderer/index.html:96-100`): cat slot, `#miniClock`, `#miniDate`. `miniMode` selects clock / clock+date / cat / hidden; date format `d MMM` via `id-ID` (`src/renderer/renderer.ts:305-312`).
- **Pill layer** `#pill` (`src/renderer/index.html:102-113`): `#pillCatSlot`, `#mediaBox` (`#mediaText`/`#mediaTrack`, `#mediaLyric`, `#mediaViz` with four `<i>` bars), `#clock` (`HH:MM`), `#battery`.
- **Bar order** — five reorderable tokens `clock | cat | battery | media | mic` (default `['clock','cat','battery','media','mic']`), persisted as `barOrder`, reordered by ↑/↓ in Settings or by dragging tab icons; hidden items keep their rank; cat sits on left rail when first in saved order, otherwise right rail (left rail also when media plays) (`src/renderer/renderer.ts:103-154`; `src/main/settings.ts:39,144,323-328`; `src/settings/settings.ts:44-50,788-790`).
- **`islandContent`** modes (`src/main/settings.ts:36`; UI `src/settings/settings.ts:781-786`): `clock-battery` (Clock + Battery), `clock-robot` (Clock + Robot, default), `robot-only` (Robot only). Controls which tokens are shown (`src/renderer/renderer.ts:116-124`).
- **Battery text** (`src/renderer/renderer.ts:806-821`): `AC` when percent > 100 (no battery), else `<percent>%`; expressive states `ok | low (<10%) | full (>=95%)`, red under 10%/green when full or charging (when `robotBatteryExpressions`).
- **Cat/robot** (artwork `src/renderer/index.html:13-52`): settings `robotEyeColor` (7 palette entries), `robotAccessory` (`none|glasses|hat|headphones`), `robotEyeMovement` (`relaxed|cursor`), `robotIdleOnly`, `robotIdleAfterMs` (5–120 s, default 30 s), `robotBatteryExpressions`, `robotHoldsItems`, `catGreeting`, `catIdleCenter` (`src/main/settings.ts:49-58,154-165`; UI `src/settings/settings.ts:885-900`). Idle/battery/pointer sampled every 200 ms with stable-tick debounce (`src/main/main.ts:85-98,294-354`). **Greeting**: a purely visual 1.5 s wink from centre to right rail, armed on each launch (not input-gated, cat is `pointer-events:none`); `greetingSeen` is written but *no longer suppresses* it (`src/renderer/renderer.ts:688-771`) — see **Unknowns**.
- **Media marquee** (`src/renderer/renderer.ts:314-332`): track title duplicated only when it overflows; scroll speed class short/medium/long; pill widens to 264 px while playing (`src/main/island.ts:111-117`).

---

## 3. Expanded Mode — panel inventory (Island Content + Behavior)

Tabs declared in `src/renderer/index.html:127-186`; canonical token list `TABS` in `src/renderer/renderer.ts:875-879`; default visible tabs `['web','notifications','shelf','clipboard','music','today','controls','panels']` (`src/main/settings.ts:127-130`). Pinned (non-reorderable) controls: grid button `panels`, clock `openClock`, Settings gear; tab strip has left/right overflow arrows and drag-to-reorder (`src/renderer/renderer.ts:897-974`). Settings opens a separate window, not a panel (`src/renderer/renderer.ts:1010-1016`).

Each tab's content and behavior:

1. **Web** — site buttons from `card.sites` (defaults: YT Music, YouTube, Spotify — `src/main/store.ts:36-40`), open via `shell.openExternal` (http/https only, `src/main/main.ts:762-764`); `+ Add a site` form with Nama / URL / Simpan (`src/renderer/index.html:189-196`, logic `src/renderer/renderer.ts:1055-1079,1355-1363`).
2. **Notifications** — service bar with dot + text + `Lanjutkan musik` / `Abaikan`, count `<n> notices`, `Clear all`, hint text (`src/renderer/index.html:198-208`; text at `src/renderer/renderer.ts:1091-1155`). Notification rows: avatar initial + stable HSL hue per app, title, body, relative time (`now/m/h/d`), **open source app** on click and **Balas** (reply) button; feedback lines are honest (`Membuka <app>.`, `Perintah dibuka diterima Windows · cek jendela aplikasi`, `Aplikasi tidak dapat dibuka.`). Windows cannot reply inline; Balas opens the app (`src/main/noticeLaunch.ts:1-3,196-215`).
3. **Shelf** — `Drop files here` drop zone + list of files (name, KB size, relative time); empty text `Shelf kosong. Seret file ke area di atas.` (`src/renderer/index.html:210-213`; `src/renderer/renderer.ts:1158-1180,1368-1385`). Max 24 entries (`src/main/store.ts:63`).
4. **Clipboard** — count `<n> item`, `Clear`, hint about copy/paste; text-only history (max 24), rows with `Salin` (copy to clipboard) and `Tempel` (copy + send Ctrl+V to focused app) with transient feedback `Tersalin`/`Ditempel`/`Gagal` (`src/renderer/index.html:215-219`; `src/renderer/renderer.ts:1182-1258`; `src/main/systemControl.ts:53-60`).
5. **Music** — album-style card: title (`Tidak ada lagu` fallback), sub (`Putar musik di pemutar mana pun` / `Pemutar media`), prev/play/next, progress strip with six styles `Wave|Pixels|Comet|Song shape|Simple|Hearts`, times `0:00` / `-MM:SS` tied to the **lyric** timeline, volume slider; Lyrics head with `Belum ada lirik` / `<n> baris · LRC|teks polos`, badge `Berhenti|Jeda|Berputar`, `Mulai|Jeda|Lanjut`, `Ulang`, rate `1,0×`, and a hint about pasting LRC in Settings (`src/renderer/index.html:221-279`; `src/renderer/renderer.ts:1547-1703`). See §6 for lyrics/audio.
6. **Today** — Indonesian-month calendar (Monday-first), national fixed holidays (Tahun Baru Masehi, Hari Buruh, Hari Kebangkitan Nasional, Hari Lahir Pancasila, HUT Kemerdekaan RI, Libur Natal), agenda text `Tidak ada acara.` / holiday + countdown, `Hari libur keagamaan mengikuti kalender resmi.`, weather + next iCal event extras, Tasks list with `No tasks yet`, `Add a task...`, `Add`, count `<n> tugas` (`src/renderer/index.html:280-305`; `src/renderer/panels.ts:6-89,780-810`; `src/renderer/renderer.ts:1301-1319,1393-1400`).
7. **Sholat** — astronomical prayer times (Fajr 20°, Isha 18°, +2/+3 min ihtiyat) for 9 cities (Jakarta, Bandung, Surabaya, Yogyakarta, Semarang, Medan, Makassar, Denpasar, Banda Aceh); names Subuh/Dzuhur/Ashar/Maghrib/Isya, next-time countdown `XjYm lagi` / `Xm lagi`, moon/sun glyph, optional Imsak (−10 min) & Iftar markers, city `<select>`, date; modes `prayer` (5 times), `other` (user schedule any religion, empty text `Belum ada jadwal. Tambahkan di Settings > Worship.`), `off` (tab hidden, switches to Today) (`src/renderer/index.html:306-329`; `src/renderer/panels.ts:105-220,483-586`; `src/settings/settings.ts:1006-1029`).
8. **Timer** — chips `1 min / 5 min / 10 min / Stop`, `Nothing running yet` / `M:X:SS tersisa` (`src/renderer/index.html:330-339`; `src/renderer/renderer.ts:1321-1325,1402-1416`).
9. **Reminders** — "Eye break reminder" (`Istirahatkan mata secara berkala`), badge `Aktif|Mati`, On/Off, 20/30/45/60 min chips, `Alarm menyala`, `Try now`, countdown `Pengingat berikutnya dalam M:SS · lihat jauh 20 detik.`; fires a notification + 740 Hz double beep and a 2.6 s "ringing" class (`src/renderer/index.html:340-357`; `src/renderer/panels.ts:227-307,874-894`).
10. **Water** — "Water reminder" (`Minum teratur sepanjang hari`), badge `Aktif|Mati`, `<n> dari 2L`, `+140 ml`, schedule `N kali sehari, sekitar Y ml · HH.MM–HH.MM`, steppers Goal (0.5–5 L)/Start/Until/Every (15–180 min), `Test`, `Bunyi` checkbox, `Aktifkan|Matikan`; daily reset by `waterDay`; notification + beep (`src/renderer/index.html:358-377`; `src/renderer/panels.ts:309-374,841-894`).
11. **Capture** — `Ctrl+Shift+S` hint, tiles Full screen / Area / Window / Record screen, status `Hasil disimpan ke Pictures/Aeolia`, `Buka folder` (`src/renderer/index.html:378-393`; `src/renderer/panels.ts:376-481,812-819`; `src/main/capture.ts:71-224`). Record uses renderer `getDisplayMedia` + `MediaRecorder` (WebM VP9/VP8), optional mic narration with honest denial message; area overlay hint `Seret untuk memilih area · Esc untuk batal` (`src/renderer/capture-overlay.html:9,18`).
12. **Controls** (Control Centre) — brightness & volume wells with live values, Wi-Fi / Bluetooth / Night light / Focus tiles (open `ms-settings:`), Mute tile, strip CPU% / RAM `x.y/Z GB` / `Clear RAM` → `Cleaning...` → `<n> MB freed`, DDC/CI brightness note (`src/renderer/index.html:398-455`; `src/renderer/renderer.ts:823-865,1418-1456`; `src/main/ramClean.ts:81-112`; `src/main/systemControl.ts:62-119`).
13. **Deck** — placeholder: `Deck belum dibangun: butuh penghubung ponsel.` + button opening `ms-settings:mobile-devices` (`src/renderer/index.html:457-460`).
14. **Calls** — `Speaker & Microphone`, `Test speaker`, hint that device list needs COM audio; opens `ms-settings:sound`; test plays a 660 Hz tone (`src/renderer/index.html:462-468`; `src/renderer/renderer.ts:1458-1472`).
15. **panels** (grid tile, pinned) — one tile per tab with icon + capitalized label + Settings tile (`src/renderer/renderer.ts:1260-1299`).
16. **settings** (gear tile, pinned) — opens the Settings window (`src/renderer/index.html:183-185`).

Tab click/drag, height re-measure on content changes, and last-tab persistence (`state.lastTab`) are in `src/renderer/renderer.ts:897-1043,1327-1353`.

---

## 4. Banner, service bar, and meeting capsules (behavior + text)

**Banner** (`src/renderer/renderer.ts:506-606`): FIFO queue, each item shown 4.2 s with 350–400 ms gap, only in `pill` state (queued otherwise); widening the pill via `banner:show`; `bnAvatar` = initial + stable hue, title, body; auto-hides on `open`. In `open` state the same message uses a reserved `#openHint` strip (`src/renderer/index.html:117-123,126`; `src/renderer/renderer.ts:571-606`). Top notice becomes a banner on state snapshots (first snapshot absorbed silently) (`src/renderer/renderer.ts:1327-1342`).

**Meeting banner** on rising edge: `{app, title:'Meeting mode', body:'<app> · notifikasi tetap masuk'}` + 2.4 s call animation (`src/renderer/renderer.ts:660-668`).

**Service bar** (`#svcBar`, `src/renderer/renderer.ts:608-637`): shown when meeting/offline/resume-offer; text `Internet terputus, beberapa layanan tertunda.` / `Meeting mode · <app>. Notifikasi tetap masuk.` / `Kembali online. Lanjutkan musik?`; `Lanjutkan musik` plays + dismisses, `Abaikan` dismisses.

**Mic/Cam capsules** (`#micPill` outside `#island`, `src/renderer/index.html:474-489`; `src/renderer/renderer.ts:364-504`): shown only while meeting + pill + `meetingMicButton`; `joining` animation 1.4 s then `on`, then 6 s Core-Audio poll. Mic label `Mic`, title `Bisukan mikrofon`/`Buka bisukan mikrofon`; failure hints `Mikrofon tidak bisa dikontrol · cek izin aplikasi`, `Core Audio menolak akses ke mikrofon (COM error)`, etc. Cam label `Cam`, click runs `camToggle` and shows a hint; three modes `shortcut|privacy|both`, honest `verified|unverified` state (`src/main/camToggle.ts:83-166`; `src/main/cameraPrivacy.ts:87-121`; `src/main/micMute.ts:1-18,206-231`).

---

## 5. Notifications, extras, and OS integrations (data sources)

- **Toast capture**: reads `%LOCALAPPDATA%\Microsoft\Windows\Notifications\wpndatabase.db` read-only via `node:sqlite`, high-water mark on first poll (no history replay), XML `<text>` first=title/second=body, friendly app names for WhatsApp/Discord/Telegram/Slack/Spotify/Teams/Zoom/etc., own notices filtered (`src/main/notifications.ts:1-18,96-152,166-248`).
- **Meeting detection**: window titles (dedicated conferencing apps + explicit call phrases) **plus** live麦克风 capture sessions from Core Audio; chat apps (Discord/Slack/WhatsApp/Telegram) count only when foreground with explicit call title, with a 15 s grace window; `meetingIgnoreApps` excludes both; not gated by `meetingAuto` off (`src/main/extras.ts:24-146,186-233`).
- **Network extras**: online check via `https://www.google.com/generate_204` (15 s); weather from Open-Meteo (10 min, city from `prayerCity`, `Cerah|Berawan|Hujan`); iCal feed via `calendarIcalUrl` (10 min, reads `DTSTART`/`SUMMARY`, max 40 events); all failures keep their own error string and never stop the island (`src/main/extras.ts:237-329,366-381`).
- **Downloads**: watches `~/Downloads`, non-`.crdownload`/`.tmp` files, setting `notifyDownloads` (`src/main/extras.ts:331-345`).
- **Resume offer**: after lock/suspend > 5 min with `notifyResumeMusic`, offer `Musik / Lanjutkan musik?` (`src/main/extras.ts:384-392`; `src/renderer/renderer.ts:633-637`).
- **Media detection**: window titles only (no SMTC read). Known players set (`spotify.exe`, `music.ui.exe`, `foobar2000`, `vlc`, `aimp`, `wmplayer`, `itunes`, `tidal`, `deezer`, `youtube music`, `applemusic`, `qobuz`) and service-marker parsing (`src/main/media.ts:1-57`). Polled every 2 s (`src/main/main.ts:596-597`).
- **Media shortcuts**: global `hotkeyOpen` (default `Ctrl+Alt+N`) toggles open/close, `hotkeyPlayPause` (default `Ctrl+Alt+P`), optional `Ctrl+Shift+S` capture area (`captureShortcut: default|off`) (`src/main/main.ts:198-216`; `src/main/settings.ts:46-47,96,151-152`). Media keys VK_MEDIA_* sent via `keybd_event` (`src/main/keys.ts:8-35`).
- **Clipboard history**: polled every 900 ms, text only, max 24, own writes suppressed via `lastClip` (`src/main/main.ts:808-815`; `src/main/store.ts:61,151-160`).
- **Single instance**, `runAtStartup` login item, portable data folder (`<exe>/data`) support, single-instance focus (`src/main/main.ts:30-47,565-566`).

---

## 6. Audio, lyrics, and extras detail

- **Lyrics**: auto-fetched once per new playing track from `lrclib.net` (`/get` then `/search`, synced LRC preferred, plain text fallback), cached per artist/title (`src/main/lyrics.ts:1-63`). Renderer parses LRC timestamps `[mm:ss.xx]`, multiple stamps per line, metadata lines `[ar:]/[ti:]/[offset:]` ignored, plain text scrolls one line per 4 s (`src/renderer/panels.ts:621-707`). Playback state `Berhenti|Jeda|Berputar`, speed 0.5–2× and offset ±5 s applied live, 200 ms paint tick; auto-LRC resets and starts the timeline without the manual `Mulai` click (`src/renderer/panels.ts:709-778,896-898`). Pill lyric line shown only in pill, when `pillLyrics`, while playing (`src/renderer/renderer.ts:1692-1698`).
- **Music card colour**: iTunes Search API → 300 px artwork → three dominant colours in main → deep palette (hue preserved, saturation ≥ 0.70, lightness 0.22–0.32); deterministic six-palette `g0..g5` fallback per title when offline/unknown; only 3 hex strings cross IPC (`src/main/musicColors.ts:1-8,110-131,183-250`; `src/renderer/renderer.ts:1571-1618,1638-1665`).
- **Audible cues** (all WebAudio unless noted): 740 Hz double beep for eye/water alarms; 660 Hz speaker test; adhan from a user-picked file (mp3/wav/ogg/m4a/flac) with volume 0–100 and a short beep when Fajr recitation is opted out or no file is set (`src/renderer/panels.ts:227-258,592-619`; `src/renderer/renderer.ts:1458-1472`; `src/main/extras.ts:401-405`).
- **Worship reminders**: one-shot per slot per day; optional `Waktu ibadah` notification, pause music, adhan (`src/renderer/panels.ts:588-619`).

---

## 7. Settings content (12 pages)

Shell: sidebar brand Aeolia + robot svg, search `Cari pengaturan`, footer `Aeolia Island 1.2.5`, header `Settings` + close (`src/settings/settings.html:10-27`). Pages, in order, with their controls (`src/settings/settings.ts:6-7,737-1049`):

1. **General** — Run at startup, Poll interval (200–1500 ms), Slim strip under maximized windows, Hidden until hover, When the island opens (`Last tab|Music`), Hover grace (0–600 ms).
2. **Appearance** — live preview; Island style (`Dynamic|Notched`); 16 themes (`Black, Pure black, Graphite, Glass, Acrylic, Rosé, Lavender, Peach, Sakura, Candy glass, Matcha, Aurora, Dusk, Neon, Liquid glass, Translucent`); glass thickness 20–90% (only for glass themes); Island content (`Clock + Battery|Clock + Robot|Robot only`); bar order; 13 accent swatches; card width `Small 320|Medium 360|Large 420|Extra 520`; island size Auto + 75–130% slider.
3. **Robot** — live preview, eye colour (7 swatches), accessories (`None|Glasses|Hat|Headphones`), eye movement (`Relaxed|Follow cursor`), show when idle, holds items, appears after 5–120 s, battery expressions.
4. **Island** — position (`Left|Center|Right`), reset drag offset, edge margin (0–40 px), monitor (`Main display|Display under cursor`), open delay, open delay when busy, animation speed, notch mode (`Off|Hide|Jam|Jam + tanggal|Kucing`), media behaviour (`Biarkan|Kecil|Sembunyi`), notch trigger (`Layar penuh|Aplikasi sibuk|Maximized`), greeting on open.
5. **Panels** — visible tab picker (14 chips) + tab order editor; empty list hides all tabs but grid/Settings stay; drag on card updates the same list.
6. **Keys** — global shortcuts Open/Play-pause text fields (press Enter to re-register).
7. **Music** — lyrics on island, visualizer (`Pixels|Bars`), background (`Gradasi aksen|Polos`), progress bar style, lyric speed 0.5–2×, time offset ±5 s, LRC text area with example.
8. **Meetings** — live service status, auto-detect, mic button, camera mode (`Shortcut|Privasi Windows|Keduanya`, default `both`), ignore apps CSV, notice-links/download/internet/resume toggles.
9. **Calendar** — weather toggle + rain alert, iCal URL, countdown toggle.
10. **Worship** — mode (`Jadwal sholat|Ibadah lain|Nonaktif`), custom schedule editor (day/time/label, max 20), remind/countdown/pause-music/Imsak&Iftar, adhan on/off/file/volume/Fajr.
11. **Capture** — `Ctrl+Shift+S` on/off, show island in result, record mic, copy to clipboard, shot folder, video folder.
12. **About** — version `1.2.5` + text describing active panels (calendar+tasks, sholat, eye/water reminders, capture, timer, system controls), real controls (DDC/CI brightness, media-key volume/mute, Win32 CPU/RAM, EmptyWorkingSet), and honest "not active" list (music card needs SMTC, Deck needs phone bridge, prayer times not official Kemenag, religious holidays absent).

Complete persisted schema with types, defaults, and migration/clamping: `src/main/settings.ts:7-204` and `src/main/store.ts:11-57`. Notable defaults: `surface: Black`, `accent: #e9eef7`, `glassLevel: 55`, `islandScale: auto`, `cameraMode: both`, `mediaMiniBehavior: mini`, `visibleTabs` 8 tabs, `meetingAuto/meetingMicButton: true`, `noticeOpenLinks: true`, `captureShortcut: default`, `captureClipboard: true`.

---

## 8. State transitions summary

| From | Trigger | To | Source |
|---|---|---|---|
| mini | cursor rests in zone / banner | pill (peek) | `main.ts:526-536`; `island.ts:132-152,170-172` |
| pill | click body / hover timer / hotkey / `island:open` | open | `renderer.ts:178-191`; `main.ts:206-215,461-468` |
| open | hover leave after `hoverIdleResetMs` / hotkey | base (mini\|pill) | `main.ts:537-542,206-210`; `island.ts:174-178` |
| pill | media starts (`keep`) | pill width 264 | `island.ts:111-117` |
| pill | meeting + mic button | pill + 172 px capsule strip | `main.ts:370-378`; `island.ts:119-127` |
| pill/mini | notice/meeting banner | pill + 250 px, mini→pill while active | `island.ts:129-152`; `renderer.ts:530-556` |
| any | drag | offset persisted, hover suspended | `main.ts:612-635` |
| mini | any click | click-through to app below | `main.ts:356-368` |

---

## 9. Explicit unknowns / parity decisions required

1. **Greeting cadence conflict.** `src/renderer/renderer.ts:734-742` says the greeting plays on *each launch* and `greetingSeen` no longer suppresses it; `src/main/store.ts:29-31,94-100` and `src/settings/settings.ts:947` still describe "once per install / each Aeolia opened". Actual code greets every launch (renderer `greetingPlayable=true` always). Native build must pick one; document the chosen contract.
2. **Meeting notification held/not held conflict.** Settings copy `src/settings/settings.ts:989` says "notifikasi ditahan" during a meeting, but `src/main/main.ts:582-587` ("never held — meeting or not, every notice lands") and the service-bar/banner text say notifications keep arriving. Actual code does **not** hold notices (only pauses music). Preserve actual behavior; fix or flag the stale copy.
3. **Screen recording has no native encoder.** "Record screen" relies on renderer `getDisplayMedia` + `MediaRecorder` → WebM (`src/renderer/panels.ts:400-464`). Issue #1 marks encoder/video as a separate known NO-GO. Native parity needs an explicit decision: reimplement capture/encode natively, keep a scoped bridge, or drop/label the tile. Screenshots (full/area/window → PNG) do have a native path via `desktopCapturer`.
4. **No SMTC / media-session read.** Track name comes from window titles (`src/main/media.ts`) and progress from the user-controlled lyric timeline, not real song position (`src/renderer/renderer.ts:1547-1550`). A native build must preserve this honest fallback or decide to add SMTC (out of current scope).
5. **External service dependencies.** lrclib (lyrics), iTunes Search (cover colours), Open-Meteo (weather), generic iCal URL, Google `generate_204` (online), `shell.openExternal` for `ms-settings:`/protocols. Native equivalents need an HTTP client and URL-handler; failure text must be preserved.
6. **Glass is visual-only and out of parity scope.** 16 surface names are content-visible, but material rendering (Liquid/Candy) is ADR-0003 (user-supplied HLSL; no HLSL in repo). CSS/CSP implementation details are explicitly not preserved.
7. **Placeholder panels.** Deck and Calls are honest stubs (no phone bridge / no COM device list). "Not active" also listed in About. Do not invent functionality in the native build.
8. **Settings UI strings are generated in JS**, not in `settings.html`; the dist copy matches src except CSP. Native Settings must reproduce the 12-page structure, labels, and Indonesian descriptions, not just the keys.
9. **Probe suite** (`_probe-*`, `_qa-*`) encodes many behavioral contracts (drag, click-through, mic/cam, notice, glass, settings clock) and is the natural parity-evidence seam; this inventory used source code, so probe expectations should be cross-checked before acceptance-matrix sign-off (ticket #8).
10. **Text fidelity:** strings above are representative of the user-visible copy; exact wording for every hint/feedback line lives at the cited source lines and should be diffed mechanically during acceptance.
11. **Click-through contract divergence (ticket #11 / spec story 17 / prototype vs source of truth).** The current working tree is click-through **only in `mini`**: `syncClickThrough()` calls `setClickThrough(state === 'mini')` (`src/main/main.ts:356-368`), and the adjacent comment scopes the rule to "as long as the notch is showing". Pill and `open` states receive mouse events: the pill body is the click-to-open target (`src/renderer/renderer.ts:178-191`) and the Mic/Cam capsules need real clicks (`src/renderer/renderer.ts:404-413`). Ticket #11, spec user story 17, and the validated prototype instead treat the Pill as click-through/layered-transparent. This inventory follows ADR-0002 (current working tree); the acceptance matrix must decide which contract QA asserts before native sign-off. Raised by impl-ticket-01.
12. **Pill height 36 px vs native 39 px floor.** Working-tree defaults are mini `{64,14}`, pill `{150,36}`, open `{360,92}` (`src/main/settings.ts:119-121`). 39 px is the Windows `WS_THICKFRAME` minimum, but the working tree deliberately removes that style: `thickFrame:false` (`src/main/main.ts:107-109`) plus `dropThickFrame(win)` (`:130`), whose comment states it is "the only way to get a genuinely 14 px tall window" (`src/main/thinFrame.ts:26-31`). A native geometry floor of 39 px applied to *all* heights would make the 14 px notch impossible; applied only to the pill it makes the pill 3 px taller than the source of truth. Confirm the floor's scope with research-os and record the decision. Raised by impl-ticket-01.

---

## Deliverable pointers (quick index)

- States/geometry/click-through: `src/main/island.ts`, `src/main/bounds.ts`, `src/main/main.ts:198-215,356-368,380-441,470-543,612-635`.
- Panels/text/behavior: `src/renderer/index.html`, `src/renderer/renderer.ts`, `src/renderer/panels.ts`.
- Notifications/lyrics/media/extras: `src/main/notifications.ts`, `src/main/lyrics.ts`, `src/main/media.ts`, `src/main/extras.ts`, `src/main/musicColors.ts`, `src/main/noticeLaunch.ts`.
- Settings: `src/main/settings.ts`, `src/settings/settings.ts`, `src/settings/settings.html`, `src/preload/settings-preload.ts`.
- Full IPC contract: `src/renderer/global.d.ts`, `src/preload/preload.ts`.
