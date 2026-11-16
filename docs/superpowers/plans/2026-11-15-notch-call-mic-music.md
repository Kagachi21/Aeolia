# Notch Interaksi, Setting Notch, Call Detection, Mic Pill, Music Card — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Perbaiki interaksi notch mini (hover/klik), sambungkan setting miniMode, matikan false-positive meeting Discord + mic pill saat call, animasi join mic pill dengan tombol mic & kamera, lirik otomatis saat lagu diputar, dan rapikan card musik sesuai referensi.

**Architecture:** Semua perubahan di codebase dynamic-island yang ada. Geometri tetap lewat `boundsFor()` (pure); perilaku call lewat `matchesCall()` (pure, exported); mute mic via PowerShell helper (Add-Type dikompilasi sekali, di-cache ke %TEMP%) dipanggil dari main. UI lewat `data-*` attribute + CSS, pola yang sudah dipakai app.

**Tech Stack:** Electron 45 + TypeScript, koffi (Win32), PowerShell/C# Add-Type untuk Core Audio mute.

**Spec:** Permintaan user 15 Nov 2026 (chat) + gambar referensi: notch mini = jam saja (atau kucing), hover memunculkan card, klik meng-expand; setting notch berfungsi; Discord hanya meeting saat call nyata; mic pill animasi join + tombol mic/kamera; card musik seperti gambar (art gradient + badge, artis, transport kanan-atas, wave progress, waktu sisa `-1:58`, volume tengah bawah).

## Global Constraints

- Bahasa UI Indonesia, tanpa em-dash (antislop: pakai `·`).
- CSP: dilarang inline style attribute dan data:URL SVG; tulis gaya via CSSOM variable.
- Windows tanpa SMTC read: judul lagu dari deteksi window, waktu/progress dari lirik (tetap honest).
- QA harness: `_qa-features.js` (node), `_qa-ui.js` + `_qa-live.js` (electron.exe dengan `env -u ELECTRON_RUN_AS_NODE`).
- Setiap task: RED (probe gagal) → GREEN → commit kecil → lanjut. Akhir: build `node scripts/build-win.js all`, sinkron ke `C:\Users\Lycaon\AppData\Local\Programs\Aeolia Island\resources\app\dist`, push ke `origin main`.

---

### Task 1: Banner tidak boleh menimpa isi notch mini

Kondisi: banner ditampilkan di state mini (renderer.ts:243-244, island.ts expand) sehingga notch kecil menampilkan teks meeting. Spec: notch mini hanya jam + notif kecil.

**Files:**
- Modify: `src/renderer/renderer.ts` (bannerOk, render banner)
- Modify: `src/renderer/styles.css` (hilangkan gaya banner di mini bila ada)
- Test: `_qa-ui.js`

**Interfaces:**
- Produces: `bannerOk()` hanya true saat state `pill`/`open`; banner di mini memicu `island.peek()` dari main (sudah ada) sehingga banner tampil di peek pill.

- [ ] Step 1 (RED): di `_qa-ui.js` tambah check: saat `data-state="mini"`, element `#banner` tidak boleh visible (display none / tidak pernah ditampilkan). Jalankan → FAIL.
- [ ] Step 2 (GREEN): `bannerOk()` diubah jadi hanya `state === 'pill'` atau state open; antrean banner tetap FIFO 4200 ms dan tampil saat peek/pill.
- [ ] Step 3: run `_qa-ui.js` → PASS; run `_qa-features.js` → PASS.
- [ ] Step 4: commit `fix: banner tidak menimpa notch mini`.

### Task 2: Hover & klik notch mini (task #26)

Kondisi: klik tab bisa tapi notch tidak berubah; hover tidak memunculkan card. Jalur di main.ts (`hoverTimer`, `pollHoverZone`, `island.peek()`, balik `island:hover`) harus didiagnosis dengan live test.

**Files:**
- Modify: `src/main/main.ts` (zona hover + click, sekitar baris 369-454)
- Modify: `src/main/island.ts` (bila perlu transisi klik)
- Test: `_qa-live.js` + verifikasi manual singkat

**Interfaces:**
- Consumes: `island.peek()` dan `island.transition()` yang sudah ada.
- Produces: perilaku: (a) cursor di atas notch mini → peek ke pill lalu card terbuka setelah hover delay; (b) klik notch mini → expand langsung (state pill), klik lagi di luar → balik mini.

- [ ] Step 1 (diagnosis): jalankan `_qa-live.js` skenario hover/klik mini; catat di ledger mana yang putus: zona hover (click-through hanya 14 px atas, main.ts:137), balik `island:hover`, atau handler klik renderer.
- [ ] Step 2 (RED): tambah check `_qa-ui.js`: klik pada `#mini` (dispatch click) harus mengubah `root.dataset.state` dari `mini` ke `pill`. Jalankan → FAIL.
- [ ] Step 3 (GREEN): renderer: klik `#mini` memanggil IPC baru `island:open` (preload bridge) → main `island.transition('pill')`. Hover path: pastikan `pollHoverZone` meng-cakup area notch penuh (bukan hanya 14 px) dan peek di-re-assert (main.ts:426).
- [ ] Step 4: run `_qa-ui.js` + `_qa-live.js` → PASS.
- [ ] Step 5: commit `feat: notch mini bisa di-hover dan di-klik`.

### Task 3: Setting miniMode berfungsi live (task #27)

Rantai: settings UI (settings.ts:884) → main save → `pushStatus.miniMode` (main.ts:224) → renderer `data-mini-mode` (renderer.ts:338/376) → CSS (styles.css:345-355). CSS sudah lengkap; cari mata rantai yang putus (dugaan: status tidak di-push ulang setelah save).

**Files:**
- Modify: `src/main/main.ts` (push ulang status saat settings berubah)
- Modify: `src/settings/settings.ts` (bila binding hilang)
- Test: `_qa-features.js`

- [ ] Step 1 (RED): `_qa-features.js` tambah check: memanggil handler settings-save dengan `miniMode:'cat'` harus menghasilkan status berikutnya berisi `miniMode:'cat'` tanpa restart. Jalankan → FAIL.
- [ ] Step 2 (GREEN): pastikan setelah save settings, main mem-broadcast `status` (atau minimal `miniMode`) ke renderer; renderer sudah membaca `status.miniMode`.
- [ ] Step 3: run `_qa-features.js` → PASS; cek manual: ganti setting Jam/Jam+tanggal/Kucing → notch berubah seketika.
- [ ] Step 4: commit `fix: setting miniMode live tanpa restart`.

### Task 4: Discord call detection + mic pill saat call (task #24)

`MEETING_APPS` (extras.ts:27) masih memuat `discord` → judul window Discord apa pun dianggap meeting.

**Files:**
- Modify: `src/main/extras.ts` (MEETING_APPS, CALL_WORDS)
- Test: `_qa-features.js`

**Interfaces:**
- Produces: `matchesCall(label: string): boolean` — perilaku baru:
  - `Discord | #umum | teks bebas` → false
  - `Discord | Voice/Video Call · panggilan · voice connected` → true
  - `@username Discord | Voice Connected` → true (kata `voice connected` masuk CALL_WORDS)

- [ ] Step 1 (RED): `_qa-features.js`: 5 kasus judul Discord asli (chat biasa → false; Voice Call/Video Call/Voice Connected/panggilan → true). Jalankan → FAIL.
- [ ] Step 2 (GREEN): hapus `discord` dari MEETING_APPS; tambah `voice connected|streaming` ke CALL_WORDS. Pastikan chat apps lain tetap keluar.
- [ ] Step 3: verifikasi rantai ke mic pill: status call → `pushStatus` kirim `micActive`/`meetingApp` → renderer tampilkan `#micPill`. Tambah check features.
- [ ] Step 4: run semua suite → PASS. commit `fix: discord hanya meeting saat call nyata`.

### Task 5: Mic pill animasi join + tombol mic & kamera (task #28)

**Files:**
- Create: `src/main/micMute.ts` (PowerShell helper + IPC state)
- Modify: `src/main/main.ts` (IPC `mic:mute-toggle`, `mic:mute-state`, `cam:toggle`)
- Modify: `src/preload/preload.ts` (bridge `micMuteToggle()`, `micMuteState()`, `camToggle()`)
- Modify: `src/renderer/index.html` + `styles.css` (tombol di `#micPill`, state `data-mic-muted`)
- Modify: `src/renderer/renderer.ts` (state muted + animasi join)
- Test: `_qa-features.js`, `_qa-ui.js`

**Interfaces:**
- Produces:
  - `micMute.ts` → `getMicMuted(): Promise<boolean>`, `toggleMicMute(): Promise<boolean>` (helper PS: `IMMDeviceEnumerator` → `IAudioEndpointVolume::GetMute/SetMute` capture endpoint; DLL di-cache %TEMP% agar klik kedua cepat).
  - IPC: `mic:mute-toggle` → boolean (muted baru); `mic:mute-state` → boolean; `cam:toggle` → void.
  - Shortcut kamera per app (pola NOTICE_PROTOCOLS): `zoom→Alt+V`, `teams→Ctrl+Shift+M`, `meet→Ctrl+E`; app tak dikenal → hint jujur "Kamera dikontrol di aplikasi ·<nama>".
  - Pill: `data-mic-state="joining|on|muted"`, animasi ada (joining: titik oranye berdenyut, transisi lebar; on: hijau).

- [ ] Step 1 (RED): `_qa-features.js`: mock helper mute (injected) → `toggleMicMute()` balik boolean baru & state konsisten; map shortcut kamera 3 app + fallback hint. Jalankan → FAIL.
- [ ] Step 2 (GREEN): implement `micMute.ts` (helper PS sekali kompilasi) + IPC + map shortcut. Catat: bila helper gagal di mesin user (timeout/PS error), `getMicMuted` balik `null` dan tombol mic tampil state `unknown` dengan hint jujur.
- [ ] Step 3 (RED): `_qa-ui.js`: klik tombol mic di pill mengubah `data-mic-muted`; klik tombol kamera memanggil `window.api.camToggle()`. FAIL → GREEN.
- [ ] Step 4: animasi join: CSS `@keyframes` joining (dot pulse + pill melebar) 1400 ms lalu state `on` (pola `mic-pop`/`mic-pulse` yang sudah ada dirapikan sesuai gambar).
- [ ] Step 5: run semua suite → PASS. commit `feat: mic pill animasi join + mute asli + tombol kamera`.

### Task 6: Lirik otomatis saat lagu diputar (task #29)

Kondisi sekarang: lirik hanya manual via textarea LRC di pengaturan (settings.ts:925). Spec: saat status playing + judul terdeteksi, lirik tersinkron diambil otomatis.

**Files:**
- Create: `src/main/lyrics.ts` (fetch lrclib.net + cache)
- Modify: `src/main/main.ts` (event `lyrics:auto-loaded`, trigger saat media playing berubah judul)
- Modify: `src/renderer/renderer.ts` (terima LRC otomatis → parser timeline yang sudah ada)
- Test: `_qa-features.js`

**Interfaces:**
- Consumes: parser timeline lirik renderer yang sudah ada (`aeoliaLyricNow`, sumber teks dari settings `lyricsText`).
- Produces:
  - `lyrics.ts` → `fetchLyrics(title: string, artist?: string): Promise<string | null>` — urutan: `GET /api/get?artist_name&track_name` → fallback `GET /api/search?q=<title>`; ambil `syncedLyrics`; cache `Map<title, string>`.
  - IPC event `lyrics:auto-loaded` payload `{ title: string; lrc: string | null }` (`null` = tidak ketemu, state jujur).

- [ ] Step 1 (RED): `_qa-features.js` dengan fetch mock: judul terdeteksi → fetch terpanggil sekali (cache mencegah dobel), LRC hasil dikirim ke renderer; judul tanpa hasil → payload `{ lrc: null }`. Jalankan → FAIL.
- [ ] Step 2 (GREEN): implement `lyrics.ts` + trigger di main (rising-edge judul saat `media=true`) + bridge renderer: LRC otomatis masuk jalur parse yang sama dengan `lyricsText`, tanpa menimpa teks manual jika user sedang mengisi.
- [ ] Step 3: run `_qa-features.js` → PASS.
- [ ] Step 4: commit `feat: lirik otomatis dari lrclib saat lagu diputar`.

### Task 7: Card musik sesuai referensi (task #23)

Layout target (gambar #1): art gradient besar dengan badge not di pojok bawah art · judul + artis · transport (prev/pause/next) kanan-atas sejajar judul · progress wave dengan titik ujung · waktu kiri `1:35` dan kanan sisa `-1:58` · slider volume + ikon speaker tengah bawah. Lirik tetap tampil dan menggerakkan progress.

**Files:**
- Modify: `src/renderer/index.html` (struktur `#musicCard`: baris art+meta+transport, progress, times, volume)
- Modify: `src/renderer/renderer.ts` (isi art gradient deterministik dari judul, sub = artis/app sumber, format `-1:58`)
- Modify: `src/renderer/styles.css` (gradient art via CSS class hash, badge not pseudo-element, wave progress via CSS yang sudah ada `data-style="Wave"` dipertahankan)
- Test: `_qa-ui.js`

- [ ] Step 1 (RED): `_qa-ui.js`: (a) `#musicArt` punya kelas gradient + badge not; (b) `#musicSub` bukan teks kontrol tapi sumber/artis; (c) `#musicTimeEnd` berformat `-m:ss` saat playing; (d) urutan DOM: transport sejajar meta (parent sama), volume di baris bawah. Jalankan → FAIL.
- [ ] Step 2 (GREEN): susun ulang HTML + renderer + CSS. Art gradient: hash judul → 1 dari 6 palet (CSS class `music-art g0..g5`), badge not via `::after` (CSP aman).
- [ ] Step 3: run `_qa-ui.js` + `_qa-live.js` → PASS.
- [ ] Step 4: commit `feat: card musik sesuai referensi`.

### Task 8: QA penuh, build, sinkron, push

- [ ] Step 1: semua suite: `_qa-features.js` (node), `_qa-main.js`, `_qa-ui.js`, `_qa-live.js` (electron) → 0 gagal, 0 console error.
- [ ] Step 2: `node scripts/build-win.js all` → verifikasi SHA256 → salin ke `C:\Users\Lycaon\AppData\Local\Programs\Aeolia Island\resources\app\dist`.
- [ ] Step 3: smoke run singkat (user restart manual; proses spawn mati saat sesi berakhir).
- [ ] Step 4: commit akhir + `git push origin main`. Ledger `.superpowers/sdd/2026-11-15-notch-call-mic-music/progress.md`.

## Review Focus

- Banner datang saat base mini → harus peek dulu, isi mini tetap jam. Test: Task 1 Step 1.
- Klik notch saat state peek (sudah pill) tidak boleh membalik ke mini. Test: Task 2 Step 2 varian.
- Ganti miniMode saat state mini aktif → berubah seketika. Test: Task 3 Step 3 manual.
- Judul Discord berisi kata "meeting" di nama channel → tidak boleh dianggap call. Test: Task 4 Step 1 kasus ke-6.
- Helper mute gagal (PS tidak ada / akses ditolak) → tombol mic state jujur, app tidak crash. Test: Task 5 Step 2.
- Judul lagu pendek/panjang → art gradient tetap konsisten per judul, waktu sisa `-0:07` valid. Test: Task 7 Step 1.
- Lagu tanpa lirik di lrclib / jaringan mati → state jujur "Lirik tidak ditemukan", lirik manual user tidak tertimpa, tidak ada spam fetch (cache). Test: Task 6 Step 1.
