# Aeolia

Aeolia adalah dynamic island untuk Windows 10 dan Windows 11 yang dibangun dengan Electron, TypeScript, dan Win32. Aplikasi ini mengambang di atas desktop sebagai pill transparan, lalu berkembang menjadi kartu panel saat diklik atau dihover.

Versi rilis saat ini: **1.0.0**.

## Fitur utama

- **Island dan tampilan**: tiga state (`mini`, `pill`, `open`), mode `dynamic` dan `notched`, drag dengan posisi tersimpan, auto-shrink, hover peek, dan smart click-through pada notch.
- **15 tema permukaan**: Black sampai Neon, ditambah Liquid glass, Translucent, dan Candy glass dengan pengaturan ketebalan, warna, dan refraksi desktop.
- **Jam dan robot**: jam analog digital di pill, kucing/robot dengan ekspresi baterai, aksesoris, warna mata, dan sapaan saat aplikasi dibuka.
- **Musik dan media**: deteksi lagu dari judul jendela, kontrol media Windows, lirik LRC otomatis, visualizer, progress, warna kartu dari sampul album, dan pill lyrics.
- **Rapat**: deteksi Zoom, Teams, Meet, Discord, dan aplikasi lain dari judul serta sesi capture. Pill Mic memakai mute pada Windows audio endpoint. Pill Cam memakai shortcut aplikasi, privacy consent Windows, atau keduanya.
- **Panel harian**: Web shortcuts, Shelf, Clipboard, Notifications, Today, Calendar, Sholat, Timer, Reminders, Water, Capture, Controls, Deck, dan Calls.
- **Kontrol sistem**: brightness DDC/CI, volume, mute, CPU, RAM, Clear RAM, power, dan `ms-settings:` shortcuts.
- **Capture**: full screen, area, window, dan rekam video dengan folder output yang bisa diatur.
- **Notifikasi**: membaca Windows toast database, menampilkan banner di island, menyimpan riwayat, membuka aplikasi sumber, dan membalas notifikasi yang mendukung.
- **Pengaturan**: 12 halaman, termasuk Appearance, Robot, Island, Panels, Keys, Music, Meetings, Calendar, Worship, Capture, dan About.

## Menjalankan dari source

Butuh Node.js 22 atau lebih baru.

```bash
npm install
npm run build
npm start
```

`npm run build` mengompilasi TypeScript ke `dist/` dan menyalin aset statis.

## Membuat installer Windows

```bash
npm run dist:setup
```

Hasil installer berada di:

```text
dist-release/Aeolia-Island-1.0.0-setup.exe
```

Installer dibuat dengan NSIS. Paket memakai folder aplikasi biasa tanpa `asar`, termasuk binary `koffi` dan dependency native Windows yang dibutuhkan.

## Data aplikasi

Aeolia menyimpan data di `%APPDATA%\Aeolia Island`:

- `settings.json` untuk semua preferensi
- `state.json` untuk clipboard, notifikasi, situs, shelf, tugas, air, dan pengingat

Mode portable aktif bila folder `data` berada di samping executable.

## Shortcut

- `Ctrl+Shift+S`: capture area
- Shortcut buka island dan play/pause dapat diatur di Settings > Keys
- Kontrol media memakai tombol media Windows, sehingga berfungsi di pemutar yang memakai Media Session

Untuk panggilan video, Aeolia tidak memaksa kamera mati tanpa verifikasi. Mode `privacy` membaca dan menulis izin kamera Windows di HKCU. Mode `shortcut` mengirim hotkey ke aplikasi rapat yang sedang fokus. Mode `both` menjalankan keduanya.

## Catatan privasi

Aeolia berjalan lokal. Tidak ada akun, sync cloud, atau telemetri. Beberapa fitur membaca data lokal Windows:

- notifikasi dari Windows toast database
- judul jendela untuk deteksi media dan rapat
- consent kamera Windows di registry HKCU
- piksel desktop untuk Liquid glass refraction

Semua akses hanya untuk perilaku yang terlihat di UI dan bisa dimatikan dari Settings.

## Troubleshooting

**Island tidak muncul**
Jalankan ulang Aeolia dari tray. Periksa apakah mode `hiddenUntilHover` aktif. Arahkan kursor ke tepi atas layar untuk membuka pill.

**Mic tidak berubah**
Buka Settings > Meetings dan pastikan tombol mikrofon aktif. Aeolia memakai Windows audio endpoint. Jika aplikasi rapat memiliki mute internal, state Windows dan state aplikasi bisa berbeda sampai aplikasi tersebut disinkronkan.

**Kamera tidak berubah**
Pilih mode kamera di Settings > Meetings. `privacy` dan `both` membaca balik nilai Windows setelah menulis. `shortcut` hanya melakukan aksi best effort dan tidak mengklaim terverifikasi.

**Liquid glass tampak polos**
Aktifkan refraksi desktop di Settings > Appearance. Beberapa konten protected tidak bisa di-capture Windows sehingga efek desktop tidak bisa menampilkan piksel tersebut.

## Build dan development

Struktur utama:

```text
src/main/       Electron main process, Win32, IPC, state, media, dan settings
src/preload/    contextBridge untuk island, settings, dan capture overlay
src/renderer/   HTML, CSS, renderer, dan panel UI
src/settings/   jendela Settings
scripts/        build, copy static, dan helper PowerShell
```

Script yang tersedia:

- `npm run build` mengompilasi frontend
- `npm start` menjalankan Electron
- `npm run probe` menjalankan probe utama
- `npm run dist:setup` membuat installer NSIS
- `npm run dist:portable` membuat ZIP portable
- `npm run dist:msix` membuat paket MSIX
- `npm run dist:all` membuat ketiganya

## Lisensi

Hak cipta Aeolia. Lihat file lisensi di repository bila tersedia.
