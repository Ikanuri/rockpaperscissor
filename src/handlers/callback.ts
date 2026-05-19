import type { CallbackQuery, Choice, Env, GameSession } from '../types';
import { answerCallbackQuery, editInlineMessage } from '../telegram';
import {
  generateId,
  pickKeyboard,
  nextRoundText,
  waitingText,
  runCountdownAndReveal,
  formatUser,
} from '../game';

export async function handleCallbackQuery(
  query: CallbackQuery,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  if (!query.data) return;

  const parts = query.data.split(':');
  const action = parts[0];

  if (action === 'pick' && parts.length === 3) {
    await handlePick(query, env, ctx, parts[1], parts[2] as Choice);
  } else if (action === 'rematch' && parts.length === 2) {
    await handleRematch(query, env, parts[1]);
  } else if (action === 'rpick' && parts.length === 4) {
    await handleRematchPick(query, env, ctx, parts[1], parts[2], parts[3] as Choice);
  }
}

async function handlePick(
  query: CallbackQuery,
  env: Env,
  ctx: ExecutionContext,
  gameId: string,
  choice: Choice
): Promise<void> {
  const token = env.BOT_TOKEN;
  const session = await env.GAME_SESSIONS.get<GameSession>(`game:${gameId}`, 'json');

  if (!session || session.status !== 'playing') {
    await answerCallbackQuery(token, query.id, '❌ Game is not active.', true);
    return;
  }

  if (query.from.id !== session.hostUserId && query.from.id !== session.opponentUserId) {
    await answerCallbackQuery(token, query.id, '❌ This is not your game!', true);
    return;
  }

  const isHost = query.from.id === session.hostUserId;

  if (isHost && session.hostChoice) {
    await answerCallbackQuery(token, query.id, '✅ Already locked in! Waiting for opponent.', true);
    return;
  }
  if (!isHost && session.opponentChoice) {
    await answerCallbackQuery(token, query.id, '✅ Already locked in! Waiting for opponent.', true);
    return;
  }

  const updated: GameSession = {
    ...session,
    ...(isHost ? { hostChoice: choice } : { opponentChoice: choice }),
  };

  await env.GAME_SESSIONS.put(`game:${gameId}`, JSON.stringify(updated), { expirationTtl: 300 });
  await answerCallbackQuery(token, query.id, '🔒 Choice locked!');

  if (updated.hostChoice && updated.opponentChoice) {
    ctx.waitUntil(runCountdownAndReveal(token, env.GAME_SESSIONS, updated));
  } else {
    // Show waiting state — keep keyboard active for the player who hasn't picked
    const waitMsg = nextRoundText(updated) + '\n\n✅ One player is ready...';
    const keyboard = pickKeyboard(gameId);
    await Promise.all([
      editInlineMessage(token, session.hostInlineMessageId, waitMsg, keyboard),
      editInlineMessage(token, session.opponentInlineMessageId!, waitMsg, keyboard),
    ]);
  }
}

async function handleRematch(
  query: CallbackQuery,
  env: Env,
  oldGameId: string
): Promise<void> {
  const token = env.BOT_TOKEN;
  const old = await env.GAME_SESSIONS.get<GameSession>(`game:${oldGameId}`, 'json');

  if (!old || old.status !== 'done') {
    await answerCallbackQuery(token, query.id, '❌ Cannot start rematch.', true);
    return;
  }

  if (query.from.id !== old.hostUserId && query.from.id !== old.opponentUserId) {
    await answerCallbackQuery(token, query.id, '❌ This is not your game!', true);
    return;
  }

  if (!query.inline_message_id) return;

  const newGameId = generateId();
  const clickerName = formatUser(query.from);

  // Show weapon pick keyboard for the rematch
  await editInlineMessage(
    token,
    query.inline_message_id,
    `🔄 *Rematch!*\n━━━━━━━━━━━━━━\n${clickerName} wants a rematch!\n\nPick your weapon:`,
    {
      inline_keyboard: [[
        { text: '✊', callback_data: `rpick:${newGameId}:${query.from.id}:rock` },
        { text: '✋', callback_data: `rpick:${newGameId}:${query.from.id}:paper` },
        { text: '✌️', callback_data: `rpick:${newGameId}:${query.from.id}:scissors` },
      ]],
    }
  );
  await answerCallbackQuery(token, query.id, '🎮 Pick your weapon for the rematch!');
}

async function handleRematchPick(
  query: CallbackQuery,
  env: Env,
  ctx: ExecutionContext,
  newGameId: string,
  requesterId: string,
  choice: Choice
): Promise<void> {
  const token = env.BOT_TOKEN;

  if (String(query.from.id) !== requesterId) {
    await answerCallbackQuery(token, query.id, '❌ Only the rematching player can pick!', true);
    return;
  }

  if (!query.inline_message_id) return;

  // Prevent double-creation
  const existing = await env.GAME_SESSIONS.get(`game:${newGameId}`);
  if (existing) {
    await answerCallbackQuery(token, query.id, '⚠️ Game already set up!', true);
    return;
  }

  const session: GameSession = {
    gameId: newGameId,
    hostUserId: query.from.id,
    hostName: formatUser(query.from),
    hostChoice: choice,
    opponentUserId: null,
    opponentName: null,
    opponentChoice: null,
    hostInlineMessageId: query.inline_message_id,
    opponentInlineMessageId: null,
    status: 'waiting',
    mode: 'single',
    currentRound: 1,
    hostScore: 0,
    opponentScore: 0,
    rounds: [],
    createdAt: Date.now(),
  };

  await env.GAME_SESSIONS.put(`game:${newGameId}`, JSON.stringify(session), { expirationTtl: 600 });

  const rateKey = `ratelimit:${query.from.id}`;
  const count = parseInt(await env.GAME_SESSIONS.get(rateKey) ?? '0');
  await env.GAME_SESSIONS.put(rateKey, String(count + 1), { expirationTtl: 600 });

  await editInlineMessage(token, query.inline_message_id, waitingText(session, env.BOT_USERNAME));
  await answerCallbackQuery(token, query.id, '🔒 Locked in! Share the code with your opponent.');
}
