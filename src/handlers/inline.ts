import type {
  Choice,
  ChosenInlineResult,
  GameSession,
  InlineQuery,
  InlineResult,
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

const GAME_ID_RE = /^[A-Z2-9]{4}$/;
const CHOICES: Choice[] = ['rock', 'paper', 'scissors'];

const PLACEHOLDER_KEYBOARD = {
  inline_keyboard: [[{ text: '⏳', callback_data: 'loading' }]],
};

const LABELS: Record<Choice, string> = {
  rock: '✊ Rock',
  paper: '✋ Paper',
  scissors: '✌️ Scissors',
};

function choiceResults(forJoin: boolean, env: Env): InlineResult[] {
  const initText = forJoin ? '⚔️ Challenge accepted!' : '🎮 Setting up game...';
  const envAny = env as unknown as Record<string, string>;

  return CHOICES.map(choice => {
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
    return {
      type: 'article' as const,
      id: choice,
      title: LABELS[choice],
      input_message_content: { message_text: initText },
      reply_markup: PLACEHOLDER_KEYBOARD,
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

export async function handleInlineQuery(query: InlineQuery, env: Env): Promise<void> {
  const q = query.query.trim().toUpperCase();
  const token = env.BOT_TOKEN;
  const kv = env.GAME_SESSIONS;

  if (q === 'STATS') {
    const stats = await kv.get<{ wins: number; losses: number; draws: number; total: number }>(
      `stats:${query.from.id}`,
      'json'
    ) ?? { wins: 0, losses: 0, draws: 0, total: 0 };
    await answerInlineQuery(token, query.id, [statsResult(stats)]);
    return;
  }

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

    if (Date.now() - session.createdAt > 9 * 60 * 1000) {
      await editInlineMessage(
        token,
        session.hostInlineMessageId,
        waitingText(session, env.BOT_USERNAME, Date.now()),
        cancelKeyboard(session.gameId)
      );
    }

    await answerInlineQuery(token, query.id, choiceResults(true, env));
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

  await answerInlineQuery(token, query.id, choiceResults(false, env));
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
