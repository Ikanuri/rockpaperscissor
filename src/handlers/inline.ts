import type { InlineQuery, ChosenInlineResult, Env, GameSession, Choice, InlineQueryResultArticle } from '../types';
import { answerInlineQuery, editInlineMessage } from '../telegram';
import {
  LABEL,
  formatUser,
  generateId,
  waitingText,
  expiringText,
  runCountdownAndReveal,
} from '../game';

const GAME_ID_RE = /^[A-Z2-9]{4}$/;

function choiceResults(forJoin: boolean, gameIdOrMode?: string): InlineQueryResultArticle[] {
  const choices: Choice[] = ['rock', 'paper', 'scissors'];
  return choices.map(choice => ({
    type: 'article' as const,
    id: choice,
    title: LABEL[choice],
    description: forJoin
      ? `Join game with ${LABEL[choice]}`
      : `Challenge someone with ${LABEL[choice]}`,
    input_message_content: {
      message_text: forJoin ? '⚔️ Challenge accepted!' : '🎮 Setting up game...',
    },
    reply_markup: {
      inline_keyboard: [[{ text: '⏳', callback_data: 'loading' }]],
    },
    thumbnail_url: `https://em-content.zobj.net/source/twitter/376/${
      choice === 'rock' ? 'raised-fist_270a' :
      choice === 'paper' ? 'raised-hand_270b' : 'victory-hand_270c-fe0f'
    }.png`,
    thumbnail_width: 72,
    thumbnail_height: 72,
  }));
}

export async function handleInlineQuery(query: InlineQuery, env: Env): Promise<void> {
  const q = query.query.trim().toUpperCase();
  const token = env.BOT_TOKEN;

  // Stats
  if (q === 'STATS') {
    const stats = await env.GAME_SESSIONS.get<{ wins: number; losses: number; draws: number; total: number }>(
      `stats:${query.from.id}`,
      'json'
    ) ?? { wins: 0, losses: 0, draws: 0, total: 0 };

    await answerInlineQuery(token, query.id, [{
      type: 'article',
      id: 'stats',
      title: `📊 ${stats.wins}W / ${stats.losses}L / ${stats.draws}D — ${stats.total} games`,
      description: 'Tap to share your stats',
      input_message_content: {
        message_text:
          `📊 *My RPS Stats*\n━━━━━━━━━━━━━━\n🏆 Wins: ${stats.wins}\n😔 Losses: ${stats.losses}\n🤝 Draws: ${stats.draws}\n📈 Total: ${stats.total}`,
        parse_mode: 'Markdown',
      },
    }]);
    return;
  }

  // Join game
  if (GAME_ID_RE.test(q)) {
    const session = await env.GAME_SESSIONS.get<GameSession>(`game:${q}`, 'json');

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

    // Expiry warning: game older than 9 minutes
    if (Date.now() - session.createdAt > 9 * 60 * 1000) {
      await editInlineMessage(token, session.hostInlineMessageId, expiringText(session, env.BOT_USERNAME));
    }

    await answerInlineQuery(token, query.id, choiceResults(true, q));
    return;
  }

  // Rate limit: max 3 active games per user
  const rateKey = `ratelimit:${query.from.id}`;
  const active = parseInt(await env.GAME_SESSIONS.get(rateKey) ?? '0');
  if (active >= 3) {
    await answerInlineQuery(token, query.id, [{
      type: 'article', id: 'err', title: '⏳ Too many active games',
      description: 'You already have 3 active games. Finish them first!',
      input_message_content: { message_text: '⏳ You have too many active games. Finish them first!' },
    }]);
    return;
  }

  // New game (single round or best of 3)
  await answerInlineQuery(token, query.id, choiceResults(false));
}

export async function handleChosenInlineResult(
  result: ChosenInlineResult,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  if (!result.inline_message_id) return;

  const choice = result.result_id as Choice;
  if (!['rock', 'paper', 'scissors'].includes(choice)) return;

  const q = result.query.trim().toUpperCase();
  const token = env.BOT_TOKEN;

  // Opponent joining an existing game
  if (GAME_ID_RE.test(q)) {
    const session = await env.GAME_SESSIONS.get<GameSession>(`game:${q}`, 'json');
    if (!session || session.status !== 'waiting' || session.hostUserId === result.from.id) return;

    const updated: GameSession = {
      ...session,
      opponentUserId: result.from.id,
      opponentName: formatUser(result.from),
      opponentChoice: choice,
      opponentInlineMessageId: result.inline_message_id,
      status: 'playing',
    };

    await env.GAME_SESSIONS.put(`game:${q}`, JSON.stringify(updated), { expirationTtl: 120 });

    // Decrement host's active game count
    const rateKey = `ratelimit:${session.hostUserId}`;
    const cur = parseInt(await env.GAME_SESSIONS.get(rateKey) ?? '1');
    if (cur > 0) await env.GAME_SESSIONS.put(rateKey, String(cur - 1), { expirationTtl: 600 });

    ctx.waitUntil(runCountdownAndReveal(token, env.GAME_SESSIONS, updated));
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

  await env.GAME_SESSIONS.put(`game:${gameId}`, JSON.stringify(session), { expirationTtl: 600 });

  // Increment active game count for rate limiting
  const rateKey = `ratelimit:${result.from.id}`;
  const count = parseInt(await env.GAME_SESSIONS.get(rateKey) ?? '0');
  await env.GAME_SESSIONS.put(rateKey, String(count + 1), { expirationTtl: 600 });

  await editInlineMessage(token, result.inline_message_id, waitingText(session, env.BOT_USERNAME));
}
