# Changelog

Technical change log for developers and contributors.
Follows [Keep a Changelog](https://keepachangelog.com) conventions.

---

## [1.4.0] — 2026-05-21

### Added
- Result messages: both bubbles show `🏆 {winner} wins! / {hostName} {hE} · {opName} {oE}` — spectator-readable without context
- Match history: `<blockquote expandable>` appended to result after 2+ games in a chain; per-player win/draw/loss row with aggregate score; stored in `chain:<code>:history` (TTL 3600s), written on every `finishGame` regardless of `chainId` so game 1 is on record before the first rematch
- Rematch chain: `rematchKeyboard` emits `switch_inline_query_current_chat: R<gameId>` (chain code); each rematch creates a new bubble; `chain:<code>:meta` (TTL 300s, reset on each finish) gates access to original two players; `chain:<code>:active` tracks waiting rematch game
- Weekly stats: `stats:<userId>:week:<YYYY-WNN>` (TTL 7d); per-opponent: `stats:<userId>:vs:<opponentId>`; `UserStats.choices` tracks per-choice counts; `STATS` result shows weekly breakdown and favourite choice
- `🎮 Join` button on waiting message: `switch_inline_query_current_chat` pre-fills game code (chain code for chain rematch waiting games, gameId otherwise)
- Inline popup: `🎲 Random` result at top; choice order shuffled per query via Fisher-Yates
- Private challenge: `@JankensBot @username` or `@JankensBot @username bo3` stores `lockedToUsername` on session; enforced in both `handleInlineQuery` and `handleChosenInlineResult`
- `GameSession.lockedToUsername?: string`; `ChainEntry`, `ChainMeta` interfaces; `getWeekKey()` utility

### Changed
- `runCountdownAndReveal` → `runRevealAndResult`: countdown removed; each player sees their own choice emoji for 5s then result; reduces API edits per game from ~6 to ~2, improving sync reliability at scale
- `waitingText`: removed `Type @bot CODE to join` line; added `🔒 For @username only` when `lockedToUsername` set; `botUsername` param retained but unused
- `waitingKeyboard(gameId, joinQuery?)`: optional `joinQuery` routes Join button through chain path for chain rematch waiting games
- `handleCallbackQuery`: `refresh:` and old `rematch:`/`rpick:` actions removed from dispatch

### Removed
- `🔄 Refresh` button and `handleRefresh` — obsolete with per-rematch new bubbles
- `rematchPickKeyboard`, `handleRematch`, `handleRpick` callback handlers — replaced by chain `switch_inline_query` flow

### Fixed
- `chain:<code>:active` not cleaned up when opponent joined via regular `GAME_ID_RE` path (Join button used gameId, not chain code) — caused next rematch to find stale done-game and fail; fixed by routing chain rematch Join button through chain code
- Game 1 result not written to chain history (no `chainId` on first game) — first rematch had only 1 entry, below `historyBlock`'s 2-entry threshold; now all games write history
- Chain meta read twice in `finishGame` (two separate `kv.get` calls for same key); replaced with single read + parallel write

---

## [1.3.1] — 2026-05-20

### Fixed
- `runCountdownAndReveal`: replaced `sleep(1000)` after each edit with time-anchored intervals (`t0 + i*1000 - Date.now()`), eliminating ~200ms per-tick drift caused by API call latency accumulating over the countdown loop
- `editInlineMessage`: added optional `maxRetryWait` parameter to `call()` — countdown/reveal edits now use `REALTIME_RETRY_MS = 500` cap; previously a single 429 retry could hold one promise for up to 10s while the other completed, causing visible reveal desync between players

---

## [1.3.0] — 2026-05-20

### Added
- `src/config.ts`: `loadConfig(kv, hostUserId, env)` — merges hardcoded defaults → env vars (`STICKER_*`, `CUSTOM_EMOJI_*`) → global KV (`config:global`) → user KV (`config:user:<id>`); `setUserConfig()`, `setGlobalConfig()`, `getUserConfigRaw()`, `getGlobalConfigRaw()`
- `src/donator.ts`: `loadDonatorTier()`, `activateTier()`, `TIER_PERKS`, `TIER_DAYS`, `tierBadge()`; tier stored as `donator:<userId>` in KV with expiry field
- `src/feature.ts`: `hasFeature(env, flag)`, `isBetaUser(kv, userId, ownerId)`; beta approved list stored as `beta:approved` array in KV
- `src/stripe.ts`: `createCheckoutSession()` via Stripe Checkout API; `verifyStripeWebhook()` using HMAC-SHA256 with `crypto.subtle`
- `src/handlers/payment.ts`: `handleDonate()`, `handleDonateCallback()`, `handlePreCheckout()`, `handleSuccessfulPayment()`, `handleStripeWebhook()`; invoice payload format `donate:<tier>:<userId>`
- `src/index.ts`: routes `/stripe-webhook` path; handles `pre_checkout_query` and `successful_payment` update types
- `handlers/message.ts`: DM commands for all users — `/setemoji`, `/setsticker`, `/setthumb`, `/delthumb`, `/myconfig`, `/reset`; owner-only — `/setglobal`, `/globalconfig`, `/resetglobal`, `/betaadd`, `/betaremove`, `/betalist`, `/setprice`, `/prices`, `/adddonator`, `/removedonator`; beta guard gates config commands to approved testers
- `inline.ts`: `choiceResults()` reads `GameConfig` — supports `url`/`gif`/`sticker` thumb types and `InlineQueryResultCachedGif`; leaderboard result via `@botname TOP`; config loaded per-querier
- `types.ts`: `DonatorTier`, `DonatorRecord`, `LeaderboardEntry`, `ThumbConfig`, `GameConfig`, `InlineQueryResultCachedGif`, `PreCheckoutQuery`, `SuccessfulPayment`; `RematchMeta` extended with `hostInlineMessageId`, `opponentInlineMessageId`
- `game.ts`: `updateLeaderboard()` — maintains top-20 sorted by wins in `leaderboard` KV key; `waitingText` accepts `badge` param; `refreshKeyboard` added to waiting message keyboard
- `wrangler.toml`: `[env.beta]` environment with isolated KV namespace, `rps-bot-beta` worker name, all feature flags enabled

### Fixed
- `telegram.ts` `call()`: added 3-attempt retry loop with `Math.min(retry_after * 1000, 10_000)` backoff for HTTP 429 responses (previously silent-failed)
- `game.ts` `finishGame()`: pre-populates `rematch:R<gameId>:meta` (TTL 600s) at game completion — `handleRematch` no longer reads the game session, which expired after 120s
- `game.ts` `finishGame()`: done-game TTL raised from 120s to 600s
- `game.ts` `waitingText()`: now accepts `now` param and renders `⏰ X min remaining` live countdown
- `callback.ts` `handleRematch()`: reads `rematch:R<id>:meta` directly; no longer fails when game session is expired
- `callback.ts` `handleRpick()`: pick data stores only `{ choice }` — inline message IDs sourced from pre-populated meta instead of pick KV entry
- `callback.ts`: added `handleRefresh()` for `refresh:<gameId>` callback — re-edits message to current session state

### Infrastructure
- Beta environment isolated from production: separate Cloudflare Worker, KV namespace, bot token, and webhook URL
- `wrangler.toml` `[env.beta]` added; deploy via `npx wrangler deploy --env beta`

---

## [1.2.0] — 2026-05-19

### Added
- `cancelKeyboard()`: inline keyboard with `❌ Cancel` button; shown on waiting message
- `handleCancel()`: deletes game KV entry, decrements rate-limit counter, edits message to `❌ Game cancelled.`
- `handlers/message.ts`: owner DM commands `/setthumb [rock|paper|scissors] <url>`, `/delthumb`, `/config`; thumbnail URLs stored as `config:thumb:<choice>` in KV
- `CUSTOM_EMOJI_ROCK/PAPER/SCISSORS` env vars: `fmtEmoji()` renders `<tg-emoji emoji-id="...">` if value matches `/^\d{10,}$/`, else plain text

---

## [1.1.0] — 2026-05-19

### Changed
- Simplified message templates: countdown is emoji-only (`3️⃣2️⃣1️⃣`), reveal shows each player's own emoji for 5s before result
- `inline.ts` `choiceResults()`: added `reply_markup: PLACEHOLDER_KEYBOARD` to all inline results — required for Telegram to include `inline_message_id` in `chosen_inline_result`
- Inline popup titles: emoji only, no `Rock/Paper/Scissors` text, no description
- Rematch flow: both players click Rematch on their own bubble → `rpick` keyboard; `RematchMeta` stores player info and message IDs
- `STICKER_*` env vars: `choiceResults()` returns `InlineQueryResultCachedSticker` when configured, falls back to `InlineQueryResultArticle`
- Reveal duration increased from 3s to 5s

### Fixed
- `reveal` text format: each player now sees their own choice emoji vs opponent's, not a combined string

---

## [1.0.0] — 2026-05-19

### Added
- Initial release: inline Rock Paper Scissors on Cloudflare Workers
- Two-message game flow via `inline_query` + `chosen_inline_result` + `callback_query`
- `handleInlineQuery`: new game (single/BO3) and join-game popup with 4-char game code validation
- `handleChosenInlineResult`: host creates session in KV; opponent triggers `runCountdownAndReveal` via `ctx.waitUntil()`
- `runCountdownAndReveal`: 3-2-1 countdown (1s each), reveal (5s), result — edits both messages in parallel via `Promise.all`
- `finishGame`: updates `UserStats` in KV, shows result with `🔄 Rematch` keyboard
- `handleCallbackQuery`: `pick:`, `cancel:`, `rematch:`, `rpick:` actions
- Stats tracking: `stats:<userId>` KV key; inline query `@botname STATS` shares card
- Rate limiting: `ratelimit:<userId>` counter, max 3 active games
- Expiry warning: game older than 9 min triggers host message edit when opponent searches code
- KV TTL: 600s waiting, 120s done
- GitHub Actions workflow for automated Cloudflare Workers deployment
- Webhook secret header verification (`X-Telegram-Bot-Api-Secret-Token`)
