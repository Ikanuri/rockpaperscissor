# Changelog

Technical change log for developers and contributors.
Follows [Keep a Changelog](https://keepachangelog.com) conventions.

---

## [2.3.2] — 2026-09-19

### Changed
- **Confirmed via live owner testing on beta**: after v2.3.1's revert, the previously-static custom emoji animated correctly through classic `parse_mode: 'HTML'`. Strong causal evidence that `rich_message.html` itself suppresses custom emoji animation — this rules out the Fragment/owner-Premium permission theory and viewer/device-side theories, since neither changes between the rich and classic send paths for the same account watching the same message.
- `game.ts`: re-enabled `forceRich=true` for the 1v1 result screen only (`finishGame`'s two `editInlineMessageRich` calls), as an A/B/A re-test requested by the owner to double-confirm the causal link before settling on a permanent approach. Team and LMS result texts are untouched (still classic-only, never tested for animation) — if this re-test reproduces the static bug, treat "never use rich_message for text containing `<tg-emoji>`" as confirmed and revert this again permanently.

## [2.3.1] — 2026-09-19

### Fixed
- `game.ts`: reverted `forceRich=true` from all 10 call sites (1v1 result, Team win/round texts, LMS win/round texts) added in v2.2.1/v2.3.0. Live testing (via `/myconfig` + direct in-app observation, not just screenshots) showed a real animated `custom_emoji_id` resolving to the correct emoji identity but never playing its animation when sent through `rich_message.html` — those messages all went through the `forceRich` path. Not confirmed as the definitive root cause (no official docs distinguish rich vs. classic custom-emoji animation behavior), but classic `parse_mode: 'HTML'` is the only path with a proven track record for this donator perk, so it's the safer default while the animation question stays open. `richRequest()`'s existing behavior (auto-fallback to classic whenever `<tg-emoji` is present, unless forced) is now effectively universal again; the `forceRich` parameter itself stays in `telegram.ts` for future re-testing

## [2.3.0] — 2026-09-19

### Changed
- `telegram.ts`: rich messages now send text via `InputRichMessage.html` instead of a hand-built `blocks` structure — Telegram parses the HTML natively (confirmed against the Bot API 10.1–10.3 docs), so the ~150-line custom parser (`parseNodes`/`nodesToRichText`/`nodesToBlocks`) is removed entirely along with its class of "unrecognized tag renders literally" bugs. Buttons now serialize to `<tg-button-row>`/`<tg-button>` tags appended to the html instead of a separate structured buttons block; field mapping (`callback_data`→`data`, `style`, `switch_inline_query_current_chat`→`query`, `url`) is unchanged, so `callback_query` routing is unaffected

### Fixed
- `message.ts`: the custom-emoji-reveal-via-**sticker** path (`msg.sticker.type === 'custom_emoji'`) had no donator-tier check at all, unlike the equivalent text-entry path — a Basic-tier donator could set an animated `custom_emoji_id` (a Premium-only perk per `TIER_PERKS`) by forwarding a custom emoji as a sticker instead of typing it. Now gated identically to the text path
- `game.ts`: `loadConfigAuthorized()` was a binary authorized/not gate (`tier !== 'free'`) that didn't distinguish Basic from Premium — a stored `reveal[choice]` value could keep a raw animated `custom_emoji_id` from a previous Premium period after downgrading to Basic (no cleanup on expiry/downgrade), or slip through via the sticker-path bug above, and would still render as `<tg-emoji>` regardless of the donator's *current* tier. `loadConfigAuthorized()` now downgrades any leftover numeric custom emoji id back to the plain default whenever the caller's current tier isn't premium/beta/owner, so rendering always matches what the tier is actually entitled to at render time, not at set time

## [2.2.1] — 2026-09-18

### Fixed
- `editMessageRich`/`sendMessageRich` (`telegram.ts`): added the same `forceRich` opt-out parameter `editInlineMessageRich` already had, so individual call sites can bypass the `<tg-emoji>`-triggered classic-mode fallback once confirmed stable in production
- Extended `forceRich=true` from the 1v1 result screen (proven stable in production) to Team Mode's round/win messages (`executeTeamRound` in `game.ts`: per-player inline edits, pinned group message, group announcement) and LMS's win/round-result messages (`_runLmsRound`: forfeit-win, normal-elimination-win, and per-round survivor/eliminated texts) — all of these embed `choiceDisplay()`-rendered custom emoji, so they now get full rich formatting (native `<hr>` divider, blockquote footer) instead of always falling back to classic HTML mode

## [2.2.0] — 2026-09-18

### Added
- Rich Message rendering (Bot API 10.1–10.3) across every bot-facing message: 1v1 (waiting bubble, result, BO3/5/7 round transition), LMS, Team (waiting/pick/round/win, plus group announcements), Tournament (signup, bracket rounds, champion), `/guide`, `/credits`, `/setlang`, group `/leaderboard` and `/stats`, streak/achievement DMs, `/clearhost` cancellation notices
- `telegram.ts`: `editInlineMessageRich`, `editMessageRich`, `sendMessageRich` — share a `richRequest()` helper and a generic recursive HTML→`InputRichMessage` parser (`parseNodes`/`nodesToRichText`/`nodesToBlocks`) covering the full classic-HTML-mode tag set (bold, italic, underline, strikethrough, spoiler, code, pre with language, links, blockquote — plain and expandable, custom emoji) with arbitrary nesting (e.g. `<b>bold <i>and italic</i></b>`). Buttons render as `InputRichBlockButtons`/`RichMessageButton` (`keyboardToButtonBlocks`) — field-for-field compatible with `InlineKeyboardButton`, so `callback_data` still fires a normal `callback_query` with no routing changes. Every rich call falls back automatically to the previous plain `parse_mode: 'HTML'` + classic `reply_markup` rendering if the API rejects the request, so a formatting edge case can never break a message
- Ephemeral pick reminders in Team Mode (Bot API 10.2+, `sendEphemeralMessage`/`editEphemeralMessageText`): teammates who haven't chosen yet get a private nudge inside the group chat, edited in place on repeat reminders (`TeamPlayer.reminderMsgId`)
- "ℹ️" pick-status button on the 1v1 waiting bubble, LMS "locked" state, and Team pick-wait state: `answerCallbackQuery` popup showing only the presser their own locked choice (`handleMyPick` in `callback.ts`) — no `chat_id`/group requirement, since it rides the existing `callback_query` mechanism
- `/setfooter` and `/credits`: owner sends a normally-formatted Telegram message (bold/italic/blockquote/custom emoji via the client's own tools) instead of typing HTML; `entitiesToHtml()` (`message.ts`) converts `message.entities` into the equivalent HTML, recursing correctly through nested entities

### Changed
- `/setfooter` UX: no longer takes inline args; prompts a pending follow-up message (same pattern as `/credits`) so formatting can be applied naturally
- `withFooter()` no longer `escHtml()`s the footer — it's trusted HTML by construction (built from owner-authored entities, not raw user input), so it renders instead of showing literal `&lt;b&gt;` text

---

## [2.1.0] — 2026-09-18

### Added
- `/setfooter <text>` owner-only command in `message.ts`: sets `config:result_footer` KV key; appended via `withFooter()` (`game.ts`) to every game-ending result text — 1v1 (`finishGame`), Team (`runTeamRound`), Tournament (final champion message), LMS (both forfeit-win and normal-elimination-win paths). `/setfooter off`/`clear` deletes it; no-arg call shows the current value. `getResultFooter`/`setResultFooter`/`clearResultFooter` added to `config.ts`

### Changed
- `formatUser()` (`game.ts`): now returns `first_name` only, never `@username`
- Leaderboard display (`inline.ts` TOP query, `game.ts` pinned group scoreboard and daily-challenge champion line): resolves display name from `user:info:${userId}` KV cache at render time instead of the stored `LeaderboardEntry.name` snapshot, so old `@username`-formatted entries self-heal without a data migration
- Waiting bubble text (`waitingText` in `game.ts`): badge now printed before the name with a single separating space when present; removed "main" wording ("Bergabung untuk main!" → "Bergabung!"); removed the `⏰ N min remaining` countdown line
- Removed the manual 🔄 refresh button and its `refresh_button` feature flag entirely (`waitingKeyboard`, `handleRefresh` in `callback.ts`, `wrangler.toml`) — redundant now that the waiting bubble has no countdown to refresh
- `/donatorlist` (`message.ts`): now also lists users who activated `/freemium`, labeled `(freemium)`; freemium activation now appends the user to `donators:ids`

### Fixed
- `runLmsRound` (`game.ts`): no longer silently returns when flee/smite drops active players to 0 or 1 — 0 marks the session `done`, 1 declares the remaining player winner by forfeit and records stats; wrapped in try/catch with `console.error` logging (previously silent when invoked via `ctx.waitUntil`); re-reads the session from KV before acting to avoid operating on a stale snapshot; guards against evaluating elimination when an active player's `choice` is still `null`
- LMS flee/smite handlers (`callback.ts`) and LMS/Team join & pick handlers (`inline.ts`: LMS join, LMS next-round pick, Team round pick, `TJOIN` team-member join): added a re-read-from-KV step immediately before the decisive write, closing most of the race window where two players joining or picking within the same request window could silently overwrite each other (observed: a player already seated in a 4-player LMS lobby was displaced by a later joiner after the lobby had already filled)
- `resolveTeamDiceWait` (`game.ts`): wrapped in try/catch with `console.error` logging (previously a thrown error inside `ctx.waitUntil` was silently swallowed, leaving the tiebreaker dead)
- Team tiebreaker instruction text reverted to "lempar 🎲 di grup" (bot privacy mode is OFF, so it receives group dice messages directly — no reply-to-message needed)
- vs Bot rematch button label shortened ("🔄 Main lagi vs Bot" → "🔄 Lagi vs Bot")

---

## [2.0.0] — 2026-05-23

### Added
- `/guide` command: `guideMainMenu(lang, botUsername)` and `guideContent(mode, lang, bot)` exported from `message.ts`; 7 modes (1v1, bo, ranked, lms, team, bot, open) with bilingual walkthrough text and `<pre>` code examples
- `handleGuide` in `callback.ts`: edits bot message to mode content + back button (`guide:main` → main menu); silent callback answer
- `handleSetLang` in `callback.ts`: stores `lang:${userId}` in KV; edits message to confirmation; no toast popup
- `getLang(kv, userId)` in `game.ts`: reads `lang:${userId}` KV key, returns `'id' | 'en'`
- `setMyCommands` in `telegram.ts`: optional `language_code` parameter; `/setupcommands` now calls it twice — default scope (Indonesian) + `language_code: 'en'` (English); reply includes copy-ready BotFather template for both languages
- Webhook secret validation in `index.ts`: checks `X-Telegram-Bot-Api-Secret-Token` header against `env.WEBHOOK_SECRET` (skipped if env var absent)
- `DEPLOY.md`: deployment guide — branch→workflow mapping, secrets reference, KV namespace table, rollback procedure

### Changed
- Bot identity: JankensBot → GubakeBot in `payment.ts` (3 occurrences), `stripe.ts` (1), `wrangler.toml` (worker name, service name)
- `RELEASE_DATE`: removed from `config.ts` as compile-time constant; replaced by `getReleaseMs(kv)` in `game.ts` — writes `config:release_date = Date.now()` on first call, all period index functions accept explicit `releaseMs` param
- `welcomeText(env, lang)`: now bilingual; Team Mode listed; `/donate` removed; `/guide` and `/setlang` added
- `/setupcommands`: user scope trimmed to 3 commands (clearhost, setlang, guide); removed donatorCommands block (was incorrectly scoped to owner chatId, shadowed by ownerCommands anyway); reply now includes BotFather template
- User command list order: guide moved to last position (appears at bottom of Telegram popup, always visible regardless of screen height)

### Fixed
- Choice validation in `callback.ts` `handleCallbackQuery`: `parts[2]` now checked against `VALID_CHOICES` before cast to `Choice` type
- `parseInt` in `payment.ts` Stripe webhook: added base-10 radix; added `isNaN` guard before KV lookup
- Rate limit `kv.put` calls in callback handlers: wrapped in `ctx.waitUntil` to prevent fire-and-forget loss in Workers
- `/adddonator` not updating `donators:ids` KV set

---

## [1.9.0] — 2026-05-22

### Added
- **LMS**: `LmsPlayer`, `LmsRoundRecord`, `LmsSession` types; `runLmsElimination` (2-choice eliminates losers, 1/3-choice → chaos re-round), `lmsPickKeyboard`, `lmsHostKeyboard`, `lmsJoinKeyboard`, `lmsWaitingText`, `runLmsRound`; `extlms:` callback extends TTL; `lmsforce:` callback force-starts with ≥2 players; reveal phase (3s per-player emoji before round result); `lms:${gameId}` KV key (TTL 300s playing, 600s waiting); inline trigger `@bot LMS [N]` (default 4, max 8)
- **Team Mode**: `TeamPlayer`, `TeamSession` types; `teamPickKeyboard`, `teamWaitingKeyboard`, `teamWaitingText`, `resolveTeamChoice` (majority vote → `sendDice` tiebreaker in group chat, highest roll wins), `runTeamRound`; `tpick:`, `tcancel:`, `extteam:`, `teamdice:resolve` callbacks; `/team NvN` group command writes `team_chat:${userId}` (TTL 300s); join A/B via `switch_inline_query_current_chat`; `getChatMember` membership check before joining; per-player custom emoji in result
- **Tournament**: `TournamentPlayer`, `TournamentMatch`, `TournamentSession` types; `tournamentSignupKeyboard`, `tournamentSignupText`, `startTournamentBracket` (single-elimination, bye padding for odd counts); `/tournament N` group command; `tourjoin:` and `tourstart:` callbacks; auto-start when full; `getChatMember` membership check; `GameSession` extended with optional `tournamentId`, `tournamentMatchId`; `sendMessageForId`, `editMessage` added to `telegram.ts`
- **vs Bot**: `@bot BOT` creates instant single-player game; bot picks via `Math.random()`; stats recorded (W/L/D); ELO unchanged; `BOT` added to `RESERVED_CODES`
- **Open Challenge**: `OpenChallenge` type; `open:list` KV key (JSON array, TTL 600s, max 5 entries); `handleInlineQuery` renders available challenges + create option for `@bot OPEN`; join routes through regular 6-char game join; `OPEN` added to `RESERVED_CODES`
- **VS @username**: `VsStats` type; `@bot VS @username` reads `user:by_username:${username}` reverse index + `stats:${userId}:vs:${opponentId}`; renders head-to-head W/L/D
- **LAST replay**: `LastGameRecord` type; `stats:${userId}:last` KV key written after each `finishGame`; `@bot LAST` renders last game summary
- **Group mode** (`group_mode` feature flag): `handleGroupMessage` routes `group`/`supergroup` updates; bot-added event writes `group:settings:${chatId}`; bot-kicked deletes it; `new_chat_members` sends welcome mention; `/announce` writes `group:announce:${userId}` (TTL 300s); `maybeAnnounceGame` fires via `ctx.waitUntil` after game creation; `/leaderboard` posts global board as message; `/groupstats` posts from `group:score:${chatId}`; `/poll` and `/dice` commands using native Telegram API; `updatePinnedScoreboard` edits/creates pinned message after `finishGame`
- Expiry warning: lazy-triggered in `handleInlineQuery` at 8 min elapsed; `warn:sent:${gameId}` flag (TTL 60s) prevents duplicate; fires to group via `group:announce` key
- `refresh_button` feature flag: `waitingKeyboard(gameId, joinQuery?, showRefresh?)` emits `refresh:${gameId}` button; `handleRefresh` re-edits message with fresh timestamp

### Changed
- `/clearhost` now scans `hostgames:${userId}` KV set and cancels LMS and Team sessions in addition to 1v1/BO
- `TeamDiceWaitState` TTL raised 60s → 300s
- LMS and Team rate limit counter decremented when game transitions to playing (previously only on cancel/expire)

---

## [1.8.0] — 2026-05-22

### Added
- Ranked mode: `ranked?: boolean` on `GameSession`; `@bot RANKED` sets flag; ELO updates only when `ranked` is true; 🏅 badge in `waitingText`; `ChainMeta.ranked` propagates flag across rematch chain
- Achievements: `UserStats.achievements: string[]`; 9 conditions checked in `finishGame` (first_win, win_10/50/100, games_10/100, streak_5/10/20); DM sent on first unlock via `ctx.waitUntil`; count shown in `statsResult`
- Streak notifications: `UserStats.lastNotifiedStreak`; DM on milestones [5,10,20,50,100]; fires from `finishGame` via `ctx.waitUntil`; no re-notification until next milestone
- Streak Shield (Premium): `UserStats.shieldUsedDayIndex`; absorbs one loss per day without resetting `currentStreak`; checked in `updateStats` when tier = Premium

### Changed
- ELO update gated to ranked games only; non-ranked games leave `UserStats.rating` unchanged
- `runRevealAndResult`, `finishGame`: accept `ctx: ExecutionContext` for fire-and-forget DMs
- `finishGame`: donator record read in parallel with lifetime stats via `Promise.all`

---

## [1.7.0] — 2026-05-22

### Added
- `GameMode`: `'best_of_5' | 'best_of_7'` variants
- `getMaxRounds(mode)`, `getMaxWins(mode)`: derive match parameters from `GameMode`; no hardcoded values in `runRevealAndResult`
- `parseMode(str)`: converts `'BO3'|'BO5'|'BO7'` → `GameMode`
- `isCustomCode(str)`: predicate to distinguish user custom codes from reserved keywords
- `RESERVED_CODES`: `Set<string>` blocking collision (`BOT`, `OPEN`, `LMS`, `RANKED`, `TEAM`, `LAST`, `VS`, `BO3`, `BO5`, `BO7`, `TOP`, `STATS`)
- `UserStats.rating?: number`: ELO rating; K=16; calculated in `updateStats` when `opponentRating` provided
- `gameHeader(mode)`: `MODE_LABEL` map renders correct label for all game modes
- Custom game code (Premium): `handleInlineQuery` validates `isCustomCode()` + tier Premium + KV `game:${code}` existence before allowing; Premium gate skipped for joining an existing custom-code game

### Changed
- `GAME_ID_RE`, `CHAIN_CODE_RE`: updated to `{6}` chars
- `PRIVATE_RE`: extended to BO3/BO5/BO7 variants

---

## [1.6.0] — 2026-05-22

### Added
- `getDayIndex(releaseMs, now?)`, `getWeekIndex(releaseMs, now?)`, `getMonthIndex(releaseMs, now?)`: period indexes relative to release date anchor (replace `getDayKey`/`getWeekKey`)
- `UserStats` period fields: `dayIndex`, `weekIndex`, `monthIndex`; per-period `dayWins/Losses/Draws/Streak`, `weekWins/Losses/Draws/Streak`, `monthWins/Losses/Draws/Streak`; `longestDayStreak`, `longestWeekStreak`, `longestMonthStreak`; `longestVsStreak`, `longestVsOpponentId`, `longestVsOpponentName`
- `stats:${userId}:vs:${opponentId}` KV key: per-opponent `currentStreak`, `longestStreak`
- `generateId`: 4 → 6 bytes (entropy 20 → 30 bits)
- Force-start gate in `handleInlineQuery`: returns single "Start bot first" result if `user:info:${from.id}` absent
- `user:info:${userId}` cache write in `handleChosenInlineResult` for all game paths

### Changed
- `updateStats()`: 3+3 KV ops → 2+2 per player; all period stats embedded in `stats:${userId}` JSON key
- `statsResult()`: rewritten for period streaks + vs-opponent streak with username/ID display
- `STATS` inline query: single KV read; `stats:${userId}:week:*` keys obsolete

---

## [1.5.0] — 2026-05-22

### Added
- Per-player emoji reveal: each player's result uses their own config (not host's); `choiceDisplay(choice, config)` helper
- Standard emoji fallback bracket: `🍎 (✊)` when custom emoji differs from default; plain emoji otherwise
- Donator tier enforcement: `/setemoji`, `/setsticker`, `/setthumb` require Basic/Premium tier
- `/activatetier`: bulk (multiple user IDs), flexible duration (`7d`, `60m`, plain int for days); DM notification on activation with tier, expiry UTC + WIB, benefits
- `/donatorlist`: all active donators with name, username, monospace ID, tier badge, expiry
- `/removedonator`: bulk removal
- `/betalist`: updated to name + username + monospace ID format (matches `/donatorlist`)
- `/riverwas`: all commands organized by role
- `/setupcommands`: registers scoped command lists via `setMyCommands`
- `config:suspend:${userId}` KV key: suspends donator config on tier expiry

### Fixed
- `/adddonator` not updating `donators:ids` KV set

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
