# GubakeBetaBot — Panduan Beta Tester

> Semua yang ada di sini hanya berlaku di **beta**. Data tidak masuk ke stats production.
> Temukan bug? Screenshot + ceritakan kondisinya ke host.

---

## ⚠️ Wajib Sebelum Mulai

Buka chat langsung dengan bot → ketik `/start`

Tanpa ini kamu **tidak bisa main inline** sama sekali.

---

## 🎮 Mode Game (Inline)

Buka chat mana saja → ketik `@GubakeBetaBot` lalu salah satu query berikut:

| Query | Keterangan |
|---|---|
| *(kosong)* | 1v1 biasa, single round |
| `BO3` / `BO5` / `BO7` | Best-of series |
| `RANKED` / `RANKED BO3` | Ranked — ELO berubah |
| `@username` | Private, hanya target bisa join |
| `BOT` | Lawan AI, instan, tidak perlu lawan |
| `OPEN` | Open challenge, siapa saja bisa join |
| `LMS` / `LMS 5` | Last Man Standing 3–8 orang |
| `KODE` | Join game orang lain dengan kode mereka |
| `NAMACODE` *(Premium)* | Kode game custom buatan sendiri |

Setelah pilih senjata → pesan terkirim ke chat → lawan join lewat tombol atau kode.

---

## 📊 Statistik & Riwayat

Ketik `@GubakeBetaBot` lalu:

| Query | Keterangan |
|---|---|
| `STATS` | W/L/D, ELO, streak harian/mingguan/bulanan, achievements |
| `LAST` | Recap game terakhir (pilihan, hasil, lawan) |
| `VS @username` | Head-to-head history vs satu orang |
| `TOP` | Leaderboard global |
| `CLEARHOST` | Batalkan semua game aktif yang kamu host |

**Streak dihitung per periode:**
- Hari ini, minggu ini, bulan ini — reset saat periode berganti
- Periode dihitung dari tanggal rilis: **22 Mei 2026** (Week 1 = 22–28 Mei)

**ELO:** hanya berubah di game `RANKED`. Default 1000.

---

## ⚔️ Last Man Standing (LMS)

### Cara Main

1. Ketik `@GubakeBetaBot LMS` atau `@GubakeBetaBot LMS 6` (tentukan jumlah pemain, default 4, max 8)
2. Pilih senjata → pesan terkirim, kode LMS muncul di pesan
3. Pemain lain join dengan klik tombol Join atau ketik kode LMS di inline
4. Game mulai otomatis saat slot penuh

### Alur Per Ronde

Setelah semua pemain aktif memilih:

```
Semua pilihan dikumpulkan
        │
        ▼
   Berapa pilihan unik?
        │
   ┌────┴────┐
   1 atau 3   2
   (chaos)  (normal)
        │        │
  Semua lanjut  Pilihan kalah → eliminasi
  main ulang    Pilihan menang → lanjut
```

**Chaos round** terjadi kalau:
- Semua pilih sama (1 pilihan unik)
- Ketiga pilihan muncul (3 pilihan unik) → tidak ada yang bisa dieliminasi

**Eliminasi normal** terjadi kalau ada tepat 2 pilihan unik — pihak kalah keluar.

### Contoh

```
Ronde 1: Andi(✊) Budi(✊) Citra(✌️) Dani(✋)
→ 3 pilihan unik → CHAOS, semua lanjut

Ronde 2: Andi(✊) Budi(✋) Citra(✊) Dani(✋)
→ ✊ vs ✋ → ✊ kalah → Andi & Citra eliminasi

Sisa: Budi(✋) Dani(✋) → 1 pilihan → CHAOS

Ronde 3: Budi(✌️) Dani(✊)
→ ✌️ vs ✊ → ✌️ kalah → Budi eliminasi

🏆 DANI MENANG
```

### Catatan Teknis

- Setiap pemain punya inline message sendiri — tidak saling lihat pilihan sebelum reveal
- Pemain yang sudah eliminasi tetap bisa melihat jalannya game di pesan mereka
- Stats: pemenang +1 win, semua yang kalah +1 loss

---

## 👥 Team Mode

### Prasyarat

Bot harus sudah di-add ke grup yang akan dipakai.

### Alur Setup

**Step 1 — Setup di grup:**
```
Ketik /team 2v2 di grup
→ bot menyimpan grup ini sebagai lokasi team game kamu (berlaku 5 menit)
→ Bisa juga: /team 1v1, /team 3v3, /team 4v4
→ Opsional mode: /team 2v2 BO3
```

**Step 2 — Buka inline:**
```
@GubakeBetaBot TEAM 2v2
→ pilih senjata → pesan terkirim ke chat
```

**Step 3 — Teman bergabung:**

Di pesan yang terkirim ada dua tombol:
- **🤝 Tim A** → tombol switch inline → teman pilih senjata → kirim pesan Tim A
- **⚔️ Tim B** → tombol switch inline → teman pilih senjata → kirim pesan Tim B

Game mulai otomatis saat semua slot kedua tim penuh.

### Penentuan Pilihan Tim (Majority Vote)

Setelah semua anggota tim memilih:

```
Kumpulkan semua pilihan dalam satu tim
              │
    Ada pilihan mayoritas?
         ┌────┴────┐
        YA         TIDAK (seri)
         │              │
  Mayoritas menang   Lempar 🎲 dadu
  Minoritas diabaikan  di grup untuk
                    tiap pemain seri
                         │
                   Angka tertinggi menang
                   (max 3x ulang jika masih seri)
```

Pilihan resmi tim = pilihan pemenang vote/dadu.
Kemudian pilihan Tim A vs Tim B menentukan pemenang ronde.

### Contoh Tiebreaker Dadu

```
Tim A: Andi(✊) Budi(✋) — seri
Bot kirim dadu di grup:
  Andi 🎲 → 4
  Budi 🎲 → 2
→ Andi menang dadu → Tim A = ✊

Tim A ✊ vs Tim B ✌️ → Tim A menang 🏆
```

### Catatan Teknis

- Kalau pilihan kedua tim sama → chaos round, semua pilih ulang
- Hasil tiebreaker dadu terlihat di grup sebagai animasi dadu native Telegram
- Mode BO3/BO5/BO7: best-of per ronde, tim pertama capai max wins menang keseluruhan
- Stats dicatat per pemain (bukan per tim)

---

## 🏆 Tournament

1. Ketik `/tournament 8` di grup *(4–16 pemain, harus genap atau akan di-pad)*
2. Pemain klik **Daftar** di pesan signup
3. Host klik **Mulai** (atau otomatis mulai kalau slot penuh)
4. Bracket diacak → tiap match dapat kode game sendiri
5. Pemain main via kode masing-masing (inline biasa)
6. Pemenang tiap match otomatis lanjut ke ronde berikutnya
7. Final → juara diumumkan ke grup

> Draw di tournament → pemenang diundi otomatis (50/50).

---

## 🏘️ Command di Grup

| Command | Keterangan |
|---|---|
| `/leaderboard` | Top player global |
| `/groupstats` | Leaderboard khusus grup ini |
| `/stats` | Streak & weekly stats kamu |
| `/poll` | Poll pilihan mode game |
| `/dice` | Lempar dadu animasi *(opsional emoji: 🎯🏀⚽🎳🎰)* |
| `/team 2v2` | Setup sebelum buka Team Mode inline |
| `/tournament 8` | Mulai signup turnamen |

**Otomatis di grup:**
- Pengumuman game baru ke grup
- ⚠️ Peringatan game mau expire (~8 menit)
- 📌 Scoreboard pinned diperbarui otomatis tiap game selesai
- 🌅 Daily challenge tiap tengah malam UTC + pengumuman champion kemarin

---

## 🎨 Kustomisasi Tampilan

Semua command ini hanya bisa dipakai lewat **DM (chat pribadi) dengan bot**.

### Reveal Emoji
Muncul saat hasil game ditampilkan.

```
/setemoji rock      → lalu kirim emoji
/setemoji paper     → lalu kirim emoji
/setemoji scissors  → lalu kirim emoji
```

Bisa emoji biasa atau custom emoji animasi. **Animated emoji butuh Premium.**

### Popup Sticker
Muncul sebagai tombol pilihan di inline (menggantikan artikel teks).

```
/setsticker rock      → lalu kirim stiker
/setsticker paper     → lalu kirim stiker
/setsticker scissors  → lalu kirim stiker
```

### Thumbnail Inline
Gambar kecil di samping pilihan di inline query.

```
/setthumb rock url <link>   → dari URL gambar
/setthumb rock gif          → lalu kirim GIF
/setthumb rock sticker      → lalu kirim stiker
/delthumb rock              → hapus thumbnail
```

### Manajemen

```
/myconfig   → lihat semua config kamu saat ini
/reset      → kembalikan semua ke default
```

---

## 🔔 Notifikasi DM Otomatis dari Bot

- Streak milestone tercapai: **5x, 10x, 20x, 50x, 100x**
- Achievement baru di-unlock (first win, 10 wins, streak 5x, dst)

---

## 💡 Catatan Penting

- **Data beta tidak masuk ke stats production** — saat launch nanti semua mulai dari 0
- Stats periode (hari/minggu/bulan) dihitung dari **22 Mei 2026**
- Tombol **🔄** di waiting message → refresh untuk lihat sisa waktu
- Untuk join Team game atau Tournament: kamu harus masih ada di grup tersebut
- Kalau ketemu bug atau perilaku aneh → screenshot + ceritakan langkah yang kamu lakukan
