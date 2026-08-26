# GubakeBot — Catatan untuk Claude Code

Bot Rock-Paper-Scissors Telegram (inline mode) di Cloudflare Workers + KV.
Repo: `Ikanuri/rockpaperscissor`.

## Branch & Deploy Workflow

| Branch | Trigger workflow | Deploy ke | Worker |
|--------|------------------|-----------|--------|
| `beta` | `.github/workflows/deploy-beta.yml` | Beta | `rps-bot-beta` (`@gubakebetabot`) |
| `main` | `.github/workflows/deploy.yml` | Production | `rps-bot` (`@GubakeBot`) |
| `claude/*` (dev branch sesi ini) | *(tidak ada)* | — | development only |

**Alur kerja standar:**
1. Develop & commit di branch `beta`
2. `git push origin beta` → auto-deploy ke beta, langsung bisa dites di `@gubakebetabot`
3. Setelah user konfirmasi OK di beta → `git checkout main && git merge beta --ff-only && git push origin main` → auto-deploy ke production
4. Sync balik ke dev branch: `git push origin beta:claude/telegram-rps-game-bot-2C6Ix` (atau branch dev yang sedang aktif)
5. `git checkout beta` lagi untuk lanjut kerja

`main` selalu ancestor dari `beta` di histori repo ini — merge production selalu bisa `--ff-only`. Kalau suatu saat gagal fast-forward, STOP dan tanya user dulu (jangan merge biasa/force).

**Jangan pernah deploy langsung ke production tanpa fix itu terbukti jalan di beta dulu**, kecuali user secara eksplisit minta skip beta (mis. hotfix darurat).

## Isolasi Data

Beta dan production pakai KV namespace terpisah total (`wrangler.toml`):
- Production: `rps-bot-kv` (`c8e5c7ebf6264fe9b450f6794d234d8e`)
- Beta: `rps-beta-kv` (`0475907e01f74cb5bc215856bd1753a6`)

Data beta tidak pernah bocor ke stats production.

## Cek Sebelum Push

```bash
npx tsc --noEmit    # wajib bersih sebelum commit
```

Tidak ada test suite otomatis di repo ini — verifikasi manual di beta adalah satu-satunya jaring pengaman sebelum production.

## Melihat KV Langsung (debugging)

```bash
npx wrangler kv key get "<key>" --namespace-id=<id> --env beta   # beta
npx wrangler kv key get "<key>" --namespace-id=<id>              # production (tanpa --env)
```
ID namespace ada di `wrangler.toml`.

## Cek Status Deploy GitHub Actions

Gunakan MCP tool `mcp__github__actions_list` (method `list_workflow_runs`, resource_id nama workflow file, mis. `deploy.yml`/`deploy-beta.yml`) untuk verifikasi deploy sukses — jangan asumsikan push otomatis berhasil tanpa cek.

## Struktur Kode

- `src/index.ts` — entrypoint fetch/scheduled handler
- `src/game.ts` — logic inti game (semua mode: 1v1, LMS, Team, Tournament), leaderboard, stats
- `src/handlers/inline.ts` — inline query handler (mulai game, join, dll)
- `src/handlers/callback.ts` — callback query handler (tombol: pick, flee, smite, cancel, dll)
- `src/handlers/message.ts` — DM command handler (`/start`, `/donatorlist`, `/freemium`, `/activatetier`, dll)
- `src/handlers/payment.ts` — Stripe & Telegram Stars payment
- `src/donator.ts` — tier donator (basic/premium), expiry logic
- `src/types.ts` — semua interface (GameSession, LmsSession, TeamSession, UserStats, dll)
- `wrangler.toml` — config KV, feature flags, env beta vs production

## Catatan Teknis Penting

- **Privacy mode bot: OFF** — bot menerima semua pesan di grup tempat ia jadi member, termasuk pesan dadu (`msg.dice`) tanpa perlu di-reply/mention.
- Semua efek samping non-critical (update stats, notifikasi) dikirim via `ctx.waitUntil(...)` — errornya silent kecuali dibungkus try/catch dengan `console.error`. Kalau nemu bug "hasil tidak keluar", cek dulu apakah ada `ctx.waitUntil` call yang gagal diam-diam.
- State game (LMS/Team) rawan race condition kalau dua callback masuk hampir bersamaan (mis. dua orang flee bersamaan) — pola fix yang dipakai: re-read state dari KV tepat sebelum keputusan final (lihat `runLmsRound` dan handler flee/smite di `callback.ts`).
- `formatUser()` di `game.ts` menentukan nama yang ditampilkan di seluruh bot (game bubble, leaderboard) — sekarang pakai `first_name` saja, bukan `@username`.
- Leaderboard (`LeaderboardEntry`) menyimpan `name` sebagai snapshot lama — saat display, selalu resolve ulang lewat `user:info:${userId}` KV cache untuk dapat nama terkini, jangan langsung pakai field `name` yang tersimpan.

## Environment Ini (Claude Code on the web)

Sesi berjalan di container remote — akses jaringan keluar (WebFetch ke domain eksternal) dibatasi oleh egress proxy environment, defaultnya diblokir total kecuali di-allowlist eksplisit di pengaturan environment. Kalau perlu baca dokumentasi eksternal (mis. Telegram Bot API changelog) dan WebFetch gagal dengan `EGRESS_BLOCKED`, minta user paste teksnya langsung — jangan andalkan `WebSearch` sebagai pengganti sumber primer karena hasil cuplikannya bisa tidak akurat/berhalusinasi untuk topik yang sangat spesifik/baru.

Git CLI lokal kadang kehilangan auth ke GitHub di sesi/container baru (proxy git lokal tidak selalu tersedia). Kalau `git push`/`git fetch` gagal dengan error kredensial (`could not read Username`), pakai GitHub MCP tools (`mcp__github__push_files`, `create_or_update_file`, `list_branches`, dll) sebagai jalur alternatif untuk commit & sinkronisasi branch.
