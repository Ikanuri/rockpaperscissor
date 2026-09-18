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

Kalau muncul error "Cannot find type definition file for '@cloudflare/workers-types'" di container/sesi baru, jalankan `npm ci` dulu (node_modules belum ter-install).

Tidak ada test suite otomatis di repo ini — verifikasi manual di beta adalah satu-satunya jaring pengaman sebelum production.

## Versioning (semver)

Tiga tempat yang HARUS diupdate bersamaan setiap ada perubahan yang layak dirilis:
- `package.json` → field `version`
- `CHANGELOG.md` → entry teknis baru di atas (format Keep a Changelog: Added/Changed/Fixed)
- `PATCHNOTES.md` → entry versi sama, bahasa santai untuk pemain

Aturan bump: ada fitur baru (backward-compatible) → **minor** (2.x.0); cuma bug fix/tweak UI → **patch** (2.1.x); breaking change (schema KV berubah tak kompatibel, dll) → **major**. Ketiga file ini pernah nggak sinkron (`package.json` macet di `1.0.0` sementara changelog sudah `2.0.0`, dan banyak fix tidak pernah dicatat) — jangan ulangi, selalu commit ketiganya sekaligus.

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
- State game (LMS/Team) rawan race condition kalau dua request masuk hampir bersamaan — bukan cuma flee/smite, tapi JOIN dan PICK juga rentan (read-modify-write tanpa re-check). Sudah dipatch di: `runLmsRound` + flee/smite (`callback.ts`), LMS join & next-round pick, Team pick, `TJOIN` team-member join (semua di `inline.ts`). Pola fix: re-read session dari KV tepat sebelum write yang menentukan (write final), supaya window race sekecil mungkin. KV Cloudflare tidak punya compare-and-swap, jadi ini mitigasi praktis, bukan solusi 100% atomic — kalau muncul lagi gejala "pemain hilang/terdepak tanpa sebab" di mode manapun yang punya array pemain bersama (join/pick/flee/smite), curigai pola yang sama dan terapkan fix serupa. Screenshot dari user (khususnya yang menunjukkan hasil akhir game) sangat membantu melacak race condition ini — minta kalau laporan bug tidak jelas urutan kejadiannya.
- `formatUser()` di `game.ts` menentukan nama yang ditampilkan di seluruh bot (game bubble, leaderboard) — sekarang pakai `first_name` saja, bukan `@username`.
- Leaderboard (`LeaderboardEntry`) menyimpan `name` sebagai snapshot lama — saat display, selalu resolve ulang lewat `user:info:${userId}` KV cache untuk dapat nama terkini, jangan langsung pakai field `name` yang tersimpan.

## Rich Message (Bot API 10.1–10.3)

Sejak v2.2.0, hampir semua pesan bot (game modes, guide, credits, pengumuman grup) dikirim/diedit lewat `rich_message` (bukan `text` + `parse_mode: 'HTML'` klasik) — di `telegram.ts`:
- `editInlineMessageRich` — edit pesan inline (`inline_message_id`)
- `editMessageRich` — edit pesan chat biasa (`chat_id` + `message_id`)
- `sendMessageRich` — kirim pesan chat baru (method `sendRichMessage`, BUKAN `sendMessage`)

Ketiganya berbagi `richRequest()` (bangun payload, fetch, fallback) dan parser umum `parseNodes` → `nodesToRichText`/`nodesToBlocks` yang mengonversi string HTML (persis tag classic-HTML-mode Telegram: `<b>`, `<i>`, `<u>`, `<s>`, `<tg-spoiler>`, `<code>`, `<pre>`, `<a href>`, `<blockquote>`/`<blockquote expandable>`, `<tg-emoji emoji-id="...">`) menjadi struktur `blocks` yang benar, termasuk nesting sembarang (`<b>bold <i>italic</i></b>`). Tombol (`InlineKeyboardMarkup`) ikut dikonversi ke `InputRichBlockButtons`/`RichMessageButton` lewat `keyboardToButtonBlocks` — field-nya (`callback_data`, `style`, `switch_inline_query_current_chat`, `url`) 1:1 sama dengan tombol lama, jadi `callback_data` tetap trigger `callback_query` normal tanpa perlu ubah routing di `handleCallbackQuery`.

**Kalau API menolak** (format tidak didukung, dll), otomatis fallback ke `editInlineMessage`/`editMessage`/`sendMessage` klasik dengan teks + keyboard yang SAMA — jadi eksperimen rich tidak pernah bikin pesan gagal total, paling buruk cuma tampil tanpa efek rich-nya.

**Bug yang pernah terjadi dan sudah diperbaiki:** percobaan pertama pakai regex sederhana yang cuma kenal 2 pola (`<tg-emoji>`, `<blockquote expandable>`) — begitu ada tag lain, teks dalam mode `blocks` (yang TIDAK di-parse sebagai HTML sama sekali, beda dari mode `html`) muncul mentah (`<tg-emoji ...>` literal di layar). Fix-nya: parser generik `parseNodes` yang bangun tree dari SEMUA tag di atas, bukan cuma menebak. Kalau nanti ada tag HTML baru yang dipakai kode (`<u>`, dll) dan belum ada di `nodeToRichText`/`nodesToBlocks`, tag itu akan default ke isi anaknya saja (tag hilang, teks tetap muncul) — bukan pesan rusak total, tapi formatting-nya tidak keluar. Tambahkan case baru di situ kalau perlu.

**Input format natural dari owner** (`/setfooter`, `/credits`): `entitiesToHtml()` di `message.ts` mengonversi `message.text` + `message.entities` (metadata format yang Telegram kirim otomatis saat user bold/italic/quote lewat UI, BUKAN tag yang diketik manual) jadi string HTML yang sama persis dipakai parser di atas — jadi owner tidak pernah perlu tahu soal tag HTML sama sekali.

## Environment Ini (Claude Code on the web)

Sesi berjalan di container remote — akses jaringan keluar (WebFetch ke domain eksternal) kadang dibatasi egress proxy environment (`EGRESS_BLOCKED`), tapi ini bisa berubah antar sesi (kadang jalan, kadang tidak) — coba dulu sebelum asumsi diblokir.

**Riset Telegram Bot API dengan presisi:** jangan andalkan `WebSearch` sebagai sumber primer (hasil cuplikannya sering tidak akurat/berhalusinasi untuk topik yang sangat spesifik/baru) atau `WebFetch` langsung ke `core.telegram.org/bots/api` (halamannya sangat panjang, sering kepotong sebelum sampai ke method/type yang dicari). Cara paling reliable: download JSON spec API yang di-generate otomatis harian dari halaman resmi:
```bash
curl -sSL -o /tmp/tg_spec.json "https://raw.githubusercontent.com/PaulSonOfLars/telegram-bot-api-spec/main/api.json"
python3 -c "import json; data=json.load(open('/tmp/tg_spec.json')); print(json.dumps(data['methods']['sendMessage'], indent=2))"
# atau data['types']['NamaType'] untuk cek struktur field lengkap
```
Ini cara yang dipakai untuk verifikasi field `chat_id`/`rich_message`/`RichMessageButton`/`MessageEntity` dll saat membangun fitur Rich Message — jauh lebih presisi daripada fetch HTML atau tanya web search.

Git CLI lokal kadang kehilangan auth ke GitHub di sesi/container baru (proxy git lokal tidak selalu tersedia). Kalau `git push`/`git fetch` gagal dengan error kredensial (`could not read Username`), pakai GitHub MCP tools (`mcp__github__push_files`, `create_or_update_file`, `list_branches`, dll) sebagai jalur alternatif untuk commit & sinkronisasi branch.
