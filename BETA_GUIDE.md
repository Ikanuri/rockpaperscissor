# GubakeBetaBot — Panduan Beta Tester

> Kamu adalah beta tester. Artinya kamu mencoba fitur yang belum dirilis ke publik.
> Data yang kamu hasilkan **tidak akan masuk ke stats production** — semua mulai dari nol saat rilis resmi.
> Kalau ketemu sesuatu yang aneh, screenshot dan ceritakan langkah yang kamu lakukan.

---

## Daftar Isi

1. [Langkah Pertama](#1-langkah-pertama)
2. [Cara Main — 1v1 Dasar](#2-cara-main--1v1-dasar)
3. [Mode Permainan](#3-mode-permainan)
4. [Statistik & Riwayat](#4-statistik--riwayat)
5. [Last Man Standing](#5-last-man-standing)
6. [Team Mode](#6-team-mode)
7. [Tournament](#7-tournament)
8. [Fitur di Grup](#8-fitur-di-grup)
9. [Kustomisasi Tampilan](#9-kustomisasi-tampilan)
10. [Notifikasi Otomatis](#10-notifikasi-otomatis)

---

## 1. Langkah Pertama

Sebelum bisa melakukan apa pun, kamu harus mendaftarkan diri ke bot terlebih dahulu.

**Kenapa?**
Bot perlu mengenalmu sebelum kamu bisa main inline. Ini juga memastikan username kamu tercatat dengan benar untuk fitur seperti private challenge dan head-to-head stats.

**Cara:**
1. Buka Telegram
2. Cari `@GubakeBetaBot`
3. Tekan **Start** atau ketik `/start`
4. Bot akan menyambut kamu — selesai

Kamu hanya perlu melakukan ini **sekali seumur hidup**. Setelah itu kamu bebas bermain dari chat mana pun.

---

## 2. Cara Main — 1v1 Dasar

Game dimainkan lewat **inline mode** — artinya kamu tidak main di dalam chat bot, melainkan mengirim pesan ke chat lain (grup, DM dengan teman, dll) melalui bot.

### Memulai Game (sebagai Host)

1. Buka chat mana saja — bisa grup, bisa DM dengan teman
2. Di kolom pesan, ketik `@GubakeBetaBot` (jangan tekan enter dulu)
3. Akan muncul popup pilihan di atas keyboard
4. Pilih salah satu senjata: ✊ Rock, ✋ Paper, atau ✌️ Scissors
   — atau pilih 🎲 **Random** untuk biarkan nasib yang memilih
5. Tekan pilihan tersebut — pesan otomatis terkirim ke chat
6. Pesan berisi kode game dan tombol **Join**

### Bergabung sebagai Lawan

Ada dua cara lawan bisa join:

**Cara A — Tombol Join di pesan:**
1. Lawan melihat pesan game kamu di chat
2. Lawan tekan tombol **🎮 Join**
3. Inline popup muncul di sisi lawan
4. Lawan pilih senjata → pesan lawan terkirim
5. Kedua pilihan diungkap → hasil ditampilkan

**Cara B — Kode manual:**
1. Kamu bagikan kode 6 huruf (contoh: `ABCD12`) ke lawan
2. Lawan ketik `@GubakeBetaBot ABCD12` di inline
3. Lawan pilih senjata → game dimulai

### Membatalkan Game

Kalau tidak ada yang join dalam 10 menit, game otomatis expire.
Kalau ingin membatalkan lebih awal: tekan tombol **❌ Cancel** di pesan game kamu.

### Rematch

Setelah game selesai, tombol **🔄 Rematch** akan muncul di pesan hasil.
Kedua pemain menekan Rematch → game baru langsung dimulai tanpa perlu kode.

---

## 3. Mode Permainan

Semua mode dimulai dengan cara yang sama: ketik `@GubakeBetaBot` lalu tambahkan query di bawah ini.

---

### Best-of Series (BO3 / BO5 / BO7)

**Apa ini?**
Alih-alih satu ronde langsung menentukan pemenang, kalian main beberapa ronde. Pemenang adalah siapa yang pertama mencapai batas kemenangan.

| Mode | Ronde maks | Menang setelah |
|---|---|---|
| BO3 | 3 ronde | 2 kemenangan |
| BO5 | 5 ronde | 3 kemenangan |
| BO7 | 7 ronde | 4 kemenangan |

**Cara:**
1. Ketik `@GubakeBetaBot BO3` (atau BO5/BO7)
2. Pilih senjata → pesan terkirim
3. Lawan join → game mulai
4. Setiap ronde selesai, skor ditampilkan dan ronde berikutnya langsung dimulai

---

### Ranked

**Apa ini?**
Game yang mempengaruhi **ELO rating** kamu. Menang di ranked memberi ELO lebih banyak kalau lawan ratingnya tinggi, dan sebaliknya.

Rating awal semua pemain: **1000**.

**Cara:**
1. Ketik `@GubakeBetaBot RANKED` atau `@GubakeBetaBot RANKED BO3`
2. Pilih senjata → lawan join → game dimulai seperti biasa
3. Setelah selesai, ELO kedua pemain diperbarui otomatis

> Game biasa (non-ranked) tidak mengubah ELO sama sekali.

---

### Private Challenge

**Apa ini?**
Game yang dikunci untuk satu orang tertentu — hanya orang itu yang bisa join, tidak peduli siapa yang lihat kodenya.

**Cara:**
1. Ketik `@GubakeBetaBot @username` (ganti dengan username target)
2. Pilih senjata → pesan terkirim
3. Hanya `@username` tersebut yang bisa menekan Join
4. Orang lain yang mencoba join akan ditolak

> Bisa dikombinasikan: `@GubakeBetaBot @username BO3`

---

### vs Bot (AI)

**Apa ini?**
Main melawan AI — instan, tidak perlu menunggu lawan. Hasilnya langsung keluar. Cocok untuk latihan atau sekadar iseng.

**Cara:**
1. Ketik `@GubakeBetaBot BOT`
2. Pilih senjata → hasil langsung muncul
3. Ada tombol **Main lagi** untuk rematch instan

> Game vs Bot tetap mencatat stats (W/L/D), tapi tidak mempengaruhi ELO.

---

### Open Challenge

**Apa ini?**
Game tanpa lawan spesifik — siapa saja yang membuka `@GubakeBetaBot OPEN` bisa melihat daftar open challenge yang tersedia dan langsung join.

**Cara (sebagai pembuat tantangan):**
1. Ketik `@GubakeBetaBot OPEN`
2. Pilih senjata → pesan terkirim
3. Siapa pun yang membuka `OPEN` dalam 9 menit bisa join

**Cara (sebagai yang ingin join):**
1. Ketik `@GubakeBetaBot OPEN`
2. Kalau ada challenge yang tersedia, daftarnya muncul di popup
3. Pilih "Join [nama]" → pilih senjata → game dimulai

---

### Kode Custom *(Premium)*

**Apa ini?**
Buat game dengan kode yang kamu tentukan sendiri, bukan kode acak 6 huruf. Misalnya `RAVEN`, `TOPG`, atau nama timmu.

**Cara:**
1. Ketik `@GubakeBetaBot NAMACODE` (2–20 huruf/angka)
2. Pilih senjata → pesan terkirim dengan kode pilihanmu
3. Bagikan kode tersebut ke lawan

> Fitur ini butuh tier **Premium**. Lawan yang ingin join tidak perlu Premium.

---

## 4. Statistik & Riwayat

Semua diakses lewat inline — ketik `@GubakeBetaBot` lalu query di bawah.

---

### STATS — Statistik Lengkap

Menampilkan ringkasan performa kamu secara keseluruhan.

**Cara:** Ketik `@GubakeBetaBot STATS` → pilih kartu Stats → kirim

**Yang ditampilkan:**
- **W/L/D** — total menang, kalah, seri sepanjang masa
- **ELO** — rating ranked kamu saat ini
- **Pilihan favorit** — senjata yang paling sering kamu pakai
- **Streak sekarang** — berapa kemenangan berturut-turut saat ini
- **Streak terpanjang** — rekor streak kamu sepanjang masa
- **Streak periode** — streak di hari ini / minggu ini / bulan ini
- **Streak vs satu lawan** — rekor menang beruntun melawan satu orang yang sama
- **This week** — W/L/D khusus minggu ini
- **Achievements** — pencapaian yang sudah dibuka

> Periode dihitung dari **22 Mei 2026** (bukan kalender biasa).
> Contoh: Week 1 = 22–28 Mei, Week 2 = 29 Mei–4 Juni.

---

### LAST — Game Terakhir

Menampilkan rekap satu game terakhir yang kamu mainkan.

**Cara:** Ketik `@GubakeBetaBot LAST` → pilih kartu → kirim

**Yang ditampilkan:** lawan siapa, pilihan masing-masing, hasil, waktu

---

### VS — Head-to-Head

Menampilkan statistik kamu secara spesifik melawan satu pemain.

**Cara:** Ketik `@GubakeBetaBot VS @username` → pilih kartu → kirim

**Yang ditampilkan:** W/L/D vs orang itu, win rate, streak terpanjang vs mereka

> Lawan harus sudah pernah `/start` bot agar bisa dicari.

---

### TOP — Leaderboard Global

Menampilkan 20 pemain teratas berdasarkan jumlah kemenangan.

**Cara:** Ketik `@GubakeBetaBot TOP` → pilih kartu → kirim

---

### CLEARHOST — Batalkan Semua Game Aktif

Kalau kamu punya beberapa game aktif yang belum ada lawannya dan ingin membatalkan semuanya sekaligus.

**Cara:** Ketik `@GubakeBetaBot CLEARHOST` → pilih kartu → kirim

---

## 5. Last Man Standing

### Apa Ini?

Mode multiplayer di mana 3–8 orang bermain bersama dalam satu sesi. Setiap ronde, pemain yang memilih senjata kalah akan dieliminasi. Game berlanjut sampai hanya tersisa 1 pemenang.

### Cara Memulai

1. Ketik `@GubakeBetaBot LMS` (default 4 pemain) atau `@GubakeBetaBot LMS 6` untuk menentukan jumlah
2. Pilih senjata → pesan terkirim dengan kode LMS (format: `LXXXXXX`)
3. Bagikan kode tersebut atau biarkan teman menekan tombol Join
4. Tiap orang yang join akan memilih senjata saat bergabung
5. Game mulai otomatis saat semua slot penuh

### Cara Bergabung (sebagai Peserta)

1. Tekan tombol **Join** di pesan, atau ketik kode LMS di inline: `@GubakeBetaBot LXXXXXX`
2. Pilih senjata → pesanmu terkirim
3. Tunggu sampai semua slot penuh

> Setiap pemain punya pesan sendiri — kamu tidak bisa melihat pilihan orang lain sebelum hasil diungkap.

### Alur Ronde

Setelah semua pemain aktif memilih senjata:

```
Kumpulkan semua pilihan
         │
   Berapa jenis senjata berbeda?
         │
    ┌────┴─────┐
   2 jenis    1 atau 3 jenis
  (normal)      (chaos)
     │              │
  Pilihan kalah   Tidak ada yang
  → dieliminasi   dieliminasi, semua
                  main ulang
```

**Normal:** Dua senjata muncul → senjata yang kalah keluar bersama pemainnya.

**Chaos:** Semua pilih sama, atau ketiga senjata muncul → tidak ada yang bisa dieliminasi, semua lanjut ke ronde berikutnya.

### Contoh Lengkap

```
Peserta: Andi, Budi, Citra, Dani (4 orang)

Ronde 1:
  Andi ✊  Budi ✊  Citra ✌️  Dani ✋
  → Tiga senjata muncul → CHAOS, semua lanjut

Ronde 2:
  Andi ✊  Budi ✋  Citra ✊  Dani ✋
  → ✊ vs ✋ → ✊ kalah → Andi & Citra eliminasi

Sisa: Budi(✋) & Dani(✋)
  → Satu senjata → CHAOS, main ulang

Ronde 3:
  Budi ✌️  Dani ✊
  → ✌️ vs ✊ → ✌️ kalah → Budi eliminasi

🏆 DANI MENANG
```

### Catatan

- Pemain yang sudah eliminasi tetap bisa melihat jalannya game di pesan mereka
- Stats dicatat setelah game selesai: pemenang +1 win, semua yang kalah +1 loss

---

## 6. Team Mode

### Apa Ini?

Mode di mana dua tim berhadapan. Tiap tim memilih senjata secara independen, lalu pilihan resmi tim ditentukan dari suara mayoritas anggota. Cocok untuk main tim di grup.

### Prasyarat

Bot harus sudah **di-add sebagai member di grup** yang akan dipakai untuk main.

### Alur Setup — Step by Step

**Step 1 — Daftarkan grup (di grup):**
```
Ketik /team 2v2 di grup yang ingin dipakai
```
Bot akan menyimpan grup ini sebagai lokasi team game kamu selama **5 menit**.
Bisa juga: `/team 1v1`, `/team 3v3`, `/team 4v4`
Mode opsional: `/team 2v2 BO3`

**Step 2 — Buat game (inline):**
```
@GubakeBetaBot TEAM 2v2
```
Pilih senjata → pesan terkirim ke chat.

**Step 3 — Isi tim:**

Di pesan yang terkirim ada tombol:
- **🤝 Tim A (N slot)** — untuk bergabung ke tim kamu (tim host)
- **⚔️ Tim B (N slot)** — untuk bergabung ke tim lawan

Teman yang ingin bergabung menekan tombol sesuai tim pilihan → popup inline muncul → pilih senjata → pesan mereka terkirim.

Game mulai otomatis saat semua slot kedua tim penuh.

### Penentuan Pilihan Tim

Setelah semua anggota tim memilih:

**Jika ada mayoritas jelas:**
Pilihan terbanyak menjadi pilihan resmi tim. Anggota yang memilih berbeda → pilihan mereka diabaikan (dicatat sebagai catatan).

**Jika seri (50/50 atau tidak ada mayoritas):**
Bot mengirim 🎲 dadu animasi di grup untuk setiap pemain yang seri. Angka tertinggi menang — pilihan orang tersebut menjadi pilihan resmi tim. Kalau masih seri setelah 3x lempar, dipilih secara acak.

### Contoh

```
Tim A: Andi(✊) Budi(✊) → mayoritas ✊ → Tim A = ✊
Tim B: Citra(✌️) Dani(✌️) → mayoritas ✌️ → Tim B = ✌️

✊ vs ✌️ → ✊ menang → Tim A 🏆

---

Tim A: Andi(✊) Budi(✋) → seri, lempar dadu:
  Andi 🎲 4  |  Budi 🎲 2 → Andi menang dadu → Tim A = ✊
Tim B: Citra(✌️) Dani(✌️) → mayoritas ✌️ → Tim B = ✌️

✊ vs ✌️ → ✊ menang → Tim A 🏆
```

### Kalau Kedua Tim Pilih Sama

Jika Tim A dan Tim B memilih senjata yang sama → **chaos round**, semua anggota diminta memilih ulang.

### Mode BO3/BO5/BO7 di Team Mode

Sama seperti 1v1 — tim yang pertama mencapai batas kemenangan menang keseluruhan.

### Catatan

- Kamu harus masih terdaftar sebagai anggota grup untuk bisa bergabung ke tim
- Stats dicatat per individu (bukan per tim)
- Animasi dadu tiebreaker akan terlihat oleh semua orang di grup

---

## 7. Tournament

### Apa Ini?

Turnamen bracket single-elimination di dalam grup. Host mendaftarkan peserta, bot membuat bracket otomatis, dan tiap match dimainkan seperti game 1v1 biasa menggunakan kode yang sudah disiapkan bot.

### Cara Mengadakan Tournament

**Step 1 — Buat turnamen (di grup):**
```
/tournament 8
```
Ganti `8` dengan jumlah pemain (4–16, harus genap atau akan di-pad otomatis).

Bot akan mengirim pesan signup ke grup berisi daftar pendaftar dan tombol:
- **🤝 Daftar** — untuk bergabung sebagai peserta
- **🚀 Mulai sekarang** — hanya bisa ditekan host (minimal 2 pemain)

**Step 2 — Kumpulkan peserta:**

Peserta menekan tombol **Daftar** di pesan signup.
Pesan akan diperbarui otomatis setiap ada yang daftar.

> Kalau slot penuh → turnamen mulai otomatis tanpa perlu ditekan Mulai.

**Step 3 — Mulai bracket:**

Host menekan **Mulai sekarang** (atau otomatis kalau penuh).
Bot mengirim bracket ke grup — tiap match mendapat kode game sendiri.

**Step 4 — Main tiap match:**

Peserta yang dijadwalkan bertanding menggunakan kode yang tertera:
```
@GubakeBetaBot KODE_MATCH
```
Mainkan seperti game 1v1 biasa. Pemenang otomatis dicatat dan bracket diperbarui.

**Step 5 — Ronde berikutnya:**

Setelah semua match di ronde selesai → bot mengirim bracket ronde berikutnya dengan kode baru.
Berlanjut sampai tersisa satu pemenang → bot mengumumkan juara.

### Catatan

- Draw dalam tournament → pemenang diundi otomatis (50/50), tidak ada perpanjangan
- Kalau jumlah peserta ganjil → satu pemain dapat "bye" (lanjut otomatis)
- Kamu harus masih ada di grup untuk bisa join tournament

---

## 8. Fitur di Grup

Semua fitur ini aktif saat bot sudah di-add sebagai member di grup.

---

### Command Grup

| Command | Keterangan |
|---|---|
| `/leaderboard` | Tampilkan 20 pemain teratas global |
| `/groupstats` | Leaderboard khusus grup ini |
| `/stats` | Lihat streak & stats minggu ini milikmu |
| `/poll` | Buat poll untuk memilih mode game berikutnya |
| `/dice` | Kirim dadu animasi (opsional tambah emoji: `/dice 🎯`) |
| `/team 2v2` | Setup lokasi sebelum membuat Team Mode |
| `/tournament 8` | Mulai signup turnamen di grup |

---

### Fitur Otomatis

**Pengumuman game baru**
Saat kamu membuat game baru setelah mengetik `/team` atau perintah serupa di grup, bot akan mengumumkan ke grup bahwa kamu sedang mencari lawan.

**Peringatan expire**
Kalau ada game yang sudah berjalan hampir 9 menit dan belum ada yang join, bot mengirim peringatan ke grup sekali. Ini membantu orang-orang di grup tahu masih ada yang menunggu lawan.

**Scoreboard pinned otomatis**
Setiap kali ada game selesai di grup, bot memperbarui pesan scoreboard yang di-pin. Kalau belum ada pesan pin, bot akan membuat dan menyematkannya. *(Bot perlu hak Pin Message di grup.)*

**Daily Challenge**
Tiap tengah malam UTC, bot mengirim tantangan harian ke grup. Sebelum challenge baru dikirim, bot mengumumkan siapa champion hari sebelumnya.

---

## 9. Kustomisasi Tampilan

Kamu bisa mengubah tampilan senjata yang muncul di game — mulai dari emoji reveal hingga stiker popup. Semua dilakukan lewat **DM (chat pribadi) dengan bot**, bukan di grup.

---

### Reveal Emoji

**Apa ini?**
Emoji yang muncul sesaat sebelum hasil game diungkap — misalnya ✊ bisa kamu ganti jadi emoji custom animasi pilihanmu.

**Cara mengatur:**
1. Kirim ke bot (DM): `/setemoji rock`
2. Bot akan meminta kamu mengirim emoji
3. Kirim emoji pilihanmu (bisa dari stiker pack custom emoji)
4. Bot mengonfirmasi tersimpan

Ulangi untuk `paper` dan `scissors`.

**Catatan:**
- Emoji biasa bisa dipakai semua tier
- Custom emoji animasi butuh **Premium**

**Cara pakai langsung (tanpa prompt):**
```
/setemoji rock 🪨
```

---

### Popup Sticker

**Apa ini?**
Saat kamu membuka inline popup untuk memilih senjata, alih-alih teks biasa, akan muncul stiker yang kamu pilih sebagai tombol pilihan.

**Cara mengatur:**
1. Kirim ke bot (DM): `/setsticker rock`
2. Bot akan meminta kamu mengirim stiker
3. Kirim stiker pilihanmu dari chat
4. Bot mengonfirmasi tersimpan

Ulangi untuk `paper` dan `scissors`.

---

### Thumbnail Inline

**Apa ini?**
Gambar kecil di sebelah kiri tiap pilihan senjata di inline popup.

**Cara mengatur:**

Dari URL gambar:
```
/setthumb rock url https://contoh.com/gambar.png
```

Dari GIF:
1. `/setthumb rock gif`
2. Kirim GIF ke bot

Dari stiker:
1. `/setthumb rock sticker`
2. Kirim stiker ke bot

**Menghapus thumbnail:**
```
/delthumb rock
```

---

### Melihat & Mereset Config

**Lihat semua config aktif:**
```
/myconfig
```
Menampilkan reveal emoji, popup sticker, dan thumbnail yang sedang aktif untukmu.

**Reset semua ke default:**
```
/reset
```
Menghapus semua kustomisasi pribadi — tampilan kembali ke default global.

---

## 10. Notifikasi Otomatis

Bot akan mengirim DM kepadamu secara otomatis dalam kondisi berikut:

**Streak Milestone**
Saat streak kemenangan berturutmu mencapai: **5x, 10x, 20x, 50x, atau 100x**
Bot mengirim pesan selamat ke DM. Tidak ada yang perlu dilakukan.

**Achievement Baru**
Saat kamu membuka pencapaian tertentu untuk pertama kalinya, misalnya:
- Kemenangan pertama
- 10 kemenangan
- 50 kemenangan
- Streak 5x beruntun
- 10 game dimainkan
- dll.

Bot langsung mengirim notifikasi ke DM begitu achievement ter-unlock.

---

## Tombol Tambahan di Pesan Game

**🔄 di waiting message**
Muncul di pesan saat kamu menunggu lawan. Menekannya akan me-refresh pesan dan menampilkan sisa waktu yang akurat.

**🔄 Rematch setelah game selesai**
Kedua pemain menekan Rematch → game baru langsung dimulai tanpa kode baru.

**❌ Cancel di waiting message**
Hanya bisa ditekan oleh host. Membatalkan game sebelum ada yang join.

---

*GubakeBetaBot — build beta · data tidak masuk production · feedback sangat diapresiasi*
