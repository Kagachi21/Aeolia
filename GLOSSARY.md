# Aeolia Dynamic Island

Glosarium untuk perilaku dan kandungan Dynamic Island yang harus dipertahankan selama migrasi native. Istilah di sini sengaja bebas dari detail implementasi rendering.

## Language

**Dynamic Island**:
Permukaan小块 di dekat takik layar yang menampilkan status dan panel kontekstual tanpa mengambil alih layar.
_Avoid_: widget, overlay, notched panel

**Island Content**:
Kumpulan teks, data, status, dan kontrol yang saat ini tampil di panel Dynamic Island pada working tree.
_Avoid_: UI state, screen content

**Island Behavior**:
Cara Dynamic Island bereaksi terhadap klik, drag, perubahan state, notifikasi, dan perubahan pengaturan.
_Avoid_: interaction model, event handling

**Liquid Glass**:
Material kaca terang dengan distorsi linier yang meniru pembiasan desktop di balik island.
_Avoid_: acrylic, blur, frosted glass

**Candy Glass**:
Material kaca berwarna dengan karakter optik dan tepi yang berbeda dari Liquid Glass.
_Avoid_: tinted panel, coloured glass

**Pill**:
Bentuk Dynamic Island saat hanya menampilkan ringkasan kompak.
_Avoid_: small mode, collapsed island

**Expanded Mode**:
Bentuk Dynamic Island saat panel dibuka dan menampilkan Island Content lengkap.
_Avoid_: open card, full mode

**Native Content Parity**:
Kesetaraan konten dan perilaku antara implementasi Electron dan implementasi native, tanpa menuntut kesetaraan pixel.
_Avoid_: pixel parity, visual fidelity

**Golden Matrix**:
Satu matriks acceptance untuk Native Content Parity; setiap baris memetakan satu panel, state, transisi, shortcut, notifikasi, pengaturan, kontrak eksternal, atau honest stub ke source pointer, exact strings, expected behavior, trigger, fixture, dan probe evidence.
_Avoid_: test checklist, QA matrix

**Honest Stub**:
Panel yang tetap ditampilkan dengan penjelasan bahwa fiturnya belum aktif, tanpa data atau status rekaan.
_Avoid_: placeholder, dummy panel
