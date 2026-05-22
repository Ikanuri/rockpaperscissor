import type { CallbackQuery, Choice, Env, GameSession, LmsSession } from '../types';
import { answerCallbackQuery, editInlineMessage } from '../telegram';
import {
  EMOJI,
  escHtml,
  lmsPickKeyboard,
  nextRoundText,
  pickKeyboard,
  runLmsRound,
  runRevealAndResult,
} from '../game';
import { hasFeature } from '../feature';
import { handleDonateCallback } from './payment';

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
  } else if (action === 'lmspick' && parts.length === 3) {
    await handleLmsPick(query, env, ctx, parts[1], parts[2] as Choice);
  } else if (action === 'cancel' && parts.length === 2) {
    await handleCancel(query, env, parts[1]);
  } else if (action === 'donate' && hasFeature(env, 'donator')) {
    await handleDonateCallback(query, env);
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
    ctx.waitUntil(runRevealAndResult(token, env.GAME_SESSIONS, updated, env, ctx));
  } else {
    const waitMsg = nextRoundText(updated) + '\n\n✅ One player is ready...';
    const keyboard = pickKeyboard(gameId);
    await Promise.all([
      editInlineMessage(token, session.hostInlineMessageId, waitMsg, keyboard),
      editInlineMessage(token, session.opponentInlineMessageId!, waitMsg, keyboard),
    ]);
  }
}

async function handleLmsPick(
  query: CallbackQuery,
  env: Env,
  ctx: ExecutionContext,
  gameId: string,
  choice: Choice
): Promise<void> {
  const token = env.BOT_TOKEN;
  const kv = env.GAME_SESSIONS;
  const session = await kv.get<LmsSession>(`lms:${gameId}`, 'json');

  if (!session || session.status === 'done') {
    await answerCallbackQuery(token, query.id, '❌ Game sudah selesai.', true);
    return;
  }

  const player = session.players.find(p => p.userId === query.from.id);
  if (!player || !player.active) {
    await answerCallbackQuery(token, query.id, '❌ Kamu sudah eliminasi.', true);
    return;
  }
  if (player.choice !== null) {
    await answerCallbackQuery(token, query.id, '✅ Sudah pilih! Tunggu yang lain.', true);
    return;
  }

  const updatedPlayers = session.players.map(p =>
    p.userId === query.from.id ? { ...p, choice } : p
  );
  const updatedSession: LmsSession = { ...session, players: updatedPlayers };
  const activePlayers = updatedPlayers.filter(p => p.active);
  const allPicked = activePlayers.every(p => p.choice !== null);

  await kv.put(`lms:${gameId}`, JSON.stringify(updatedSession), { expirationTtl: 300 });
  await answerCallbackQuery(token, query.id, `🔒 ${EMOJI[choice]} dikunci!`);

  if (allPicked) {
    ctx.waitUntil(runLmsRound(token, kv, updatedSession, ctx));
  } else {
    const waitCount = activePlayers.filter(p => p.choice === null).length;
    const pickText = `⚔️ <b>Round ${session.currentRound}</b>\n` +
      activePlayers.map(p => {
        const up = updatedPlayers.find(u => u.userId === p.userId)!;
        return `• ${escHtml(up.name)}: ${up.choice ? '🔒' : '❓'}`;
      }).join('\n') +
      `\n\nMenunggu ${waitCount} pemain lagi...`;
    const pickKb = lmsPickKeyboard(gameId);
    await Promise.allSettled(
      activePlayers.map(p =>
        editInlineMessage(token, p.inlineMessageId, pickText, pickKb)
      )
    );
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
