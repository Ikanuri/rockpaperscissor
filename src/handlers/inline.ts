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
} from '../types';
import { answerInlineQuery, editInlineMessage } from '../telegram';
import {
  EMOJI,
  escHtml,
  formatUser,
  generateId,
  getWeekKey,
  runRevealAndResult,
  waitingKeyboard,
  waitingText,
} from '../game';
import { hasFeature } from '../feature';
import { loadConfig } from '../config';

const GAME_ID_RE = /^[A-Z2-9]{4}$/;
const CHAIN_CODE_RE = /^R[A-Z2-9]{4}$/;
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

function statsResult(
  stats: { wins: number; losses: number; draws: number; total: number; choices?: Record<string, number> },
  weekly: { wins: number; losses: number; draws: number; total: number }
): InlineResult {
  const choiceEntries = Object.entries(stats.choices ?? {}).sort(([, a], [, b]) => b - a);
  const favLine = choiceEntries.length
    ? `\n🎯 Fav: ${EMOJI[choiceEntries[0][0] as Choice]} (${choiceEntries[0][1]}x)`
    : '';

  return {
    type: 'article',
    id: 'stats',
    title: `📊 ${stats.wins}W / ${stats.losses}L / ${stats.draws}D — ${stats.total} games`,
    description: `This week: ${weekly.wins}W ${weekly.losses}L ${weekly.draws}D`,
    input_message_content: {
      message_text:
        `📊 <b>My RPS Stats</b>\n━━━━━━━━━━━━━━\n` +
        `🏆 Wins: ${stats.wins}\n😔 Losses: ${stats.losses}\n🤝 Draws: ${stats.draws}\n📈 Total: ${stats.total}${favLine}\n\n` +
        `📅 <b>This week</b>\n` +
        `🏆 ${weekly.wins}W · 😔 ${weekly.losses}L · 🤝 ${weekly.draws}D`,
      parse_mode: 'HTML',
    },
  };
}

export async function handleInlineQuery(query: InlineQuery, env: Env): Promise<void> {
  const q = query.query.trim().toUpperCase();
  const token = env.BOT_TOKEN;
  const kv = env.GAME_SESSIONS;

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

  if (q === 'STATS') {
    const weekKey = getWeekKey();
    const [lifetime, weekly] = await Promise.all([
      kv.get<{ wins: number; losses: number; draws: number; total: number; choices?: Record<string, number> }>(
        `stats:${query.from.id}`, 'json'
      ),
      kv.get<{ wins: number; losses: number; draws: number; total: number }>(
        `stats:${query.from.id}:week:${weekKey}`, 'json'
      ),
    ]);
    const s = lifetime ?? { wins: 0, losses: 0, draws: 0, total: 0 };
    const w = weekly ?? { wins: 0, losses: 0, draws: 0, total: 0 };
    await answerInlineQuery(token, query.id, [statsResult(s, w)]);
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
    if (query.from.id !== meta.hostUserId && query.from.id !== meta.opponentUserId) {
      await answerInlineQuery(token, query.id, [{
        type: 'article', id: 'err', title: '❌ Not your game',
        description: 'This rematch is for the original players only.',
        input_message_content: { message_text: '❌ Not your game.' },
      }]);
      return;
    }
    const config = hasFeature(env, 'gif_thumb') ? await loadConfig(kv, query.from.id, env) : null;
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

    if (session.hostUserId === query.from.id) {
      await answerInlineQuery(token, query.id, [{
        type: 'article', id: 'err', title: '❌ This is your own game!',
        description: 'Share the code with a friend to challenge them.',
        input_message_content: { message_text: '❌ You cannot join your own game!' },
      }]);
      return;
    }

    if (session.lockedToUsername &&
        query.from.username?.toLowerCase() !== session.lockedToUsername.toLowerCase()) {
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

    const config = hasFeature(env, 'gif_thumb') ? await loadConfig(kv, query.from.id, env) : null;
    await answerInlineQuery(token, query.id, buildChoiceResults('⚔️ Challenge accepted!', env, config));
    return;
  }

  // Private challenge: @username [BO3]
  const privateMatch = PRIVATE_RE.exec(q);
  if (privateMatch) {
    const rateKey = `ratelimit:${query.from.id}`;
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
    const config = hasFeature(env, 'gif_thumb') ? await loadConfig(kv, query.from.id, env) : null;
    await answerInlineQuery(token, query.id, buildChoiceResults(`🔒 Private challenge for @${targetUsername}${modeLabel}`, env, config));
    return;
  }

  const rateKey = `ratelimit:${query.from.id}`;
  const active = parseInt(await kv.get(rateKey) ?? '0');
  if (active >= 3) {
    await answerInlineQuery(token, query.id, [{
      type: 'article', id: 'err', title: '⏳ Too many active games',
      description: 'You already have 3 active games. Finish them first!',
      input_message_content: { message_text: '⏳ You have too many active games. Finish them first!' },
    }]);
    return;
  }

  const config = hasFeature(env, 'gif_thumb') ? await loadConfig(kv, query.from.id, env) : null;
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
  const choice = resolveChoice(result.result_id);

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

    await kv.put(`game:${gameId}`, JSON.stringify(session), { expirationTtl: 600 });

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

  await kv.put(`game:${gameId}`, JSON.stringify(session), { expirationTtl: 600 });

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
