import type { CallbackQuery, Choice, Env, GameSession, LmsSession, TeamSession, TournamentSession } from '../types';
import { answerCallbackQuery, editInlineMessage, editMessage, getChatMember } from '../telegram';
import {
  EMOJI,
  escHtml,
  lmsPickKeyboard,
  nextRoundText,
  pickKeyboard,
  runLmsRound,
  runRevealAndResult,
  runTeamRound,
  startTournamentBracket,
  teamPickKeyboard,
  tournamentSignupKeyboard,
  tournamentSignupText,
  waitingKeyboard,
  waitingText,
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
  } else if (action === 'tpick' && parts.length === 3) {
    await handleTeamPick(query, env, ctx, parts[1], parts[2] as Choice);
  } else if (action === 'tcancel' && parts.length === 2) {
    await handleTeamCancel(query, env, parts[1]);
  } else if (action === 'tourjoin' && parts.length === 2) {
    await handleTourJoin(query, env, parts[1]);
  } else if (action === 'tourstart' && parts.length === 2) {
    await handleTourStart(query, env, ctx, parts[1]);
  } else if (action === 'cancel' && parts.length === 2) {
    await handleCancel(query, env, parts[1]);
  } else if (action === 'refresh' && parts.length === 2) {
    await handleRefresh(query, env, parts[1]);
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

async function handleTeamPick(
  query: CallbackQuery,
  env: Env,
  ctx: ExecutionContext,
  gameId: string,
  choice: Choice
): Promise<void> {
  const token = env.BOT_TOKEN;
  const kv = env.GAME_SESSIONS;
  const session = await kv.get<TeamSession>(`team:${gameId}`, 'json');

  if (!session || session.status !== 'playing') {
    await answerCallbackQuery(token, query.id, '❌ Game tidak aktif.', true);
    return;
  }

  const allPlayers = [...session.teamA, ...session.teamB];
  const player = allPlayers.find(p => p.userId === query.from.id);
  if (!player) {
    await answerCallbackQuery(token, query.id, '❌ Bukan game kamu!', true);
    return;
  }
  if (player.choice !== null) {
    await answerCallbackQuery(token, query.id, '✅ Sudah pilih! Tunggu yang lain.', true);
    return;
  }

  const updatedA = session.teamA.map(p => p.userId === query.from.id ? { ...p, choice } : p);
  const updatedB = session.teamB.map(p => p.userId === query.from.id ? { ...p, choice } : p);
  const updated: TeamSession = { ...session, teamA: updatedA, teamB: updatedB };
  const allPicked = [...updatedA, ...updatedB].every(p => p.choice !== null);

  await kv.put(`team:${gameId}`, JSON.stringify(updated), { expirationTtl: 300 });
  await answerCallbackQuery(token, query.id, `🔒 ${EMOJI[choice]} dikunci!`);

  if (allPicked) {
    ctx.waitUntil(runTeamRound(token, kv, updated, env, ctx));
  } else {
    const picked = [...updatedA, ...updatedB].filter(p => p.choice !== null).length;
    const total = updatedA.length + updatedB.length;
    const statusLine = (team: typeof updatedA, label: string) =>
      `${label}: ${team.map(p => `${escHtml(p.name)} ${p.choice ? '🔒' : '❓'}`).join(', ')}`;
    const waitText =
      `⚔️ <b>Round ${session.currentRound}</b>\n` +
      `${statusLine(updatedA, '🔵 Tim A')}\n${statusLine(updatedB, '🔴 Tim B')}\n\n` +
      `⏳ ${picked}/${total} sudah pilih...`;
    const pickKb = teamPickKeyboard(gameId);
    await Promise.allSettled([...updatedA, ...updatedB].map(p =>
      editInlineMessage(token, p.inlineMessageId, waitText, pickKb)
    ));
  }
}

async function handleTeamCancel(
  query: CallbackQuery,
  env: Env,
  gameId: string
): Promise<void> {
  const token = env.BOT_TOKEN;
  const kv = env.GAME_SESSIONS;
  const session = await kv.get<TeamSession>(`team:${gameId}`, 'json');

  if (!session || session.status !== 'waiting') {
    await answerCallbackQuery(token, query.id, '❌ Game tidak ditemukan.', true);
    return;
  }
  if (query.from.id !== session.hostUserId) {
    await answerCallbackQuery(token, query.id, '❌ Hanya host yang bisa batal.', true);
    return;
  }
  await kv.delete(`team:${gameId}`);
  const allPlayers = [...session.teamA, ...session.teamB];
  await Promise.allSettled(allPlayers.map(p => editInlineMessage(token, p.inlineMessageId, '❌ Team game dibatalkan.')));
  await answerCallbackQuery(token, query.id);
}

async function handleTourJoin(
  query: CallbackQuery,
  env: Env,
  tournamentId: string
): Promise<void> {
  const token = env.BOT_TOKEN;
  const kv = env.GAME_SESSIONS;
  const tournament = await kv.get<TournamentSession>(`tournament:${tournamentId}`, 'json');

  if (!tournament || tournament.status !== 'joining') {
    await answerCallbackQuery(token, query.id, '❌ Tournament tidak aktif.', true);
    return;
  }
  if (tournament.players.some(p => p.userId === query.from.id)) {
    await answerCallbackQuery(token, query.id, '✅ Sudah terdaftar!', true);
    return;
  }
  if (tournament.players.length >= tournament.maxPlayers) {
    await answerCallbackQuery(token, query.id, '❌ Tournament sudah penuh.', true);
    return;
  }

  const memberCheck = await getChatMember(token, tournament.chatId, query.from.id);
  if (!memberCheck || ['left', 'kicked'].includes(memberCheck.status)) {
    await answerCallbackQuery(token, query.id, '❌ Kamu tidak ada di grup tournament.', true);
    return;
  }

  const updated: TournamentSession = {
    ...tournament,
    players: [...tournament.players, { userId: query.from.id, name: query.from.first_name }],
  };
  await kv.put(`tournament:${tournamentId}`, JSON.stringify(updated), { expirationTtl: 3600 });
  await answerCallbackQuery(token, query.id, `✅ Berhasil daftar!`);

  const chatId = query.message?.chat.id;
  const msgId = tournament.signupMessageId;
  if (chatId && msgId) {
    const kb = updated.players.length >= updated.maxPlayers ? undefined : tournamentSignupKeyboard(tournamentId);
    await editMessage(token, chatId, msgId, tournamentSignupText(updated), kb);
  }

  // Auto-start when full
  if (updated.players.length >= updated.maxPlayers) {
    const botUsername = env.BOT_USERNAME;
    await startTournamentBracket(token, kv, updated, botUsername);
  }
}

async function handleTourStart(
  query: CallbackQuery,
  env: Env,
  ctx: ExecutionContext,
  tournamentId: string
): Promise<void> {
  const token = env.BOT_TOKEN;
  const kv = env.GAME_SESSIONS;
  const tournament = await kv.get<TournamentSession>(`tournament:${tournamentId}`, 'json');

  if (!tournament || tournament.status !== 'joining') {
    await answerCallbackQuery(token, query.id, '❌ Tournament tidak aktif.', true);
    return;
  }
  if (query.from.id !== tournament.hostUserId) {
    await answerCallbackQuery(token, query.id, '❌ Hanya host yang bisa memulai.', true);
    return;
  }
  if (tournament.players.length < 2) {
    await answerCallbackQuery(token, query.id, '❌ Minimal 2 pemain untuk mulai.', true);
    return;
  }
  // If odd number, pad to even by duplicating last player (bye)
  const players = tournament.players.length % 2 !== 0
    ? [...tournament.players, { ...tournament.players[tournament.players.length - 1], name: `${tournament.players[tournament.players.length - 1].name} (bye)` }]
    : tournament.players;
  const paddedTournament: TournamentSession = { ...tournament, players };
  await answerCallbackQuery(token, query.id, '🚀 Bracket dimulai!');
  ctx.waitUntil(startTournamentBracket(token, kv, paddedTournament, env.BOT_USERNAME));
}

async function handleRefresh(
  query: CallbackQuery,
  env: Env,
  gameId: string
): Promise<void> {
  const token = env.BOT_TOKEN;
  const session = await env.GAME_SESSIONS.get<GameSession>(`game:${gameId}`, 'json');
  if (!session || session.status !== 'waiting') {
    await answerCallbackQuery(token, query.id, '❌ Game tidak aktif.', true);
    return;
  }
  const joinQuery = session.chainId ?? undefined;
  const showRefresh = hasFeature(env, 'refresh_button');
  await Promise.all([
    editInlineMessage(token, query.inline_message_id!, waitingText(session, env.BOT_USERNAME), waitingKeyboard(session.gameId, joinQuery, showRefresh)),
    answerCallbackQuery(token, query.id, '🔄 Refreshed!'),
  ]);
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
