# Panduan Deployment — GubakeBot

## Branch & Workflow

| Branch | Workflow dipicu | Deploy ke |
|--------|----------------|-----------|
| `beta` | `deploy-beta.yml` | Beta Worker (`rps-bot-beta`) |
| `main` | `deploy.yml` | Production Worker (`rps-bot`) |
| `claude/*` | *(tidak ada)* | Development only — push ke `beta` via `git push origin HEAD:beta` |

---

## GitHub Secrets

Secrets bersifat **repository-level** — bukan per-branch. Diatur di satu tempat:
**GitHub repo → Settings → Secrets and variables → Actions → New repository secret**

Semua workflow di repo ini bisa mengakses secret yang sama, dibedakan hanya dari nama variabelnya.

### Secrets yang diperlukan

| Secret | Dipakai oleh | Keterangan |
|--------|-------------|------------|
| `CLOUDFLARE_API_TOKEN` | Beta + Production | API token Cloudflare dengan permission Workers & KV |
| `CLOUDFLARE_ACCOUNT_ID` | Beta + Production | Account ID dari Cloudflare dashboard |
| `BOT_TOKEN_BETA` | Beta only | Token @GubakeBetaBot dari BotFather |
| `BOT_TOKEN` | Production only | Token @GubakeBot dari BotFather |
| `WEBHOOK_SECRET` | Production only | String random bebas — untuk validasi request dari Telegram |
| `STRIPE_SECRET_KEY` | Production (opsional) | Stripe secret key — hanya kalau mau aktifkan Stripe payments |
| `STRIPE_WEBHOOK_SECRET` | Production (opsional) | Stripe webhook secret — diperlukan kalau `STRIPE_SECRET_KEY` diisi |

> **Beta tidak perlu `WEBHOOK_SECRET`** — beta workflow tidak push secret ini ke Worker.
> Kalau ingin menambahkannya ke beta juga, update `deploy-beta.yml`.

---

## Setup Awal (Sekali Saja)

### 1. Buat bot di BotFather

Untuk masing-masing bot (beta dan production):
- `/newbot` — buat bot, catat token-nya
- `/setinline` → aktifkan inline mode
- `/setprivacy` → matikan (OFF) — supaya bot bisa terima pesan di grup

### 2. Isi GitHub Secrets

Buka **GitHub repo → Settings → Secrets and variables → Actions**, lalu tambahkan:

```
CLOUDFLARE_API_TOKEN    = <dari Cloudflare dashboard → My Profile → API Tokens>
CLOUDFLARE_ACCOUNT_ID   = <dari Cloudflare dashboard → kanan bawah>
BOT_TOKEN_BETA          = <token @GubakeBetaBot>
BOT_TOKEN               = <token @GubakeBot>
WEBHOOK_SECRET          = <string random, contoh: abc123xyz789>
```

### 3. Pastikan KV namespace sudah ada

Cek `wrangler.toml` — KV ID production dan beta sudah terkonfigurasi:
- Production: `id = "c8e5c7ebf6264fe9b450f6794d234d8e"`
- Beta: `id = "0475907e01f74cb5bc215856bd1753a6"`

Kalau namespace belum ada, buat via Cloudflare dashboard → Workers & Pages → KV.

---

## Deploy Beta

Otomatis terpicu setiap push ke branch `beta`.

Kalau ingin trigger manual: GitHub → Actions → **Deploy Beta to Cloudflare Workers** → **Run workflow**.

Workflow yang berjalan (`deploy-beta.yml`):
1. Push `BOT_TOKEN_BETA` sebagai secret ke beta Worker
2. Deploy ke `rps-bot-beta`

> Webhook beta didaftarkan manual satu kali — lihat komentar di `wrangler.toml`.

---

## Deploy Production

### Cara biasa — Merge `beta` → `main`

1. Buka GitHub → **Pull Requests** → **New pull request**
2. Base: `main` ← Compare: `beta`
3. Review, lalu **Merge**
4. Workflow `deploy.yml` otomatis berjalan

### Trigger manual

GitHub → Actions → **Deploy to Cloudflare Workers (Production)** → **Run workflow**.

### Yang dilakukan workflow (`deploy.yml`):

1. Push secrets ke production Worker (`BOT_TOKEN`, `WEBHOOK_SECRET`, Stripe jika ada)
2. Deploy ke `rps-bot`
3. Daftarkan webhook @GubakeBot ke Telegram secara otomatis
4. CI merah kalau webhook gagal terdaftar

---

## Setelah Production Deploy Pertama

### RELEASE_DATE otomatis

Tidak perlu setting manual. Saat request pertama masuk (game pertama dibuat), bot menulis timestamp ke KV key `config:release_date`. Semua statistik periode (harian/mingguan/bulanan) dan leaderboard dihitung relatif dari titik ini.

### Verifikasi

- Kirim `/start` ke @GubakeBot
- Coba buat satu game inline
- Cek Cloudflare dashboard → KV production → pastikan key `config:release_date` muncul

---

## Struktur KV Namespace

| Namespace | Worker | Isi |
|-----------|--------|-----|
| `rps-bot-kv` (c8e5c7e...) | Production `rps-bot` | Stats, game sessions, config production |
| `rps-beta-kv` (0475907...) | Beta `rps-bot-beta` | Stats, game sessions, config beta — terpisah sepenuhnya |

Data beta tidak pernah bercampur dengan production.

---

## Rollback

Kalau production bermasalah setelah deploy baru:

1. Buka GitHub → Actions → cari run deploy sebelumnya yang sukses
2. Re-run workflow tersebut, **atau**
3. Revert commit di `main` → push → workflow deploy ulang otomatis
