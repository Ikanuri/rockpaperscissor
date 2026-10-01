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

Ketiganya berbagi `richRequest()` (bangun payload, fetch, fallback). **Sejak v2.3.0**, teks dikirim lewat field `html` di `InputRichMessage` (BUKAN `blocks`) — Telegram sendiri yang parse HTML-nya, jadi string yang sama persis dengan yang dulu dipakai untuk `parse_mode: 'HTML'` klasik (tag classic-HTML-mode: `<b>`, `<i>`, `<u>`, `<s>`, `<tg-spoiler>`, `<code>`, `<pre>`, `<a href>`, `<blockquote>`/`<blockquote expandable>`, `<tg-emoji emoji-id="...">`, termasuk `<hr/>` yang didukung native di mode `html`) langsung dikirim apa adanya, tanpa parser buatan sendiri. Tombol (`InlineKeyboardMarkup`) diserialisasi jadi tag `<tg-button-row>`/`<tg-button>` (`keyboardToButtonHtml()`) yang ditempel di akhir html — field-nya (`callback_data`→`data`, `style`, `switch_inline_query_current_chat`→`query`, `url`) 1:1 sama dengan tombol lama, jadi `callback_data` tetap trigger `callback_query` normal tanpa perlu ubah routing di `handleCallbackQuery`.

**Kalau API menolak** (format tidak didukung, dll), otomatis fallback ke `editInlineMessage`/`editMessage`/`sendMessage` klasik dengan teks + keyboard yang SAMA — jadi eksperimen rich tidak pernah bikin pesan gagal total, paling buruk cuma tampil tanpa efek rich-nya.

**Riwayat (v2.2.0, sudah tidak berlaku):** versi pertama Rich Message membangun struktur `blocks` sendiri lewat parser HTML buatan tangan (`parseNodes`/`nodesToRichText`/`nodesToBlocks`) karena saat itu belum tahu field `html` bisa dipakai langsung. Parser itu sempat kena bug (tag yang belum dikenali muncul mentah di layar, mis. `<tg-emoji ...>` literal) dan jadi ~150 baris kode yang rawan miss tag baru. **v2.3.0 menghapus semua itu** dan pindah ke field `html` — Telegram yang parsing, jadi tidak ada lagi kelas bug ini sama sekali. Kalau nanti nemu kode yang masih mereferensikan `RichBlock`/`parseNodes`/dll, itu sisa lama yang harus dihapus, bukan pola yang harus diikuti.

**Custom emoji (`<tg-emoji>`) — ATURAN (sejak v2.3.10):** pesan **inline** (target `inline_message_id`, yaitu semua bubble game) yang mengandung `<tg-emoji>` TIDAK boleh lewat `rich_message` — `richRequest()` di `telegram.ts` otomatis memakai classic `parse_mode: 'HTML'` untuk kasus itu (`<hr>` di-fallback jadi garis teks `──────────` via `stripHrForClassic`). Pesan **non-inline** (`sendMessageRich`/`editMessageRich` ke DM/grup) tetap rich walau berisi `<tg-emoji>`. Jangan menambah parameter "paksa rich" lagi.

| Jenis pesan | Classic HTML | Rich |
|---|---|---|
| Inline (bubble game, `via @bot`) | emoji custom tampil + bergerak | hanya emoji biasa (teks pengganti) |
| Dikirim langsung ke chat (DM, grup) | tampil + bergerak | tampil + bergerak (terbukti di DM dan di grup) |

Root cause (terkonfirmasi lewat tes owner, v2.3.2–v2.3.9): di pesan inline, `rich_message` menampilkan custom emoji hanya sebagai teks pengganti (glyph unicode bawaan stiker, mis. 👊/👮 — BUKAN gambar emoji-nya), sementara classic HTML menampilkan emoji asli dan animasi. Sama persis dengan dokumentasi Bot API: custom emoji hanya diizinkan "di pesan yang dikirim langsung oleh bot ke chat private/grup/supergroup kalau owner bot Premium (atau bot punya username Fragment)" — pesan inline tidak termasuk. Tombol, `<hr>`, blockquote BUKAN penyebab (varian paling polos pun gagal). Bukti: (1) `/emojitest` inline I1–I4 (rich) = fallback glyph, I5 (classic) = animasi; (2) satu hasil game nyata dikirim ganda — inline rich = fallback, salinan DM rich = animasi, dan respons API menunjukkan Telegram menerima + mem-parse node `custom_emoji` dengan benar di kedua jalur (inline edit hanya membalas `true`); (3) `/emojitest` di grup sungguhan: kelima varian rich (`<tg-emoji>`, `<img src=tg://emoji>`, markdown, blocks) tampil dan bergerak seperti pembanding classic. Telegram menormalkan semua cara penulisan jadi node `custom_emoji` yang sama, jadi cara menulis bukan variabel. Channel belum diuji (dan tidak dipakai bot); dokumentasi tidak mencantumkannya untuk custom emoji.

Pelajaran investigasi: glyph yang muncul di layar BUKAN bukti emoji ter-resolve — itu bisa teks pengganti. Bandingkan dengan pembanding classic dan baca `parsed` dari respons API, jangan menyimpulkan dari screenshot statis. Dua celah gate tier donator juga ditemukan & diperbaiki sepanjang investigasi ini (jalur set emoji lewat custom-emoji sticker tidak mengecek tier; `loadConfigAuthorized()` tidak men-downgrade ID animasi lama saat tier turun) — real bug, tapi bukan penyebab gejala emoji statis.

**Alat diagnostik owner (permanen, aman):** `/emojitest [id]` (DM bot atau di grup, owner saja) mengirim emoji yang sama dalam 6 cara penulisan + ringkasan respons API; `@bot emojitest` (inline, owner) menguji jalur edit pesan inline (I1–I5). Tidak mengubah perilaku game. `callRaw()` di `telegram.ts` mengembalikan respons Bot API mentah untuk keperluan ini.

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

**Debug live tanpa token Cloudflare (pola yang pernah dipakai & berhasil, v2.3.6–v2.3.8, sudah dihapus dari kode):** sandbox Claude tidak punya token Cloudflare/bot, jadi `wrangler tail`/`kv get` tidak bisa. Polanya: (1) buat KV namespace khusus debug lewat workflow sekali-pakai di branch terpisah yang di-trigger `on: push` (panggil API Cloudflare dengan `secrets.CLOUDFLARE_API_TOKEN`, ID namespace muncul di log job — baca lewat `mcp__github__get_job_logs`); (2) di Worker, tulis rekaman bersih-redaksi ke KV `debug:<nama>:<ts>` (TTL 1 jam; buang token bot/Authorization) dan sediakan `GET /debug/<nama>` yang membaca prefix itu, 404 kalau header `X-Debug-Token` ≠ secret; (3) `DEBUG_SECRET` TIDAK dibuat manual: turunkan di workflow deploy dan workflow pembaca dengan `printf 'debug-endpoint-v1' | openssl dgst -sha256 -hmac "$CLOUDFLARE_API_TOKEN" -r` + `::add-mask::`, lalu `wrangler secret put` — nilainya tidak pernah menyentuh chat; (4) workflow pembaca di branch terpisah, `on: push`, men-curl endpoint dari sisi GitHub dan mencetak JSON ke log job; tiap pembacaan = satu commit kosong ke branch itu (workflow_dispatch tidak bisa dipakai karena file workflow harus ada di default branch). Beta dulu; semua kode ditandai `DEBUG SEMENTARA` agar mudah dihapus.

Git CLI lokal kadang kehilangan auth ke GitHub di sesi/container baru (proxy git lokal tidak selalu tersedia). Kalau `git push`/`git fetch` gagal dengan error kredensial (`could not read Username`), pakai GitHub MCP tools (`mcp__github__push_files`, `create_or_update_file`, `list_branches`, dll) sebagai jalur alternatif untuk commit & sinkronisasi branch.
