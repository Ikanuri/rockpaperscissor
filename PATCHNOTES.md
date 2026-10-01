# Patch Notes — GubakeBot

Catatan update untuk pemain. Versi teknis lengkap ada di `CHANGELOG.md`.

---

## v2.3.3 — 1 Oktober 2026

### 🔬 Alat Diagnostik (khusus owner)

Ditambah perintah uji internal untuk mencari cara menampilkan emoji custom animasi di pesan rapi (rich). Tidak ada perubahan yang terasa untuk pemain.

---

## v2.3.2 — 19 September 2026

### 🔬 Sedang Diuji

**💎 Konfirmasi Ulang Animasi Emoji Custom**

Setelah update kemarin, emoji custom animasi terbukti jalan normal lagi. Sekarang sedang dikonfirmasi ulang khusus di layar hasil 1v1 untuk memastikan penyebabnya benar-benar seperti dugaan, sebelum diputuskan permanen. Tidak ada perubahan yang terasa untuk pemain di luar itu.

---

## v2.3.1 — 19 September 2026

### 🔧 Perbaikan

**💎 Emoji Custom Animasi — Balik ke Cara Lama yang Terbukti Jalan**

Ketahuan: emoji custom animasi donator kadang cuma tampil diam (tidak bergerak) di layar hasil game. Sambil terus dicari akar masalahnya, tampilan hasil game (1v1/LMS/Team) yang mengandung emoji custom sekarang otomatis pakai cara pengiriman lama yang sudah lama terbukti stabil untuk emoji custom, dengan sedikit pengorbanan: divider dan kutipan footer khusus di pesan itu jadi versi teks biasa (bukan versi rapi baru).

---

## v2.3.0 — 19 September 2026

### 🔧 Perbaikan

**💎 Emoji Custom Donator Lebih Konsisten**

Ditemukan celah: emoji custom animasi (perk khusus tier Premium) kadang bisa "nyangkut" tetap tampil meski donatornya sudah turun tier atau seharusnya belum berhak (lewat cara set emoji tertentu). Sekarang tampilan emoji selalu dicek ulang sesuai tier donator yang aktif saat itu — kalau bukan Premium (atau beta/owner), otomatis kembali ke emoji biasa.

**🎨 Perapian Kode Tampilan Pesan**

Mesin di balik layar untuk pesan rapi (rich message) diseder­hanakan — sekarang mengandalkan langsung parsing bawaan Telegram, bukan buatan sendiri, supaya lebih tahan terhadap format baru ke depannya. Tidak ada perubahan tampilan yang terlihat pemain.

---

## v2.2.1 — 18 September 2026

### 🔧 Perbaikan

**🎨 Tampilan Rapi Sekarang Juga di LMS & Team**

Hasil game LMS dan Team (menang/kalah, hasil tiap ronde) sekarang tampil dengan format rapi yang sama seperti hasil 1v1 — termasuk emoji custom donator dan garis pembatas footer. Sebelumnya mode-mode ini tampil versi teks polos supaya lebih aman.

---

## v2.2.0 — 18 September 2026

### ✨ Fitur Baru

**🎨 Tampilan Lebih Rapi (Rich Message)**

Semua pesan bot — hasil game 1v1, LMS, Team, Tournament, panduan `/guide`, `/credits`, pengumuman di grup — sekarang tampil dengan format yang lebih baik dan konsisten.

**ℹ️ Cek Pilihanmu Sendiri**

Tombol info kecil di bubble waiting/locked (1v1, LMS, Team) — tekan buat lihat popup privat pilihan senjata yang sudah kamu kunci, tanpa ketahuan pemain lain.

**⏳ Reminder di Team Mode**

Kalau ada teammate yang belum pilih senjata, dia dapat notifikasi privat di dalam grup — cuma dia yang lihat, tidak mengganggu yang lain.

**📝 `/setfooter` dan `/credits` — Format Bebas**

Owner bot sekarang bisa kirim teks dengan format Telegram biasa (bold, italic, quote, emoji custom) langsung dari keyboard — tidak perlu ketik kode apapun.

---

## v2.1.0 — 18 September 2026

### ✨ Fitur Baru

**📝 Footer Custom di Hasil Game**

Owner bot sekarang bisa set teks tambahan yang muncul di bagian bawah setiap hasil game — 1v1, Team, Tournament, maupun Last Man Standing.

### 🔧 Perubahan

- Bubble "menunggu lawan" dirapikan: badge donator tampil di depan nama, kata "main" dihilangkan, dan hitung mundur waktu + tombol refresh dihapus (sudah tidak diperlukan)
- Nama di leaderboard sekarang selalu pakai nama tampilan (bukan username) — termasuk data lama yang sebelumnya masih menampilkan `@username`
- `/donatorlist` sekarang juga menampilkan pemain yang pakai `/freemium`, ditandai `(freemium)`
- Tombol "Main lagi vs Bot" diringkas jadi "Lagi vs Bot"

### 🐛 Perbaikan Bug

- **Last Man Standing**: game tidak lagi macet tanpa hasil ketika 1–2 pemain kabur (flee) di tengah ronde — pemenang sekarang selalu diumumkan dengan benar
- **Last Man Standing & Team Mode**: perbaikan kondisi langka di mana dua pemain join atau memilih senjata hampir bersamaan bisa membuat salah satu pemain "terdepak" secara tidak sengaja dari game
- Tim yang seri dan perlu lempar dadu tiebreaker: instruksi dikembalikan ke "lempar 🎲 di grup" (sempat salah minta reply pesan)

---

## v2.0.0 — 23 Mei 2026

### ✨ Fitur Baru

**🌏 /setlang — Pilih Bahasa Bot**

Ketik `/setlang` → pilih 🇮🇩 Bahasa Indonesia atau 🇬🇧 English. Semua pesan bot (welcome, panduan, konfirmasi) mengikuti pilihan ini secara otomatis.

---

**📖 /guide — Panduan Mode Game Interaktif**

Ketik `/guide` → muncul menu 7 mode. Tap salah satu → penjelasan lengkap: cara main, contoh command dalam code block, dan tips. Ada tombol ← Kembali untuk balik ke menu utama.

Mode yang tersedia di panduan: 1v1, BO3/5/7, Ranked, Last Man Standing, Team, vs Bot, Open Challenge.

---

**🎮 Bot Pindah ke @GubakeBot**

Bot berganti nama dari JankensBot ke **GubakeBot**. Semua fitur sama persis, hanya nama dan username yang berubah.

---

### 🔧 Perubahan

- **Command list** diperbarui: hanya `/clearhost`, `/setlang`, `/guide` yang tampil di autocomplete. `/donate` sengaja disembunyikan sementara — fitur tetap bisa diakses, hanya tidak ditampilkan di menu.
- **Welcome message** diperbarui: mode Team ditambahkan ke daftar, `/donate` dihilangkan, `/guide` dan `/setlang` tercantum.
- **Deskripsi command** kini otomatis tampil dalam bahasa yang sesuai: user dengan app Telegram bahasa Inggris dapat deskripsi English, lainnya dapat Bahasa Indonesia.

---

## v1.9.0 — 22 Mei 2026

### ✨ Mode Game Baru

**⚔️ Last Man Standing (LMS)**

3–8 pemain, eliminasi tiap ronde. Terakhir tersisa = pemenang.

```
@GubakeBot LMS      → 4 pemain (default)
@GubakeBot LMS 6    → 6 pemain
@GubakeBot LMS 8    → 8 pemain
```

Logika ronde:
- 2 jenis senjata muncul → yang kalah eliminasi
- 1 atau 3 jenis muncul → **Chaos round**, semua main ulang

Sebelum hasil tiap ronde, tiap pemain lihat emoji pilihan mereka 3 detik. Host bisa **Force Start** kalau sudah ada ≥2 pemain tanpa menunggu slot penuh.

---

**🤝 Team Mode (NvN)**

Dua tim berhadapan. Pilihan resmi tim = suara terbanyak anggota. Kalau 50/50 → bot kirim 🎲 dadu di grup, roll tertinggi menang.

Cara main:
1. Ketik `/team 2v2` di grup (bot simpan grup ini 5 menit)
2. Buka inline `@GubakeBot TEAM 2v2`
3. Anggota join lewat tombol 🤝 Tim A atau ⚔️ Tim B

Mendukung 1v1 / 2v2 / 3v3 / 4v4. Custom emoji per pemain tampil di hasil tim.

---

**🤖 vs Bot**

Main instan tanpa menunggu lawan. Bot pilih senjata acak. Stats tetap tercatat (W/L/D) tapi tidak memengaruhi ELO.

```
@GubakeBot BOT
@GubakeBot BOT BO3
```

---

**🌐 Open Challenge**

Buat game terbuka — siapa saja yang ketik `@GubakeBot OPEN` dalam 9 menit bisa join tanpa perlu tahu kodenya.

```
@GubakeBot OPEN
@GubakeBot OPEN BO3
```

Kalau ada challenge terbuka di popup, pilih "Join [nama]" untuk langsung lawan.

---

**📊 VS @username — Statistik Head-to-Head**

Lihat rekor kamu vs seseorang secara spesifik:

```
@GubakeBot VS @username
```

Menampilkan W/L/D kamu vs mereka.

---

**📺 LAST — Replay Game Terakhir**

Lihat ringkasan game terakhirmu:

```
@GubakeBot LAST
```

---

**🏆 Tournament**

Bot di-add ke grup → ketik `/tournament 8` (atau jumlah pemain lain) → peserta klik Join → host mulai bracket → pertandingan berjalan otomatis satu babak per babak sampai ada pemenang.

---

### 🏘️ Fitur Grup (Bot Di-Add ke Grup)

Setelah bot di-add sebagai member grup, fitur tambahan aktif:

- **📢 Pengumuman game** — ketik `/announce` sebelum buka inline, bot kirim notifikasi ke grup saat game dibuat
- **👋 Welcome otomatis** — bot menyapa member baru yang join grup
- **📊 /leaderboard** di grup — tampil sebagai pesan biasa (lebih panjang dari popup inline)
- **📌 Papan skor pinned** — otomatis ter-edit tiap game selesai
- **📈 /groupstats** — statistik khusus grup (total game, champion minggu ini, dll.)
- **🗳️ /poll** dan **🎲 /dice** — buat polling atau kirim dadu native Telegram
- **✅ Membership check** — verifikasi user masih di grup sebelum bisa join Team game atau Tournament

---

### 🔧 Perubahan

- `/clearhost` sekarang juga batalkan game LMS dan Team aktif (sebelumnya hanya 1v1/BO)
- Tombol keyboard dipersingkat teksnya supaya muat di semua ukuran layar
- Waktu ekspiry ditampilkan di pesan tunggu LMS dan Team
- Peringatan ekspiry dikirim ke grup 1 menit sebelum game kadaluarsa

---

## v1.8.0 — 22 Mei 2026

### ✨ Fitur Baru

**🏅 Ranked Mode**

Game yang memengaruhi ELO. Badge 🏅 di pesan tunggu. Bisa dikombinasi dengan semua mode lain:

```
@GubakeBot RANKED
@GubakeBot RANKED BO3
@GubakeBot RANKED BO5 @budi
```

Game biasa (non-ranked) tidak mengubah ELO sama sekali.

---

**🏆 Achievements / Badge**

9 pencapaian yang bisa di-unlock:

| Pencapaian | Syarat |
|-----------|--------|
| First Win | Menang pertama kali |
| Winning Streak | Menang 5× beruntun |
| On Fire | Menang 10× beruntun |
| Unstoppable | Menang 20× beruntun |
| Veteran | Main 10 game |
| Seasoned | Main 100 game |
| Champion | 10 kemenangan total |
| Elite | 50 kemenangan total |
| Legend | 100 kemenangan total |

Bot kirim DM saat pencapaian pertama kali di-unlock. Total badge yang terkumpul tampil di stats popup.

---

**🎖️ Streak Shield** *(Premium)*

Satu kali per hari, kekalahan tidak memutus streak kamu. Shield aktif otomatis selama tier Premium berlaku. Setelah shield terpakai dalam sehari, kalah berikutnya baru memutus streak.

---

**🔔 Notifikasi Streak**

Bot kirim DM saat kamu capai milestone streak: **5×, 10×, 20×, 50×, 100×** win beruntun.

---

## v1.7.0 — 22 Mei 2026

### ✨ Fitur Baru

**🏆 BO5 / BO7 — Seri Lebih Panjang**

```
@GubakeBot BO5    → menang 3 ronde dulu
@GubakeBot BO7    → menang 4 ronde dulu
@GubakeBot RANKED BO5
@GubakeBot BO7 @budi
```

---

**⚡ ELO Rating**

Rating dimulai dari **1000** saat pertama main Ranked. Naik kalau menang vs lawan rating lebih tinggi, turun kalau kalah vs lawan rating lebih rendah. Draw ubah rating sedikit.

Tampil di stats popup:

```
⚡ ELO: 1047  (+47)
```

---

**🔑 Custom Game Code** *(Premium)*

User Premium bisa pakai kode sendiri sebagai ID game:

```
@GubakeBot HARIMAU
@GubakeBot RAVEN BO3
@GubakeBot RANKED BADAI
```

Kode tidak boleh sama dengan command yang sudah ada (`BOT`, `OPEN`, `LMS`, dll.). Kalau kode sedang dipakai orang lain, bot minta kode lain.

---

## v1.6.0 — 22 Mei 2026

### ✨ Fitur Baru

**📊 Streak per Periode**

Statistik `@GubakeBot STATS` sekarang menampilkan streak harian, mingguan, dan bulanan:

```
🔥 Streak
Sekarang: 3 win beruntun
Terpanjang: 7×

  📅 Hari ini: 3×
  📅 Minggu ini: 5×
  📅 Bulan ini: 7×
```

Sub-baris hanya muncul kalau nilainya > 0. Periode dihitung dari tanggal rilis bot.

---

**🏅 Streak vs Satu Lawan**

Rekam streak kemenangan beruntun khusus vs satu lawan tertentu:

```
🏅 Vs satu lawan: 6× (vs Citra · @citra99 · 987654)
```

---

**🔒 Wajib /start Sebelum Main**

Harus pernah kirim `/start` ke bot dulu sebelum bisa buka popup inline. Kalau belum, popup menampilkan arahan untuk DM bot.

Ini memastikan nama dan username semua pemain ter-cache dengan benar untuk tampilan stats dan anti-cheat.

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
