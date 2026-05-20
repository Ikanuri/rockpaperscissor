import type { CallbackQuery, Choice, Env, GameSession, RematchMeta } from '../types';
import { answerCallbackQuery, editInlineMessage } from '../telegram';
import {
  generateId,
  nextRoundText,
  pickKeyboard,
  rematchPickKeyboard,
  runCountdownAndReveal,
  waitingText,
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
  } else if (action === 'cancel' && parts.length === 2) {
    await handleCancel(query, env, parts[1]);
  } else if (action === 'rematch' && parts.length === 2) {
    await handleRematch(query, env, parts[1]);
  } else if (action === 'rpick' && parts.length === 3) {
    await handleRpick(query, env, ctx, parts[1], parts[2] as Choice);
  } else if (action === 'refresh' && parts.length === 2) {
    await handleRefresh(query, env, parts[1]);
  } else {
    await answerCallbackQuery(env.BOT_TOKEN, query.id);
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
    ctx.waitUntil(runCountdownAndReveal(token, env.GAME_SESSIONS, updated, env));
  } else {
    const waitMsg = nextRoundText(updated) + '\n\n✅ One player is ready...';
    const keyboard = pickKeyboard(gameId);
    await Promise.all([
      editInlineMessage(token, session.hostInlineMessageId, waitMsg, keyboard),
      editInlineMessage(token, session.opponentInlineMessageId!, waitMsg, keyboard),
    ]);
  }
}

async function handleCancel(
  query: CallbackQuery,
  env: Env,
  gameId: string
): Promise<void> {
  const token = env.BOT_TOKEN;
  const session = await env.GAME_SESSIONS.get<GameSession>(`game:${gameId}`, 'json');

  if (!session || session.status !== 'waiting') {
    await answerCallbackQuery(token, query.id, '❌ Game not found or already started.', true);
    return;
  }

  if (query.from.id !== session.hostUserId) {
    await answerCallbackQuery(token, query.id, '❌ Only the host can cancel.', true);
    return;
  }

  await env.GAME_SESSIONS.delete(`game:${gameId}`);

  const rateKey = `ratelimit:${session.hostUserId}`;
  const cur = parseInt(await env.GAME_SESSIONS.get(rateKey) ?? '1');
  if (cur > 0) await env.GAME_SESSIONS.put(rateKey, String(cur - 1), { expirationTtl: 600 });

  await editInlineMessage(token, session.hostInlineMessageId, '❌ Game cancelled.');
  await answerCallbackQuery(token, query.id);
}

async function handleRematch(
  query: CallbackQuery,
  env: Env,
  prevGameId: string
): Promise<void> {
  const token = env.BOT_TOKEN;
  if (!query.inline_message_id) {
    await answerCallbackQuery(token, query.id);
    return;
  }

  const rematchId = `R${prevGameId}`;
  // Meta pre-populated by finishGame — works even after the game session TTL expires
  const meta = await env.GAME_SESSIONS.get<RematchMeta>(`rematch:${rematchId}:meta`, 'json');
  if (!meta) {
    await answerCallbackQuery(token, query.id, '❌ Rematch expired. Start a new game.', true);
    return;
  }

  if (query.from.id !== meta.hostUserId && query.from.id !== meta.opponentUserId) {
    await answerCallbackQuery(token, query.id, '❌ This is not your game!', true);
    return;
  }

  const keyboard = rematchPickKeyboard(rematchId);
  await editInlineMessage(token, query.inline_message_id, '🔄 Rematch — pick your weapon!', keyboard);
  await answerCallbackQuery(token, query.id);
}

async function handleRpick(
  query: CallbackQuery,
  env: Env,
  ctx: ExecutionContext,
  rematchId: string,
  choice: Choice
): Promise<void> {
  const token = env.BOT_TOKEN;
  if (!query.inline_message_id) {
    await answerCallbackQuery(token, query.id);
    return;
  }

  const metaKey = `rematch:${rematchId}:meta`;
  const meta = await env.GAME_SESSIONS.get<RematchMeta>(metaKey, 'json');
  if (!meta) {
    await answerCallbackQuery(token, query.id, '❌ Rematch expired. Start a new game.', true);
    return;
  }

  const isHost = query.from.id === meta.hostUserId;
  const isOpponent = query.from.id === meta.opponentUserId;
  if (!isHost && !isOpponent) {
    await answerCallbackQuery(token, query.id, '❌ This is not your game!', true);
    return;
  }

  const myKey = isHost ? `rematch:${rematchId}:host` : `rematch:${rematchId}:opp`;
  const theirKey = isHost ? `rematch:${rematchId}:opp` : `rematch:${rematchId}:host`;

  const existing = await env.GAME_SESSIONS.get(myKey);
  if (existing) {
    await answerCallbackQuery(token, query.id, '✅ Already locked in! Waiting for opponent.', true);
    return;
  }

  // Store only the choice — inline message IDs come from the pre-populated meta
  await env.GAME_SESSIONS.put(myKey, JSON.stringify({ choice }), { expirationTtl: 300 });
  await answerCallbackQuery(token, query.id, '🔒 Choice locked!');

  const theirRaw = await env.GAME_SESSIONS.get(theirKey);
  if (!theirRaw) {
    await editInlineMessage(token, query.inline_message_id, '✅ Locked in! Waiting for opponent...');
    return;
  }

  const theirData: { choice: Choice } = JSON.parse(theirRaw);
  const hostChoice = isHost ? choice : theirData.choice;
  const oppChoice = isHost ? theirData.choice : choice;

  const newGameId = generateId();
  const session: GameSession = {
    gameId: newGameId,
    hostUserId: meta.hostUserId,
    hostName: meta.hostName,
    hostChoice,
    opponentUserId: meta.opponentUserId,
    opponentName: meta.opponentName,
    opponentChoice: oppChoice,
    hostInlineMessageId: meta.hostInlineMessageId,
    opponentInlineMessageId: meta.opponentInlineMessageId,
    status: 'playing',
    mode: meta.mode,
    currentRound: 1,
    hostScore: 0,
    opponentScore: 0,
    rounds: [],
    createdAt: Date.now(),
  };

  await env.GAME_SESSIONS.put(`game:${newGameId}`, JSON.stringify(session), { expirationTtl: 120 });

  await Promise.all([
    env.GAME_SESSIONS.delete(metaKey),
    env.GAME_SESSIONS.delete(`rematch:${rematchId}:host`),
    env.GAME_SESSIONS.delete(`rematch:${rematchId}:opp`),
  ]);

  ctx.waitUntil(runCountdownAndReveal(token, env.GAME_SESSIONS, session, env));
}

async function handleRefresh(
  query: CallbackQuery,
  env: Env,
  gameId: string
): Promise<void> {
  const token = env.BOT_TOKEN;
  if (!query.inline_message_id) {
    await answerCallbackQuery(token, query.id);
    return;
  }

  const session = await env.GAME_SESSIONS.get<GameSession>(`game:${gameId}`, 'json');
  if (!session) {
    await answerCallbackQuery(token, query.id, '❌ Game not found.', true);
    return;
  }

  if (session.status === 'waiting') {
    await editInlineMessage(
      token,
      query.inline_message_id,
      waitingText(session, env.BOT_USERNAME, Date.now()),
      {
        inline_keyboard: [
          [{ text: '❌ Cancel', callback_data: `cancel:${gameId}` }],
          [{ text: '🔄 Refresh', callback_data: `refresh:${gameId}` }],
        ],
      }
    );
  } else if (session.status === 'playing') {
    const isParticipant =
      query.from.id === session.hostUserId ||
      query.from.id === session.opponentUserId;
    if (isParticipant) {
      await editInlineMessage(
        token,
        query.inline_message_id,
        nextRoundText(session) + '\n\nPick your weapon!',
        pickKeyboard(gameId)
      );
    }
  }

  await answerCallbackQuery(token, query.id, '🔄 Refreshed!');
}
