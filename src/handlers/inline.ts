import type {
  ChainMeta,
  Choice,
  ChosenInlineResult,
  Env,
  GameConfig,
  GameSession,
  InlineQuery,
  InlineResult,
  LeaderboardEntry,
  UserStats,
} from '../types';
import { answerInlineQuery, editInlineMessage } from '../telegram';
import {
  EMOJI,
  escHtml,
  formatUser,
  generateId,
  runRevealAndResult,
  trackHostedGame,
  waitingKeyboard,
  waitingText,
} from '../game';
import { hasFeature } from '../feature';
import { loadConfig } from '../config';

const GAME_ID_RE = /^[A-Z2-9]{6}$/;
const CHAIN_CODE_RE = /^R[A-Z2-9]{6}$/;
// @USERNAME or @USERNAME BO3 — private challenge
const PRIVATE_RE = /^@(\w{1,32})(?:\s+(BO3))?$/;
const CHOICES: Choice[] = ['rock', 'paper', 'scissors'];

const PLACEHOLDER_KEYBOARD = {
  inline_keyboard: [[{ text: '⏳', callback_data: 'loading' }]],
};

const LABELS: Record<Choice, string> = {
  rock: '✊ Rock',
  paper: '✋ Paper',
  scissors: '✌️ Scissors',
};

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildChoiceResults(initText: string, env: Env, config?: GameConfig | null): InlineResult[] {
  const envAny = env as unknown as Record<string, string>;

  const choices = shuffle(CHOICES).map(choice => {
    // Config-based: sticker popup
    if (config?.sticker[choice]) {
      return {
        type: 'sticker' as const,
        id: choice,
        sticker_file_id: config.sticker[choice]!,
        input_message_content: { message_text: initText },
        reply_markup: PLACEHOLDER_KEYBOARD,
      };
    }
    // Config-based: gif thumbnail
    if (config?.thumb[choice]?.type === 'gif') {
      return {
        type: 'gif' as const,
        id: choice,
        gif_file_id: config.thumb[choice]!.value,
        title: LABELS[choice],
        input_message_content: { message_text: initText },
        reply_markup: PLACEHOLDER_KEYBOARD,
      };
    }
    // Env-based: sticker (when no per-user config)
    if (!config) {
      const stickerId = envAny[`STICKER_${choice.toUpperCase()}`];
      if (stickerId) {
        return {
          type: 'sticker' as const,
          id: choice,
          sticker_file_id: stickerId,
          input_message_content: { message_text: initText },
          reply_markup: PLACEHOLDER_KEYBOARD,
        };
      }
    }
    // Article with optional url thumbnail
    const thumbUrl = config?.thumb[choice]?.type === 'url' ? config.thumb[choice]!.value : undefined;
    return {
      type: 'article' as const,
      id: choice,
      title: LABELS[choice],
      input_message_content: { message_text: initText },
      reply_markup: PLACEHOLDER_KEYBOARD,
      ...(thumbUrl && { thumbnail_url: thumbUrl }),
    };
  });

  const randomResult: InlineResult = {
    type: 'article',
    id: 'random',
    title: '🎲 Random',
    description: 'Let fate decide',
    input_message_content: { message_text: initText },
    reply_markup: PLACEHOLDER_KEYBOARD,
  };

  return [randomResult, ...choices];
}

function resolveChoice(resultId: string): Choice {
  if (CHOICES.includes(resultId as Choice)) return resultId as Choice;
  return CHOICES[Math.floor(Math.random() * 3)];
}

function statsResult(stats: UserStats): InlineResult {
  const choiceEntries = Object.entries(stats.choices ?? {}).sort(([, a], [, b]) => b - a);
  const favLine = choiceEntries.length
    ? `\n🎯 Fav: ${EMOJI[choiceEntries[0][0] as Choice]} (${choiceEntries[0][1]}x)`
    : '';

  const currentStreak = stats.currentStreak ?? 0;
  const longestStreak = stats.longestStreak ?? 0;

  let streakBlock = '';
  if (currentStreak > 0 || longestStreak > 0) {
    streakBlock = `\n\n🔥 <b>Streak</b>\n`;
    if (currentStreak >= 2) streakBlock += `Sekarang: ${currentStreak} win beruntun\n`;
    if (longestStreak > 0) streakBlock += `Terpanjang: ${longestStreak}x`;

    const dayS = stats.dayStreak ?? 0;
    const weekS = stats.weekStreak ?? 0;
    const monthS = stats.monthStreak ?? 0;
    if (dayS > 0 || weekS > 0 || monthS > 0) {
      streakBlock += '\n';
      if (dayS > 0) streakBlock += `\n  📅 Hari ini: ${dayS}x`;
      if (weekS > 0) streakBlock += `\n  📅 Minggu ini: ${weekS}x`;
      if (monthS > 0) streakBlock += `\n  📅 Bulan ini: ${monthS}x`;
    }
  }

  let vsLine = '';
  if ((stats.longestVsStreak ?? 0) > 0) {
    const vsName = stats.longestVsOpponentName ? escHtml(stats.longestVsOpponentName) : '';
    const vsId = stats.longestVsOpponentId ?? '';
    vsLine = `\n\n🏅 Vs satu lawan: ${stats.longestVsStreak}x` +
      (vsName ? ` (vs ${vsName}${vsId ? ` · ${vsId}` : ''})` : '');
  }

  const weekWins = stats.weekWins ?? 0;
  const weekLosses = stats.weekLosses ?? 0;
  const weekDraws = stats.weekDraws ?? 0;
  const weekLine = (weekWins + weekLosses + weekDraws) > 0
    ? `\n\n📅 <b>This week</b>\n🏆 ${weekWins}W · 😔 ${weekLosses}L · 🤝 ${weekDraws}D`
    : '';

  const streakTitle = currentStreak >= 2 ? ` 🔥${currentStreak}` : '';

  return {
    type: 'article',
    id: 'stats',
    title: `📊 ${stats.wins}W / ${stats.losses}L / ${stats.draws}D — ${stats.total} games${streakTitle}`,
    description: `This week: ${weekWins}W ${weekLosses}L ${weekDraws}D`,
    input_message_content: {
      message_text:
        `📊 <b>My RPS Stats</b>\n━━━━━━━━━━━━━━\n` +
        `🏆 Wins: ${stats.wins}\n😔 Losses: ${stats.losses}\n🤝 Draws: ${stats.draws}\n📈 Total: ${stats.total}${favLine}` +
        streakBlock + vsLine + weekLine,
      parse_mode: 'HTML',
    },
  };
}

export async function handleInlineQuery(query: InlineQuery, env: Env): Promise<void> {
  const q = query.query.trim().toUpperCase();
  const token = env.BOT_TOKEN;
  const kv = env.GAME_SESSIONS;
  const { from } = query;

  // Force-start gate: user must DM /start before playing inline
  const userInfo = await kv.get(`user:info:${from.id}`);
  if (!userInfo) {
    await answerInlineQuery(token, query.id, [{
      type: 'article',
      id: 'start_required',
      title: '⚠️ Start bot dulu sebelum main',
      description: `Buka chat dengan @${env.BOT_USERNAME} lalu ketik /start`,
      input_message_content: { message_text: `Buka @${env.BOT_USERNAME} dan ketik /start untuk bisa main! 👋` },
    }]);
    return;
  }

  if (q === 'TOP' && hasFeature(env, 'leaderboard')) {
    const board = (await kv.get<LeaderboardEntry[]>('leaderboard', 'json')) ?? [];
    const lines = board.slice(0, 20).map((e, i) =>
      `${i + 1}. ${escHtml(e.name)} — ${e.wins}W / ${e.total - e.wins}L`
    );
    const text = board.length === 0
      ? '📊 Leaderboard is empty. Play some games!'
      : `🏆 <b>Top ${board.length} Players</b>\n━━━━━━━━━━━━━━\n${lines.join('\n')}`;
    await answerInlineQuery(token, query.id, [{
      type: 'article',
      id: 'leaderboard',
      title: board.length > 0 ? `🏆 #1: ${board[0].name} (${board[0].wins}W)` : '🏆 Leaderboard',
      description: board.length > 0 ? `Top ${board.length} players this season` : 'No data yet',
      input_message_content: { message_text: text, parse_mode: 'HTML' },
    }]);
    return;
  }

  if (q === 'CLEARHOST') {
    await answerInlineQuery(token, query.id, [{
      type: 'article',
      id: 'clearhost',
      title: '🧹 Cancel all my hosted games',
      description: "Removes all waiting games you're currently hosting",
      input_message_content: { message_text: '🧹 Cancelling hosted games...' },
      reply_markup: PLACEHOLDER_KEYBOARD,
    }]);
    return;
  }

  if (q === 'SYNCSTATS') {
    await answerInlineQuery(token, query.id, [{
      type: 'article',
      id: 'syncstats',
      title: '🔄 Sync weekly stats',
      description: 'Copy your all-time stats to this week',
      input_message_content: { message_text: '🔄 Syncing stats...' },
      reply_markup: PLACEHOLDER_KEYBOARD,
    }]);
    return;
  }

  if (q === 'STATS') {
    const s = (await kv.get<UserStats>(`stats:${from.id}`, 'json')) ?? { wins: 0, losses: 0, draws: 0, total: 0 };
    await answerInlineQuery(token, query.id, [statsResult(s)]);
    return;
  }

  // Chain rematch code
  if (CHAIN_CODE_RE.test(q)) {
    const meta = await kv.get<ChainMeta>(`chain:${q}:meta`, 'json');
    if (!meta) {
      await answerInlineQuery(token, query.id, [{
        type: 'article', id: 'err', title: '❌ Rematch expired',
        description: 'Start a new game instead.',
        input_message_content: { message_text: '❌ Rematch expired. Start a new game.' },
      }]);
      return;
    }
    if (from.id !== meta.hostUserId && from.id !== meta.opponentUserId) {
      await answerInlineQuery(token, query.id, [{
        type: 'article', id: 'err', title: '❌ Not your game',
        description: 'This rematch is for the original players only.',
        input_message_content: { message_text: '❌ Not your game.' },
      }]);
      return;
    }
    const config = hasFeature(env, 'gif_thumb') ? await loadConfig(kv, from.id, env) : null;
    await answerInlineQuery(token, query.id, buildChoiceResults('🔄 Rematch!', env, config));
    return;
  }

  // Regular game join by code
  if (GAME_ID_RE.test(q)) {
    const session = await kv.get<GameSession>(`game:${q}`, 'json');

    if (!session) {
      await answerInlineQuery(token, query.id, [{
        type: 'article', id: 'err', title: '❌ Game not found',
        description: 'This game does not exist or has expired.',
        input_message_content: { message_text: '❌ Game not found.' },
      }]);
      return;
    }

    if (session.status !== 'waiting') {
      await answerInlineQuery(token, query.id, [{
        type: 'article', id: 'err', title: '❌ Game already started',
        description: 'This game is in progress or has ended.',
        input_message_content: { message_text: '❌ Game already started.' },
      }]);
      return;
    }

    if (session.hostUserId === from.id) {
      await answerInlineQuery(token, query.id, [{
        type: 'article', id: 'err', title: '❌ This is your own game!',
        description: 'Share the code with a friend to challenge them.',
        input_message_content: { message_text: '❌ You cannot join your own game!' },
      }]);
      return;
    }

    if (session.lockedToUsername &&
        from.username?.toLowerCase() !== session.lockedToUsername.toLowerCase()) {
      await answerInlineQuery(token, query.id, [{
        type: 'article', id: 'err', title: '🔒 Private game',
        description: `Only @${session.lockedToUsername} can join.`,
        input_message_content: { message_text: `❌ This game is for @${session.lockedToUsername} only.` },
      }]);
      return;
    }

    if (Date.now() - session.createdAt > 9 * 60 * 1000) {
      const joinQuery = session.chainId ?? undefined;
      await editInlineMessage(
        token,
        session.hostInlineMessageId,
        waitingText(session, env.BOT_USERNAME, Date.now()),
        waitingKeyboard(session.gameId, joinQuery)
      );
    }

    const config = hasFeature(env, 'gif_thumb') ? await loadConfig(kv, from.id, env) : null;
    await answerInlineQuery(token, query.id, buildChoiceResults('⚔️ Challenge accepted!', env, config));
    return;
  }

  // Private challenge: @username [BO3]
  const privateMatch = PRIVATE_RE.exec(q);
  if (privateMatch) {
    const rateKey = `ratelimit:${from.id}`;
    const active = parseInt(await kv.get(rateKey) ?? '0');
    if (active >= 3) {
      await answerInlineQuery(token, query.id, [{
        type: 'article', id: 'err', title: '⏳ Too many active games',
        description: 'You already have 3 active games. Finish them first!',
        input_message_content: { message_text: '⏳ Too many active games.' },
      }]);
      return;
    }
    const targetUsername = privateMatch[1];
    const modeLabel = privateMatch[2] === 'BO3' ? ' BO3' : '';
    const config = hasFeature(env, 'gif_thumb') ? await loadConfig(kv, from.id, env) : null;
    await answerInlineQuery(token, query.id, buildChoiceResults(`🔒 Private challenge for @${targetUsername}${modeLabel}`, env, config));
    return;
  }

  const rateKey = `ratelimit:${from.id}`;
  const active = parseInt(await kv.get(rateKey) ?? '0');
  if (active >= 3) {
    await answerInlineQuery(token, query.id, [{
      type: 'article', id: 'err', title: '⏳ Too many active games',
      description: 'You already have 3 active games. Finish them first!',
      input_message_content: { message_text: '⏳ You have too many active games. Finish them first!' },
    }]);
    return;
  }

  const config = hasFeature(env, 'gif_thumb') ? await loadConfig(kv, from.id, env) : null;
  await answerInlineQuery(token, query.id, buildChoiceResults('🎮 Setting up game...', env, config));
}

export async function handleChosenInlineResult(
  result: ChosenInlineResult,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  if (!result.inline_message_id) return;

  const q = result.query.trim().toUpperCase();
  const token = env.BOT_TOKEN;
  const kv = env.GAME_SESSIONS;

  if (q === 'CLEARHOST') {
    const listKey = `hostgames:${result.from.id}`;
    const gameIds = await kv.get<string[]>(listKey, 'json') ?? [];
    let cancelled = 0;
    for (const gameId of gameIds) {
      const session = await kv.get<GameSession>(`game:${gameId}`, 'json');
      if (session && session.status === 'waiting' && session.hostUserId === result.from.id) {
        await Promise.all([
          kv.delete(`game:${gameId}`),
          editInlineMessage(token, session.hostInlineMessageId, '❌ Game cancelled.'),
        ]);
        cancelled++;
      }
    }
    await Promise.all([
      kv.delete(listKey),
      kv.put(`ratelimit:${result.from.id}`, '0', { expirationTtl: 600 }),
    ]);
    await editInlineMessage(token, result.inline_message_id,
      cancelled > 0
        ? `🧹 ${cancelled} game${cancelled > 1 ? 's' : ''} cancelled.`
        : `🧹 No active hosted games found.`
    );
    return;
  }

  if (q === 'SYNCSTATS') {
    // SYNCSTATS no longer needed — period stats are embedded in the main stats key and update automatically.
    await editInlineMessage(token, result.inline_message_id,
      `ℹ️ SYNCSTATS tidak lagi diperlukan.\nStats periode (hari/minggu/bulan) diupdate otomatis setiap game selesai.`
    );
    return;
  }

  const choice = resolveChoice(result.result_id);

  // Keep user info cache fresh even for users who haven't DM'd the bot
  kv.put(`user:info:${result.from.id}`, JSON.stringify({
    name: result.from.first_name,
    username: result.from.username ?? null,
  }));

  // Chain rematch
  if (CHAIN_CODE_RE.test(q)) {
    const chainCode = q;
    const meta = await kv.get<ChainMeta>(`chain:${chainCode}:meta`, 'json');
    if (!meta) {
      await editInlineMessage(token, result.inline_message_id, '❌ Rematch expired. Start a new game.');
      return;
    }
    if (result.from.id !== meta.hostUserId && result.from.id !== meta.opponentUserId) {
      await editInlineMessage(token, result.inline_message_id, '❌ Not your game.');
      return;
    }

    const activeGameId = await kv.get(`chain:${chainCode}:active`);

    if (!activeGameId) {
      const newGameId = generateId();
      const session: GameSession = {
        gameId: newGameId,
        hostUserId: result.from.id,
        hostName: formatUser(result.from),
        hostChoice: choice,
        opponentUserId: null,
        opponentName: null,
        opponentChoice: null,
        hostInlineMessageId: result.inline_message_id,
        opponentInlineMessageId: null,
        status: 'waiting',
        mode: meta.mode,
        currentRound: 1,
        hostScore: 0,
        opponentScore: 0,
        rounds: [],
        createdAt: Date.now(),
        chainId: chainCode,
      };
      await Promise.all([
        kv.put(`game:${newGameId}`, JSON.stringify(session), { expirationTtl: 300 }),
        kv.put(`chain:${chainCode}:active`, newGameId, { expirationTtl: 300 }),
        trackHostedGame(kv, result.from.id, newGameId),
      ]);
      const rateKey = `ratelimit:${result.from.id}`;
      const count = parseInt(await kv.get(rateKey) ?? '0');
      await kv.put(rateKey, String(count + 1), { expirationTtl: 600 });
      // Join button uses chain code so opponent goes through chain path (keeps active clean)
      await editInlineMessage(
        token,
        result.inline_message_id,
        waitingText(session, env.BOT_USERNAME),
        waitingKeyboard(newGameId, chainCode)
      );
    } else {
      const session = await kv.get<GameSession>(`game:${activeGameId}`, 'json');
      if (!session || session.status !== 'waiting') {
        await editInlineMessage(token, result.inline_message_id, '❌ Rematch already started or expired.');
        return;
      }
      if (session.hostUserId === result.from.id) {
        await editInlineMessage(token, result.inline_message_id, '⏳ Already waiting — your opponent needs to click Rematch too.');
        return;
      }
      const updated: GameSession = {
        ...session,
        opponentUserId: result.from.id,
        opponentName: formatUser(result.from),
        opponentChoice: choice,
        opponentInlineMessageId: result.inline_message_id,
        status: 'playing',
      };
      await Promise.all([
        kv.put(`game:${activeGameId}`, JSON.stringify(updated), { expirationTtl: 120 }),
        kv.delete(`chain:${chainCode}:active`),
      ]);
      ctx.waitUntil(runRevealAndResult(token, kv, updated, env));
    }
    return;
  }

  // Private challenge: @USERNAME [BO3]
  const privateMatch = PRIVATE_RE.exec(q);
  if (privateMatch) {
    const lockedToUsername = privateMatch[1].toLowerCase();
    const mode = privateMatch[2] === 'BO3' ? 'best_of_3' : 'single';
    const gameId = generateId();

    const session: GameSession = {
      gameId,
      hostUserId: result.from.id,
      hostName: formatUser(result.from),
      hostChoice: choice,
      opponentUserId: null,
      opponentName: null,
      opponentChoice: null,
      hostInlineMessageId: result.inline_message_id,
      opponentInlineMessageId: null,
      status: 'waiting',
      mode,
      currentRound: 1,
      hostScore: 0,
      opponentScore: 0,
      rounds: [],
      createdAt: Date.now(),
      lockedToUsername,
    };

    await Promise.all([
      kv.put(`game:${gameId}`, JSON.stringify(session), { expirationTtl: 600 }),
      trackHostedGame(kv, result.from.id, gameId),
    ]);

    const rateKey = `ratelimit:${result.from.id}`;
    const count = parseInt(await kv.get(rateKey) ?? '0');
    await kv.put(rateKey, String(count + 1), { expirationTtl: 600 });

    await editInlineMessage(
      token,
      result.inline_message_id,
      waitingText(session, env.BOT_USERNAME),
      waitingKeyboard(gameId)
    );
    return;
  }

  // Regular game join by code
  if (GAME_ID_RE.test(q)) {
    const session = await kv.get<GameSession>(`game:${q}`, 'json');
    if (!session || session.status !== 'waiting' || session.hostUserId === result.from.id) return;

    if (session.lockedToUsername &&
        result.from.username?.toLowerCase() !== session.lockedToUsername.toLowerCase()) {
      await editInlineMessage(token, result.inline_message_id, `❌ This game is for @${session.lockedToUsername} only.`);
      return;
    }

    const updated: GameSession = {
      ...session,
      opponentUserId: result.from.id,
      opponentName: formatUser(result.from),
      opponentChoice: choice,
      opponentInlineMessageId: result.inline_message_id,
      status: 'playing',
    };

    await Promise.all([
      kv.put(`game:${q}`, JSON.stringify(updated), { expirationTtl: 120 }),
      // Clean up chain active pointer so next rematch isn't blocked
      ...(session.chainId ? [kv.delete(`chain:${session.chainId}:active`)] : []),
    ]);

    const rateKey = `ratelimit:${session.hostUserId}`;
    const cur = parseInt(await kv.get(rateKey) ?? '1');
    if (cur > 0) await kv.put(rateKey, String(cur - 1), { expirationTtl: 600 });

    ctx.waitUntil(runRevealAndResult(token, kv, updated, env));
    return;
  }

  // New game
  const mode = q === 'BO3' ? 'best_of_3' : 'single';
  const gameId = generateId();

  const session: GameSession = {
    gameId,
    hostUserId: result.from.id,
    hostName: formatUser(result.from),
    hostChoice: choice,
    opponentUserId: null,
    opponentName: null,
    opponentChoice: null,
    hostInlineMessageId: result.inline_message_id,
    opponentInlineMessageId: null,
    status: 'waiting',
    mode,
    currentRound: 1,
    hostScore: 0,
    opponentScore: 0,
    rounds: [],
    createdAt: Date.now(),
  };

  await Promise.all([
    kv.put(`game:${gameId}`, JSON.stringify(session), { expirationTtl: 600 }),
    trackHostedGame(kv, result.from.id, gameId),
  ]);

  const rateKey = `ratelimit:${result.from.id}`;
  const count = parseInt(await kv.get(rateKey) ?? '0');
  await kv.put(rateKey, String(count + 1), { expirationTtl: 600 });

  await editInlineMessage(
    token,
    result.inline_message_id,
    waitingText(session, env.BOT_USERNAME),
    waitingKeyboard(gameId)
  );
}
