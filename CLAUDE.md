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

**Known issue — custom emoji (`<tg-emoji>`) ada tapi statis (tidak animasi):** laporan berulang dari user, root cause belum 100% dikonfirmasi karena tidak bisa testing live dari sesi Claude Code. Kronologi teori:
1. **Teori pembatasan Telegram (owner Premium/Fragment)** — dokumentasi resmi Bot API bilang custom emoji entity cuma bisa dipakai "oleh bot yang beli username tambahan di Fragment, ATAU di pesan yang dikirim LANGSUNG oleh bot ke chat private/grup/supergroup kalau owner bot punya Telegram Premium". Owner sudah konfirmasi akunnya Premium, dan terbukti custom emoji-nya memang MUNCUL (bukan gagal total) — jadi klausul ini kemungkinan soal "boleh dipakai sama sekali atau tidak", bukan penyebab gejala yang dilaporkan.
2. **Bug gate tier donator (v2.3.0, diperbaiki, real bug tapi bukan penyebab utama gejala terbaru)** — ditemukan 2 celah konkret: (a) jalur set emoji reveal lewat custom-emoji **sticker** di `message.ts` (blok `msg.sticker.type === 'custom_emoji'`) tidak mengecek tier sama sekali, beda dari jalur teks yang benar mengecek `tier !== 'premium'`; (b) `loadConfigAuthorized()` di `game.ts` cuma gate biner (`tier !== 'free'`), tidak membedakan Basic vs Premium, jadi `custom_emoji_id` lama dari masa Premium tetap kepakai walau sudah downgrade ke Basic. Sudah diperbaiki — jalur sticker ikut dicek tier, dan `loadConfigAuthorized()` men-downgrade nilai numeric ID balik ke default kalau tier saat ini bukan premium/beta/owner. **Tapi**: bug report berikutnya datang dari OWNER sendiri (bypass semua gate tier kita, `loadConfigAuthorized` langsung return config mentah) — jadi fix ini terbukti benar tapi bukan akar masalah untuk kasus owner.
3. **Gejala presisi (dari `/myconfig` + screenshot langsung, v2.3.1)** — `reveal.rock` owner terverifikasi berisi `custom_emoji_id` asli (19 digit). Ganti ke ID lain (custom emoji berbeda) membuat glyph yang tampil ikut berubah sesuai ID baru (bukan macet/fallback) — bukti kuat payload `<tg-emoji emoji-id="...">` yang dikirim SUDAH BENAR dan berhasil di-resolve identitasnya oleh Telegram. Tapi confirmed dilihat LANGSUNG di app (bukan cuma screenshot statis): emoji-nya tidak pernah animasi sama sekali, untuk dua ID custom emoji berbeda berturut-turut. Kedua pesan yang diuji itu terkirim lewat jalur **rich (`rich_message.html`, via `forceRich=true`)** yang mulai diberlakukan sejak v2.2.1 untuk layar hasil 1v1/LMS/Team — sebelum itu, pesan dengan `<tg-emoji>` SELALU lewat classic `parse_mode: 'HTML'` (safety net asli sejak awal Rich Message dirilis).
   **Mitigasi v2.3.1**: `forceRich=true` DICABUT dari semua 10 titik pakai di `game.ts` (1v1 result, Team win/round, LMS win/round) — bukan karena terbukti pasti rich_message yang menyebabkan statis (belum ada dokumentasi resmi yang bilang begitu), tapi karena classic `parse_mode: 'HTML'` adalah baseline yang PALING TERBUKTI RELIABLE untuk custom emoji dari sebelum Rich Message ada sama sekali, dan risikonya paling kecil untuk fitur berbayar (donator perk). Konsekuensi: pesan yang mengandung `<tg-emoji>` sekarang otomatis balik ke classic (kehilangan divider `<hr>` native dan blockquote footer khusus untuk pesan itu saja — fallback teks `──────────` dan blockquote biasa tetap jalan). `forceRich` parameter-nya sengaja TIDAK dihapus dari `telegram.ts` (masih ada sebagai opsi), supaya gampang diaktifkan lagi kalau nanti ada bukti kuat rich_message bukan penyebabnya.
4. **KONFIRMASI (v2.3.1, owner test langsung di beta)** — setelah deploy v2.3.1, owner konfirmasi: emoji custom yang tadi statis **sekarang animasi normal** lewat classic mode. **Ini bukti kausal kuat: `rich_message.html` yang menekan animasi custom emoji, classic `parse_mode: 'HTML'` tidak.** Teori #1 (permission Fragment/owner Premium) dan kemungkinan sisi-viewer (akun/device) praktis tersingkir — kalau itu penyebabnya, ganti rich↔classic tidak akan mengubah apa pun karena keduanya sama-sama "pesan dikirim langsung oleh bot" dan viewer/device-nya sama persis di kedua tes.
5. **v2.3.2 — re-test A/B/A** — atas permintaan user, `forceRich=true` diaktifkan LAGI khusus untuk layar hasil 1v1 (`finishGame`, 2 pemanggilan `editInlineMessageRich`) untuk mengonfirmasi ulang kausalitasnya (harus balik statis lagi). Team/LMS TIDAK disentuh, tetap di classic (belum pernah diuji animasinya sama sekali sejauh ini — kalau nanti 1v1 lewat rich terbukti balik statis lagi, baru pertimbangkan uji Team/LMS juga sebelum menyimpulkan pola ini berlaku ke semua mode). **Kalau hasil re-test ini mengonfirmasi (balik statis lagi), kesimpulan akhirnya: JANGAN PERNAH pakai `forceRich=true`/`rich_message` untuk teks apa pun yang mengandung `<tg-emoji>` — animasi custom emoji cuma jalan lewat classic `parse_mode: 'HTML'`.** Update bagian ini begitu hasil re-test masuk.

Kalau setelah v2.3.0 gejalanya masih muncul (custom emoji hilang untuk kombinasi tier/mode tertentu), screenshot + info tier donator pemain yang emoji-nya hilang sangat membantu mempersempit lagi.

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
