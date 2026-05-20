import type {
  Choice,
  ChosenInlineResult,
  GameConfig,
  GameSession,
  InlineQuery,
  InlineResult,
  LeaderboardEntry,
  Env,
} from '../types';
import { answerInlineQuery, editInlineMessage } from '../telegram';
import {
  cancelKeyboard,
  formatUser,
  generateId,
  waitingText,
  runCountdownAndReveal,
} from '../game';
import { loadConfig } from '../config';
import { isBetaUser } from '../feature';

const GAME_ID_RE = /^[A-Z2-9]{4}$/;
const CHOICES: Choice[] = ['rock', 'paper', 'scissors'];

const PLACEHOLDER_KEYBOARD = {
  inline_keyboard: [[{ text: '⏳', callback_data: 'loading' }]],
};

function choiceResults(forJoin: boolean, config: GameConfig): InlineResult[] {
  const initText = forJoin ? '⚔️ Challenge accepted!' : '🎮 Setting up game...';

  return CHOICES.map(choice => {
    // Sticker popup (env STICKER_* or user config)
    const stickerId = config.sticker[choice];
    if (stickerId) {
      return {
        type: 'sticker' as const,
        id: choice,
        sticker_file_id: stickerId,
        input_message_content: { message_text: initText },
        reply_markup: PLACEHOLDER_KEYBOARD,
      };
    }

    const thumb = config.thumb[choice];

    if (!thumb) {
      return {
        type: 'article' as const,
        id: choice,
        title: config.article[choice],
        input_message_content: { message_text: initText },
        reply_markup: PLACEHOLDER_KEYBOARD,
      };
    }

    if (thumb.type === 'gif') {
      return {
        type: 'gif' as const,
        id: choice,
        gif_file_id: thumb.value,
        input_message_content: { message_text: initText },
        reply_markup: PLACEHOLDER_KEYBOARD,
      };
    }

    if (thumb.type === 'sticker') {
      return {
        type: 'sticker' as const,
        id: choice,
        sticker_file_id: thumb.value,
        input_message_content: { message_text: initText },
        reply_markup: PLACEHOLDER_KEYBOARD,
      };
    }

    // url
    return {
      type: 'article' as const,
      id: choice,
      title: config.article[choice],
      input_message_content: { message_text: initText },
      reply_markup: PLACEHOLDER_KEYBOARD,
      thumbnail_url: thumb.value,
      thumbnail_width: 72,
      thumbnail_height: 72,
    };
  });
}

function statsResult(stats: { wins: number; losses: number; draws: number; total: number }): InlineResult {
  return {
    type: 'article',
    id: 'stats',
    title: `📊 ${stats.wins}W / ${stats.losses}L / ${stats.draws}D — ${stats.total} games`,
    description: 'Tap to share your stats',
    input_message_content: {
      message_text:
        `📊 <b>My RPS Stats</b>\n━━━━━━━━━━━━━━\n` +
        `🏆 Wins: ${stats.wins}\n😔 Losses: ${stats.losses}\n🤝 Draws: ${stats.draws}\n📈 Total: ${stats.total}`,
      parse_mode: 'HTML',
    },
  };
}

function leaderboardResult(lb: LeaderboardEntry[]): InlineResult {
  const lines = lb.length > 0
    ? lb.map((e, i) => `${i + 1}. ${e.name} — ${e.wins}W / ${e.total} games`).join('\n')
    : 'No games played yet!';

  return {
    type: 'article',
    id: 'leaderboard',
    title: `🏆 Top ${lb.length} Players`,
    description: lb[0] ? `#1: ${lb[0].name} (${lb[0].wins} wins)` : 'No data yet',
    input_message_content: {
      message_text: `🏆 <b>RPS Leaderboard</b>\n━━━━━━━━━━━━━━\n${lines}`,
      parse_mode: 'HTML',
    },
  };
}

export async function handleInlineQuery(query: InlineQuery, env: Env): Promise<void> {
  const q = query.query.trim().toUpperCase();
  const token = env.BOT_TOKEN;
  const kv = env.GAME_SESSIONS;

  // Stats
  if (q === 'STATS') {
    const stats = await kv.get<{ wins: number; losses: number; draws: number; total: number }>(
      `stats:${query.from.id}`,
      'json'
    ) ?? { wins: 0, losses: 0, draws: 0, total: 0 };
    await answerInlineQuery(token, query.id, [statsResult(stats)]);
    return;
  }

  // Leaderboard (beta)
  if (q === 'TOP') {
    const beta = await isBetaUser(kv, query.from.id, env.BOT_OWNER_ID ?? '');
    if (beta) {
      const lb = await kv.get<LeaderboardEntry[]>('leaderboard', 'json') ?? [];
      await answerInlineQuery(token, query.id, [leaderboardResult(lb)]);
      return;
    }
  }

  // Load config for this querier (determines popup appearance)
  const config = await loadConfig(kv, query.from.id, env);

  // Join game
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

    // Refresh expiry indicator if game is getting old
    if (Date.now() - session.createdAt > 9 * 60 * 1000) {
      await editInlineMessage(
        token,
        session.hostInlineMessageId,
        waitingText(session, env.BOT_USERNAME, Date.now()),
        cancelKeyboard(session.gameId)
      );
    }

    await answerInlineQuery(token, query.id, choiceResults(true, config));
    return;
  }

  // Rate limit: max 3 active games per user
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

  // New game (single or BO3)
  await answerInlineQuery(token, query.id, choiceResults(false, config));
}

export async function handleChosenInlineResult(
  result: ChosenInlineResult,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  if (!result.inline_message_id) return;

  const choice = result.result_id as Choice;
  if (!CHOICES.includes(choice)) return;

  const q = result.query.trim().toUpperCase();
  const token = env.BOT_TOKEN;
  const kv = env.GAME_SESSIONS;

  // Opponent joining an existing game
  if (GAME_ID_RE.test(q)) {
    const session = await kv.get<GameSession>(`game:${q}`, 'json');
    if (!session || session.status !== 'waiting' || session.hostUserId === result.from.id) return;

    const updated: GameSession = {
      ...session,
      opponentUserId: result.from.id,
      opponentName: formatUser(result.from),
      opponentChoice: choice,
      opponentInlineMessageId: result.inline_message_id,
      status: 'playing',
    };

    await kv.put(`game:${q}`, JSON.stringify(updated), { expirationTtl: 120 });

    const rateKey = `ratelimit:${session.hostUserId}`;
    const cur = parseInt(await kv.get(rateKey) ?? '1');
    if (cur > 0) await kv.put(rateKey, String(cur - 1), { expirationTtl: 600 });

    ctx.waitUntil(runCountdownAndReveal(token, kv, updated, env));
    return;
  }

  // Host creating a new game
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
    cancelKeyboard(gameId)
  );
}
