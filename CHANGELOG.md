# Changelog

All notable changes to JankensBot are documented here.
Format: `[version] — date` with patch notes per entry.

---

## [1.3.1] — 2026-05-20

### Fixed
- **Countdown drift** — Countdown ticks (3→2→1) now fire at exact 1-second intervals using time-anchored scheduling. Previously, each API call's latency (~200ms) was added on top of the 1s sleep, making the countdown feel slow or inconsistent.
- **Reveal desync** — When one player's message hit a Telegram rate limit (429), that message could lag up to 10 seconds behind the other player's reveal. Fixed by capping retry wait to 500ms during countdown/reveal edits. The final result edit keeps the full retry for reliability.

---

## [1.3.0] — 2026-05-20

### Added (Beta only)
- **Full config system** — Beta users can customize emoji, stickers, and thumbnails per-game via DM commands (`/setemoji`, `/setsticker`, `/setthumb`). Config is stored per-user in KV and merged with global defaults set by the owner.
- **GIF & sticker thumbnails** — Popup choices now support animated GIF and sticker file IDs as thumbnails, in addition to static image URLs (`/setthumb rock gif <file_id>`).
- **Leaderboard** — Type `@JankensBot TOP` to view top 20 players by wins.
- **Donator tiers** — Basic and Premium tiers with 30-day expiry. Pay via Telegram Stars or Stripe (if configured). Owner can manually activate tiers via `/adddonator`.
- **Beta tester management** — Owner can approve/revoke beta access via `/betaadd`, `/betaremove`, `/betalist`.
- **Refresh button** — Tap 🔄 on a waiting or in-progress game message to pull the latest state, useful when a message gets buried in flood chats.
- **Beta environment** — Separate Cloudflare Worker (`rps-bot-beta`) with isolated KV namespace. Deploy via `npx wrangler deploy --env beta`.

### Fixed
- **Stuck at reveal** — Telegram HTTP 429 (rate limit) responses were silently dropped. Now retried up to 3 times with capped backoff (10s max), preventing the reveal from permanently stalling.
- **Rematch expired after 2 minutes** — Done game TTL was 120s; clicking Rematch after that returned "Game not found". Fixed by pre-populating `RematchMeta` in KV (TTL 600s) at game completion, so rematch no longer depends on the game session surviving.
- **Waiting message had no expiry info** — Waiting message now shows live countdown: `⏰ X min remaining`, updated on each query.

---

## [1.2.0] — 2026-05-20

### Added
- **Cancel button** — Host can cancel a waiting game before an opponent joins.
- **Owner DM thumbnail config** — Owner can set thumbnail URLs per choice via `/setthumb`, `/delthumb`, `/config`.
- **Custom emoji support** — Set `CUSTOM_EMOJI_ROCK/PAPER/SCISSORS` env vars to use animated Telegram custom emoji (`<tg-emoji>`) in countdown and reveal messages.

---

## [1.1.0] — 2026-05-19

### Changed
- Simplified all game messages — waiting text, countdown, reveal, and result use a cleaner format.
- Countdown uses emoji only (3️⃣2️⃣1️⃣), no text.
- Reveal shows each player's own choice emoji for 5 seconds before result.
- Rematch flow simplified.
- Inline popup now shows emoji-only titles (no "Rock / Paper / Scissors" text).
- Lottie sticker support in popup via `STICKER_*` env vars, with article fallback.

### Fixed
- Inline popup results now include `reply_markup` so Telegram sends `inline_message_id` in `chosen_inline_result` (required for message editing).
- Reveal text showed wrong format — now each player sees their own emoji vs opponent's emoji.

---

## [1.0.0] — 2026-05-19

### Added
- Initial release of JankensBot — inline Rock Paper Scissors on Cloudflare Workers.
- Two-message game flow: host picks via inline popup, opponent joins via 4-character game code.
- Single round and Best of 3 mode (`@JankensBot BO3`).
- Animated 3-2-1 countdown, simultaneous reveal, personalized win/loss result per player.
- Rematch button after each game.
- Stats tracking per user (`@JankensBot STATS`).
- Rate limit: max 3 active games per user.
- Expiry warning at 9 minutes, game auto-expires after 10 minutes.
- Cloudflare KV for game state, `waitUntil` for background countdown.
- Webhook secret header verification.
