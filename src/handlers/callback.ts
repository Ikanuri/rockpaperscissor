import type { CallbackQuery, Choice, Env, GameSession, RematchMeta } from '../types';
import { answerCallbackQuery, editInlineMessage } from '../telegram';
import {
  generateId,
  pickKeyboard,
  rematchPickKeyboard,
  nextRoundText,
  runCountdownAndReveal,
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

  // Decrement rate limit counter
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

  const prevSession = await env.GAME_SESSIONS.get<GameSession>(`game:${prevGameId}`, 'json');
  if (!prevSession || prevSession.status !== 'done') {
    await answerCallbackQuery(token, query.id, '❌ Game not found.', true);
    return;
  }

  const isHost = query.from.id === prevSession.hostUserId;
  const isOpponent = query.from.id === prevSession.opponentUserId;
  if (!isHost && !isOpponent) {
    await answerCallbackQuery(token, query.id, '❌ This is not your game!', true);
    return;
  }

  const rematchId = `R${prevGameId}`;

  const metaKey = `rematch:${rematchId}:meta`;
  let meta = await env.GAME_SESSIONS.get<RematchMeta>(metaKey, 'json');
  if (!meta) {
    meta = {
      hostUserId: prevSession.hostUserId,
      hostName: prevSession.hostName,
      opponentUserId: prevSession.opponentUserId!,
      opponentName: prevSession.opponentName!,
      mode: prevSession.mode,
    };
    await env.GAME_SESSIONS.put(metaKey, JSON.stringify(meta), { expirationTtl: 300 });
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

  const myData = JSON.stringify({ choice, inlineMessageId: query.inline_message_id });
  await env.GAME_SESSIONS.put(myKey, myData, { expirationTtl: 300 });
  await answerCallbackQuery(token, query.id, '🔒 Choice locked!');

  const theirRaw = await env.GAME_SESSIONS.get(theirKey);
  if (!theirRaw) {
    await editInlineMessage(token, query.inline_message_id, '✅ Locked in! Waiting for opponent...');
    return;
  }

  const theirData: { choice: Choice; inlineMessageId: string } = JSON.parse(theirRaw);

  const newGameId = generateId();
  const hostData = isHost
    ? { choice, inlineMessageId: query.inline_message_id }
    : theirData;
  const oppData = isHost
    ? theirData
    : { choice, inlineMessageId: query.inline_message_id };

  const session: GameSession = {
    gameId: newGameId,
    hostUserId: meta.hostUserId,
    hostName: meta.hostName,
    hostChoice: hostData.choice,
    opponentUserId: meta.opponentUserId,
    opponentName: meta.opponentName,
    opponentChoice: oppData.choice,
    hostInlineMessageId: hostData.inlineMessageId,
    opponentInlineMessageId: oppData.inlineMessageId,
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
