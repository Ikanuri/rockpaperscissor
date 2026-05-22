# Patch Notes — GubakeBot

Catatan update untuk pemain. Versi teknis lengkap ada di `CHANGELOG.md`.

---

## v1.5.0 — 22 Mei 2026

### ✨ Fitur Baru (Beta)

**🎨 Emoji reveal milik sendiri**

Sebelumnya emoji reveal di hasil game mengikuti config host. Sekarang tiap pemain pakai setting mereka masing-masing — kamu lihat emojimu sendiri, lawan lihat emojinya sendiri.

---

**🏷️ Emoji standar sebagai info**

Kalau kamu pakai custom emoji premium Telegram, emoji standar ditampilkan dalam kurung sebagai referensi:

```
🏆 Andi wins!
Andi 🍎 (✊) · Budi 🧱 (✌️)
```

Kalau tidak ada custom emoji, tampil seperti biasa tanpa kurung.

---

**💎 Tier Donator kini aktif**

Fitur kustomisasi (`/setemoji`, `/setsticker`, `/setthumb`) sekarang memerlukan tier:

| Tier | Yang bisa dilakukan |
|------|-------------------|
| Free | Main game saja |
| 🥉 Basic | Set emoji (plain), stiker popup, thumbnail GIF/stiker |
| 🥇 Premium | Semua Basic + emoji animasi custom Telegram |

Hubungi owner untuk upgrade atau info lebih lanjut.

---

### 🔧 Perubahan (Owner/Admin)

**`/activatetier` — lebih powerful**

Command aktivasi tier manual sekarang mendukung:
- **Bulk**: aktifkan beberapa user sekaligus — `/activatetier basic 123 456 789`
- **Durasi fleksibel**: hari (`30d`), menit (`60m`), atau angka saja untuk hari — `/activatetier premium 7d 123456`
- **Konfirmasi lengkap**: tampil nama user, expiry dalam UTC dan WIB

```
✅ 🥉 Basic activated · 30d
⏰ Until: 2026-06-21 · 2026-06-21 WIB

  • Raven @Beelzeboi (5298448445)
  • Budi @budisantoso (123456789)
```

---

**`/donatorlist` — daftar donator aktif**

List semua donator dengan nama, username, tier, dan expiry. Badge otomatis sesuai tier:
- Basic → `(✊)`
- Premium → emoji custom rock mereka (kalau sudah diset)

```
📋 Donator list (2):
  (✊) Budi @budisantoso (123456789)
     until 2026-06-21 WIB
  🍎 Raven @Beelzeboi (5298448445)
     until 2026-07-21 WIB
```

---

**`/betalist` — format diperbarui**

Sekarang tampil nama + username + ID monospace, sama seperti `/donatorlist`.

---

**`/removedonator` — bulk**

Hapus beberapa donator sekaligus: `/removedonator 123 456 789`

---

**`/setupcommands` — register command per user**

Jalankan sekali untuk set command menu Telegram berbeda per role:
- User biasa: hanya lihat command yang relevan
- Owner: lihat semua command termasuk admin tools

---

**`/riverwas` — daftar semua command**

Tampilkan semua command terorganisir per role: Semua User → Donator → Beta Tester → Owner.

---

## v1.4.0 — 21 Mei 2026

### ✨ Fitur Baru

**🏆 Nama pemain di hasil**

Hasil game sekarang menyebut nama pemenang — penonton bisa langsung tahu siapa menang tanpa harus scroll ke atas:

```
🏆 Andi wins!
Andi ✊ · Budi ✌️
```

---

**🔄 Rematch buat bubble baru**

Klik Rematch → popup pilihan senjata terbuka, dan bubble baru terkirim ke chat. Bubble lama tetap ada sebagai arsip. Rematch bisa dilakukan berkali-kali selama kedua pemain klik dalam 5 menit setelah game selesai.

---

**📊 Riwayat pertandingan**

Mulai rematch kedua, hasil menampilkan riwayat sesi yang bisa di-expand:

```
🏆 Andi wins!
Andi ✊ · Budi ✌️

📊 3 games · 2–1
Andi: ✅ ❌ ✅
Budi: ❌ ✅ ❌
```

---

**🎮 Tombol Join**

Pesan tunggu sekarang punya tombol **Join** — tap untuk langsung buka popup tanpa ketik kode manual.

---

**🔒 Tantang pemain tertentu**

Buat game khusus untuk satu orang: ketik `@JankensBot @username`. Hanya username itu yang bisa masuk. Juga bisa BO3: `@JankensBot @username BO3`.

---

**🎲 Urutan acak + pilihan random**

Urutan ✊✋✌️ di popup dikocok tiap kali buka. Ada juga opsi **🎲 Random** di paling atas untuk yang mau biarkan nasib yang memutuskan.

---

**📅 Statistik mingguan**

`@JankensBot STATS` sekarang menampilkan statistik minggu ini dan pilihan senjata favoritmu, selain statistik sepanjang masa.

---

### 🔧 Perubahan

- **Countdown 3-2-1 dihapus** — setelah kedua pemain memilih, masing-masing langsung lihat emoji pilihan mereka sendiri selama 5 detik, lalu hasil muncul. Perubahan ini mengurangi jumlah API call per game sehingga sinkronisasi dua pesan lebih baik.
- **Tombol 🔄 Refresh dihapus** — tidak relevan lagi karena rematch sudah pakai bubble baru.
- Teks kode game di pesan tunggu dihapus — sudah digantikan tombol Join.

---

### 🐛 Bug Fix

- **Riwayat tidak muncul** — game pertama tidak tersimpan ke riwayat sehingga history baru tampil setelah rematch ketiga. Sekarang muncul mulai rematch pertama.
- **Rematch lebih dari 2 kali gagal** — lawan yang join lewat tombol Join tidak membersihkan pointer internal, sehingga rematch berikutnya menemukan data lama. Sudah diperbaiki.
- **Rematch bisa diikuti orang lain** — chain rematch sekarang hanya bisa dipakai oleh dua pemain original.

---

## v1.3.1 — 20 Mei 2026

### 🐛 Bug Fix

**Countdown & reveal sekarang lebih sinkron**

Dua bug annoying diperbaiki sekaligus:

- **Hitung mundur tidak realtime** — 3️⃣2️⃣1️⃣ sebelumnya kadang terasa lambat atau jeda-nya tidak rata. Interval antar angka sekarang jauh lebih konsisten.
- **Reveal tidak berbarengan** — Kadang salah satu pemain lihat hasil lebih lambat dari yang lain (bisa sampai beberapa detik selisih). Sekarang selisihnya jauh lebih kecil.

---

## v1.3.0 — 20 Mei 2026

### ✨ Fitur Baru (Beta)

Fitur-fitur berikut sedang dalam tahap **beta** — belum tersedia untuk semua orang. Hubungi owner untuk akses.

---

**🎨 Kustomisasi tampilan game**

Sekarang kamu bisa ubah tampilan game-mu sendiri lewat DM ke bot:

```
/setemoji countdown 1 ❶       → ganti emoji hitung mundur
/setemoji reveal rock 🪨       → ganti emoji reveal
/setsticker rock <file_id>    → ganti popup pilihan jadi stiker animasi
/setthumb rock gif <file_id>  → ganti thumbnail popup jadi GIF
/myconfig                     → lihat settingan aktifmu
/reset                        → reset ke default
```

Settingan ini berlaku untuk semua game yang kamu buat sebagai host.

---

**🏆 Leaderboard**

Ketik `@JankensBot TOP` di chat mana saja untuk lihat 20 pemain teratas berdasarkan jumlah menang.

---

**💎 Donator Tier** *(coming soon untuk umum)*

Dukung bot dengan donasi dan dapatkan perks eksklusif:

| Tier | Perks |
|------|-------|
| 🥉 **Basic** | Emoji custom, thumbnail GIF/stiker, badge ✨ di game, max 5 game aktif |
| 🥇 **Premium** | Semua Basic + emoji animasi, kode game custom, max 10 game aktif |

Bayar pakai ⭐ Telegram Stars atau kartu kredit/debit.

---

**🔄 Tombol Refresh**

Pesan game tertimbun flood di grup? Klik tombol `🔄 Refresh` untuk update tampilan ke state terkini tanpa perlu cari-cari scroll.

---

### 🐛 Bug Fix

- **Stuck di reveal** — Setelah banyak rematch berturut-turut, salah satu pesan kadang berhenti di tampilan reveal dan tidak pernah jadi hasil. Sekarang sudah diperbaiki.
- **Rematch tidak bisa diklik setelah 2 menit** — Tombol Rematch gagal dengan pesan "Game not found" kalau diklik lebih dari 2 menit setelah game selesai. Sekarang bisa diklik sampai 10 menit.
- **Waiting message tidak ada info waktu** — Pesan tunggu sekarang menampilkan `⏰ X menit tersisa` supaya tahu kapan game expire.

---

## v1.2.0 — 19 Mei 2026

### ✨ Fitur Baru

- **Tombol Cancel** — Host bisa batalkan game yang sedang menunggu lawan sebelum ada yang join. Klik `❌ Cancel` di pesanmu.
- **Emoji animasi** — Owner bisa set custom emoji Telegram (yang animasi) untuk tampil saat countdown dan reveal.

---

## v1.1.0 — 19 Mei 2026

### 🔧 Perubahan Tampilan

- Hitung mundur jadi emoji besar: 3️⃣ → 2️⃣ → 1️⃣ (sebelumnya teks)
- Reveal sekarang lebih lama (5 detik) — cukup waktu untuk lihat pilihan lawan sebelum hasil muncul
- Popup pilihan lebih bersih — cuma emoji, tanpa teks "Rock / Paper / Scissors"
- Dukungan stiker animasi Lottie di popup (kalau dikonfigurasi oleh owner)

### 🐛 Bug Fix

- Reveal menampilkan emoji yang salah untuk masing-masing pemain — sekarang setiap pemain lihat emoji pilihan mereka sendiri vs lawan

---

## v1.0.0 — 19 Mei 2026

### 🎉 Rilis Perdana

JankensBot hadir! Main **Rock Paper Scissors** langsung dari inline Telegram — tanpa buka chat baru, tanpa bot command.

**Cara main:**
1. Ketik `@JankensBot` di chat mana saja → pilih senjatamu dari popup
2. Pesan otomatis terkirim dengan kode game
3. Lawan ketik `@JankensBot KODE` → pilih senjata → game mulai!
4. Hitung mundur 3-2-1, reveal, hasil — semuanya langsung di pesan

**Fitur:**
- ⚔️ Mode single round & Best of 3 (`@JankensBot BO3`)
- 🔄 Tombol Rematch setelah game selesai
- 📊 Statistik menang/kalah/seri (`@JankensBot STATS`)
- ⏰ Game otomatis expire setelah 10 menit
- 🚦 Maksimal 3 game aktif per pemain
