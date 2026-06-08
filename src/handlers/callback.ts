import type { CallbackQuery, Choice, Env, GameSession, LmsSession, TeamDiceWaitState, TeamSession, TournamentSession } from '../types';
import { answerCallbackQuery, editInlineMessage, editMessage, getChatMember } from '../telegram';
import {
  EMOJI,
  botResolveTie,
  escHtml,
  getLang,
  lmsHostKeyboard,
  lmsJoinKeyboard,
  lmsPickKeyboard,
  lmsWaitPickedKeyboard,
  lmsWaitingText,
  nextRoundText,
  pickKeyboard,
  resolveTeamDiceWait,
  runLmsRound,
  runRevealAndResult,
  runTeamRound,
  startTournamentBracket,
  teamMemberWaitingKeyboard,
  teamPickKeyboard,
  teamWaitingKeyboard,
  teamWaitingText,
  tournamentSignupKeyboard,
  tournamentSignupText,
} from '../game';
import { hasFeature } from '../feature';
import { handleDonateCallback } from './payment';
import { guideContent, guideMainMenu } from './message';

export async function handleCallbackQuery(
  query: CallbackQuery,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  if (!query.data) return;

  const parts = query.data.split(':');
  const action = parts[0];

  const VALID_CHOICES = ['rock', 'paper', 'scissors'];

  if (action === 'pick' && parts.length === 3) {
    if (!VALID_CHOICES.includes(parts[2])) { await answerCallbackQuery(env.BOT_TOKEN, query.id); return; }
    await handlePick(query, env, ctx, parts[1], parts[2] as Choice);
  } else if (action === 'lmspick' && parts.length === 3) {
    if (!VALID_CHOICES.includes(parts[2])) { await answerCallbackQuery(env.BOT_TOKEN, query.id); return; }
    await handleLmsPick(query, env, ctx, parts[1], parts[2] as Choice);
  } else if (action === 'tpick' && parts.length === 3) {
    if (!VALID_CHOICES.includes(parts[2])) { await answerCallbackQuery(env.BOT_TOKEN, query.id); return; }
    await handleTeamPick(query, env, ctx, parts[1], parts[2] as Choice);
  } else if (action === 'tcancel' && parts.length === 2) {
    await handleTeamCancel(query, env, parts[1]);
  } else if (action === 'extlms' && parts.length === 2) {
    await handleExtendLms(query, env, parts[1]);
  } else if (action === 'lmsforce' && parts.length === 2) {
    await handleLmsForce(query, env, ctx, parts[1]);
  } else if (action === 'lmssmite' && (parts.length === 2 || parts.length === 3)) {
    await handleLmsSmite(query, env, ctx, parts[1], parts.length === 3 ? Number(parts[2]) : undefined);
  } else if (action === 'lmssmitecancel' && parts.length === 2) {
    await handleLmsSmiteCancel(query, env, parts[1]);
  } else if (action === 'lmsflee' && parts.length === 2) {
    await handleLmsFlee(query, env, ctx, parts[1]);
  } else if (action === 'teamsmite' && (parts.length === 2 || parts.length === 3)) {
    await handleTeamSmite(query, env, ctx, parts[1], parts.length === 3 ? Number(parts[2]) : undefined);
  } else if (action === 'teamsmitecancel' && parts.length === 2) {
    await handleTeamSmiteCancel(query, env, parts[1]);
  } else if (action === 'teamflee' && parts.length === 2) {
    await handleTeamFlee(query, env, ctx, parts[1]);
  } else if (action === 'teamforce' && parts.length === 2) {
    await handleTeamForce(query, env, ctx, parts[1]);
  } else if (action === 'extteam' && parts.length === 2) {
    await handleExtendTeam(query, env, parts[1]);
  } else if (action === 'teamdice' && parts[1] === 'resolve' && parts.length === 3) {
    await handleTeamDiceResolve(query, env, ctx, parts[2]);
  } else if (action === 'tourjoin' && parts.length === 2) {
    await handleTourJoin(query, env, parts[1]);
  } else if (action === 'tourstart' && parts.length === 2) {
    await handleTourStart(query, env, ctx, parts[1]);
  } else if (action === 'cancel' && parts.length === 2) {
    await handleCancel(query, env, parts[1]);
  } else if (action === 'guide') {
    await handleGuide(query, env);
  } else if (action === 'setlang' && parts.length === 2) {
    await handleSetLang(query, env, parts[1]);
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
    ctx.waitUntil(runLmsRound(token, kv, updatedSession, ctx, env));
  } else {
    const waitCount = activePlayers.filter(p => p.choice === null).length;
    const pickText = `⚔️ <b>Round ${session.currentRound}</b>\n` +
      activePlayers.map(p => {
        const up = updatedPlayers.find(u => u.userId === p.userId)!;
        return `• ${escHtml(up.name)}: ${up.choice ? '🔒' : '❓'}`;
      }).join('\n') +
      `\n\nMenunggu ${waitCount} pemain lagi...`;
    await Promise.allSettled(
      activePlayers.map(p =>
        editInlineMessage(token, p.inlineMessageId, pickText, lmsPickKeyboard(gameId, p.userId === session.hostUserId))
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
    await Promise.allSettled([...updatedA, ...updatedB].map(p =>
      editInlineMessage(token, p.inlineMessageId, waitText, teamPickKeyboard(gameId, p.userId === session.hostUserId))
    ));
  }
}

async function handleLmsSmite(
  query: CallbackQuery,
  env: Env,
  ctx: ExecutionContext,
  gameId: string,
  targetUserId?: number
): Promise<void> {
  const token = env.BOT_TOKEN;
  const kv = env.GAME_SESSIONS;
  const session = await kv.get<LmsSession>(`lms:${gameId}`, 'json');
  if (!session || session.status === 'done') {
    await answerCallbackQuery(token, query.id, '❌ Game tidak aktif.', true);
    return;
  }
  if (query.from.id !== session.hostUserId) {
    await answerCallbackQuery(token, query.id, '❌ Hanya host yang bisa smite.', true);
    return;
  }

  if (!targetUserId) {
    const targets = session.status === 'waiting'
      ? session.players.filter(p => p.userId !== session.hostUserId)
      : session.players.filter(p => p.active && p.userId !== session.hostUserId);
    if (targets.length === 0) {
      await answerCallbackQuery(token, query.id, '⚠️ Tidak ada pemain yang bisa disingkirkan.', true);
      return;
    }
    const rows = targets.map(p => [{ text: `⚡ ${p.name}`, callback_data: `lmssmite:${gameId}:${p.userId}` }]);
    rows.push([{ text: '❌ Batal', callback_data: `lmssmitecancel:${gameId}` }]);
    await editInlineMessage(token, query.inline_message_id!, '⚡ <b>Pilih pemain yang mau disingkirkan:</b>', { inline_keyboard: rows });
    await answerCallbackQuery(token, query.id);
    return;
  }

  const target = session.players.find(p => p.userId === targetUserId);
  if (!target) {
    await answerCallbackQuery(token, query.id, '❌ Pemain tidak ditemukan.', true);
    return;
  }

  if (session.status === 'waiting') {
    const updatedPlayers = session.players.filter(p => p.userId !== targetUserId);
    const updated: LmsSession = { ...session, players: updatedPlayers };
    await kv.put(`lms:${gameId}`, JSON.stringify(updated), { expirationTtl: 600 });
    await answerCallbackQuery(token, query.id, `⚡ ${target.name} dikeluarkan!`);
    await editInlineMessage(token, target.inlineMessageId, '⚡ Kamu dikeluarkan dari lobby oleh host.');
    const canForce = updatedPlayers.length >= 2;
    const hasOthers = updatedPlayers.some(p => p.userId !== session.hostUserId);
    await editInlineMessage(token, query.inline_message_id!, lmsWaitingText(updated), lmsHostKeyboard(gameId, canForce, hasOthers));
    await Promise.allSettled(
      updatedPlayers.filter(p => p.userId !== session.hostUserId).map(p =>
        editInlineMessage(token, p.inlineMessageId, lmsWaitingText(updated), lmsJoinKeyboard(gameId))
      )
    );
  } else {
    if (!target.active) {
      await answerCallbackQuery(token, query.id, '❌ Pemain sudah eliminasi.', true);
      return;
    }
    const updatedPlayers = session.players.map(p =>
      p.userId === targetUserId ? { ...p, active: false } : p
    );
    const updated: LmsSession = { ...session, players: updatedPlayers };
    await kv.put(`lms:${gameId}`, JSON.stringify(updated), { expirationTtl: 300 });
    await answerCallbackQuery(token, query.id, `⚡ ${target.name} dieliminasi!`);
    await editInlineMessage(token, target.inlineMessageId, '⚡ Kamu dieliminasi oleh host.');

    const current = await kv.get<LmsSession>(`lms:${gameId}`, 'json');
    if (!current || current.status === 'done') return;
    const activePlayers = current.players.filter(p => p.active);

    if (activePlayers.length <= 1 || activePlayers.every(p => p.choice !== null)) {
      ctx.waitUntil(runLmsRound(token, kv, current, ctx, env));
    } else {
      const waitCount = activePlayers.filter(p => p.choice === null).length;
      const pickText = `⚔️ <b>Round ${session.currentRound}</b>\n` +
        activePlayers.map(p => `• ${escHtml(p.name)}: ${p.choice ? '🔒' : '❓'}`).join('\n') +
        `\n\n⚡ ${escHtml(target.name)} dieliminasi.\nMenunggu ${waitCount} pemain lagi...`;
      await editInlineMessage(token, query.inline_message_id!, pickText, lmsWaitPickedKeyboard(gameId, true));
    }
  }
}

async function handleLmsSmiteCancel(
  query: CallbackQuery,
  env: Env,
  gameId: string
): Promise<void> {
  const token = env.BOT_TOKEN;
  const kv = env.GAME_SESSIONS;
  const session = await kv.get<LmsSession>(`lms:${gameId}`, 'json');
  if (!session || query.from.id !== session.hostUserId) {
    await answerCallbackQuery(token, query.id);
    return;
  }
  if (session.status === 'waiting') {
    const canForce = session.players.length >= 2;
    const hasOthers = session.players.some(p => p.userId !== session.hostUserId);
    await editInlineMessage(token, query.inline_message_id!, lmsWaitingText(session), lmsHostKeyboard(gameId, canForce, hasOthers));
  } else {
    const activePlayers = session.players.filter(p => p.active);
    const waitCount = activePlayers.filter(p => p.choice === null).length;
    const pickText = `⚔️ <b>Round ${session.currentRound}</b>\n` +
      activePlayers.map(p => `• ${escHtml(p.name)}: ${p.choice ? '🔒' : '❓'}`).join('\n') +
      `\n\nMenunggu ${waitCount} pemain lagi...`;
    await editInlineMessage(token, query.inline_message_id!, pickText, lmsWaitPickedKeyboard(gameId, true));
  }
  await answerCallbackQuery(token, query.id);
}

async function handleLmsFlee(
  query: CallbackQuery,
  env: Env,
  ctx: ExecutionContext,
  gameId: string
): Promise<void> {
  const token = env.BOT_TOKEN;
  const kv = env.GAME_SESSIONS;
  const session = await kv.get<LmsSession>(`lms:${gameId}`, 'json');
  if (!session || session.status === 'done') {
    await answerCallbackQuery(token, query.id, '❌ Game sudah selesai.', true);
    return;
  }
  const player = session.players.find(p => p.userId === query.from.id);
  if (!player) {
    await answerCallbackQuery(token, query.id, '❌ Kamu bukan peserta game ini.', true);
    return;
  }

  if (session.status === 'waiting') {
    if (query.from.id === session.hostUserId) {
      await kv.delete(`lms:${gameId}`);
      await Promise.allSettled(session.players.map(p => editInlineMessage(token, p.inlineMessageId, '🏳️ Host membatalkan game.')));
      await answerCallbackQuery(token, query.id, '🏳️ Game dibatalkan.');
    } else {
      const updatedPlayers = session.players.filter(p => p.userId !== query.from.id);
      const updated: LmsSession = { ...session, players: updatedPlayers };
      await kv.put(`lms:${gameId}`, JSON.stringify(updated), { expirationTtl: 600 });
      await answerCallbackQuery(token, query.id, '🏳️ Kamu keluar dari lobby.');
      await editInlineMessage(token, player.inlineMessageId, '🏳️ Kamu meninggalkan lobby.');
      const canForce = updatedPlayers.length >= 2;
      const hasOthers = updatedPlayers.some(p => p.userId !== session.hostUserId);
      await Promise.allSettled(
        updatedPlayers.map(p =>
          editInlineMessage(token, p.inlineMessageId, lmsWaitingText(updated),
            p.userId === session.hostUserId ? lmsHostKeyboard(gameId, canForce, hasOthers) : lmsJoinKeyboard(gameId))
        )
      );
    }
    return;
  }

  if (!player.active) {
    await answerCallbackQuery(token, query.id, '❌ Kamu sudah eliminasi.', true);
    return;
  }
  const updatedPlayers = session.players.map(p =>
    p.userId === query.from.id ? { ...p, active: false } : p
  );
  const updated: LmsSession = { ...session, players: updatedPlayers };
  await kv.put(`lms:${gameId}`, JSON.stringify(updated), { expirationTtl: 300 });
  await answerCallbackQuery(token, query.id, '🏳️ Kamu meninggalkan game.');
  await editInlineMessage(token, player.inlineMessageId, '🏳️ Kamu meninggalkan game.');

  // Re-read from KV after save to get the most current state (handles concurrent flees)
  const current = await kv.get<LmsSession>(`lms:${gameId}`, 'json');
  if (!current || current.status === 'done') return;
  const activePlayers = current.players.filter(p => p.active);

  if (activePlayers.length <= 1 || activePlayers.every(p => p.choice !== null)) {
    ctx.waitUntil(runLmsRound(token, kv, current, ctx, env));
  } else {
    const waitCount = activePlayers.filter(p => p.choice === null).length;
    const fleeText = `⚔️ <b>Round ${session.currentRound}</b>\n` +
      activePlayers.map(p => `• ${escHtml(p.name)}: ${p.choice ? '🔒' : '❓'}`).join('\n') +
      `\n\n🏳️ ${escHtml(player.name)} meninggalkan game.\nMenunggu ${waitCount} pemain lagi...`;
    await Promise.allSettled(
      activePlayers.filter(p => p.choice !== null).map(p =>
        editInlineMessage(token, p.inlineMessageId, fleeText, lmsWaitPickedKeyboard(gameId, p.userId === session.hostUserId))
      )
    );
  }
}

async function handleTeamSmite(
  query: CallbackQuery,
  env: Env,
  ctx: ExecutionContext,
  gameId: string,
  targetUserId?: number
): Promise<void> {
  const token = env.BOT_TOKEN;
  const kv = env.GAME_SESSIONS;
  const session = await kv.get<TeamSession>(`team:${gameId}`, 'json');
  if (!session || session.status === 'done') {
    await answerCallbackQuery(token, query.id, '❌ Game tidak aktif.', true);
    return;
  }
  if (query.from.id !== session.hostUserId) {
    await answerCallbackQuery(token, query.id, '❌ Hanya host yang bisa smite.', true);
    return;
  }

  if (!targetUserId) {
    const allNonHost = [...session.teamA, ...session.teamB].filter(p => p.userId !== session.hostUserId);
    if (allNonHost.length === 0) {
      await answerCallbackQuery(token, query.id, '⚠️ Tidak ada pemain yang bisa disingkirkan.', true);
      return;
    }
    const rows = [
      ...session.teamA.filter(p => p.userId !== session.hostUserId).map(p => [{ text: `⚡ ${p.name} (🔵 Tim A)`, callback_data: `teamsmite:${gameId}:${p.userId}` }]),
      ...session.teamB.filter(p => p.userId !== session.hostUserId).map(p => [{ text: `⚡ ${p.name} (🔴 Tim B)`, callback_data: `teamsmite:${gameId}:${p.userId}` }]),
      [{ text: '❌ Batal', callback_data: `teamsmitecancel:${gameId}` }],
    ];
    await editInlineMessage(token, query.inline_message_id!, '⚡ <b>Pilih pemain yang mau disingkirkan:</b>', { inline_keyboard: rows });
    await answerCallbackQuery(token, query.id);
    return;
  }

  const inA = session.teamA.find(p => p.userId === targetUserId);
  const inB = session.teamB.find(p => p.userId === targetUserId);
  const target = inA ?? inB;
  if (!target) {
    await answerCallbackQuery(token, query.id, '❌ Pemain tidak ditemukan.', true);
    return;
  }

  const updatedA = session.teamA.filter(p => p.userId !== targetUserId);
  const updatedB = session.teamB.filter(p => p.userId !== targetUserId);
  await answerCallbackQuery(token, query.id, `⚡ ${target.name} disingkirkan!`);
  await editInlineMessage(token, target.inlineMessageId, '⚡ Kamu disingkirkan dari game oleh host.');

  if (session.status === 'waiting') {
    const updated: TeamSession = { ...session, teamA: updatedA, teamB: updatedB };
    await kv.put(`team:${gameId}`, JSON.stringify(updated), { expirationTtl: 600 });
    const slotsA = session.teamSize - updatedA.length;
    const slotsB = session.teamSize - updatedB.length;
    const allRemaining = [...updatedA, ...updatedB];
    const hasOthers = allRemaining.some(p => p.userId !== session.hostUserId);
    const canForce = updatedA.length === updatedB.length && updatedA.length >= 1;
    const waitText = teamWaitingText(updated);
    await Promise.allSettled(allRemaining.map(p =>
      editInlineMessage(token, p.inlineMessageId, waitText,
        p.userId === session.hostUserId ? teamWaitingKeyboard(gameId, slotsA, slotsB, hasOthers, canForce) : teamMemberWaitingKeyboard(gameId))
    ));
  } else {
    if (updatedA.length === 0 || updatedB.length === 0) {
      const winnerTeam = updatedA.length > 0 ? 'A' : 'B';
      const finalText = `🏳️ <b>Tim ${winnerTeam === 'A' ? 'B' : 'A'} meninggalkan game. Tim ${winnerTeam} menang!</b>`;
      const allRemaining = [...updatedA, ...updatedB];
      const updated: TeamSession = { ...session, teamA: updatedA, teamB: updatedB, status: 'done' };
      await kv.put(`team:${gameId}`, JSON.stringify(updated), { expirationTtl: 300 });
      await Promise.allSettled(allRemaining.map(p => editInlineMessage(token, p.inlineMessageId, finalText)));
      return;
    }
    const updated: TeamSession = { ...session, teamA: updatedA, teamB: updatedB };
    const allRemaining = [...updatedA, ...updatedB];
    const allPicked = allRemaining.every(p => p.choice !== null);
    await kv.put(`team:${gameId}`, JSON.stringify(updated), { expirationTtl: 300 });
    if (allPicked) {
      ctx.waitUntil(runTeamRound(token, kv, updated, env, ctx));
    } else {
      const picked = allRemaining.filter(p => p.choice !== null).length;
      const statusLine = (team: typeof updatedA, label: string) =>
        `${label}: ${team.map(p => `${escHtml(p.name)} ${p.choice ? '🔒' : '❓'}`).join(', ')}`;
      const waitText =
        `⚔️ <b>Round ${session.currentRound}</b>\n` +
        `${statusLine(updatedA, '🔵 Tim A')}\n${statusLine(updatedB, '🔴 Tim B')}\n\n` +
        `⚡ ${escHtml(target.name)} disingkirkan.\n⏳ ${picked}/${allRemaining.length} sudah pilih...`;
      await editInlineMessage(token, query.inline_message_id!, waitText, teamPickKeyboard(gameId, true));
    }
  }
}

async function handleTeamSmiteCancel(
  query: CallbackQuery,
  env: Env,
  gameId: string
): Promise<void> {
  const token = env.BOT_TOKEN;
  const kv = env.GAME_SESSIONS;
  const session = await kv.get<TeamSession>(`team:${gameId}`, 'json');
  if (!session || query.from.id !== session.hostUserId) {
    await answerCallbackQuery(token, query.id);
    return;
  }
  if (session.status === 'waiting') {
    const slotsA = session.teamSize - session.teamA.length;
    const slotsB = session.teamSize - session.teamB.length;
    const allPlayers = [...session.teamA, ...session.teamB];
    const hasOthers = allPlayers.some(p => p.userId !== session.hostUserId);
    const canForceSmite = session.teamA.length === session.teamB.length && session.teamA.length >= 1;
    await editInlineMessage(token, query.inline_message_id!, teamWaitingText(session), teamWaitingKeyboard(gameId, slotsA, slotsB, hasOthers, canForceSmite));
  } else {
    const allPlayers = [...session.teamA, ...session.teamB];
    const picked = allPlayers.filter(p => p.choice !== null).length;
    const statusLine = (team: typeof session.teamA, label: string) =>
      `${label}: ${team.map(p => `${escHtml(p.name)} ${p.choice ? '🔒' : '❓'}`).join(', ')}`;
    const waitText =
      `⚔️ <b>Round ${session.currentRound}</b>\n` +
      `${statusLine(session.teamA, '🔵 Tim A')}\n${statusLine(session.teamB, '🔴 Tim B')}\n\n` +
      `⏳ ${picked}/${allPlayers.length} sudah pilih...`;
    await editInlineMessage(token, query.inline_message_id!, waitText, teamPickKeyboard(gameId, true));
  }
  await answerCallbackQuery(token, query.id);
}

async function handleTeamFlee(
  query: CallbackQuery,
  env: Env,
  ctx: ExecutionContext,
  gameId: string
): Promise<void> {
  const token = env.BOT_TOKEN;
  const kv = env.GAME_SESSIONS;
  const session = await kv.get<TeamSession>(`team:${gameId}`, 'json');
  if (!session || session.status === 'done') {
    await answerCallbackQuery(token, query.id, '❌ Game sudah selesai.', true);
    return;
  }
  const inA = session.teamA.find(p => p.userId === query.from.id);
  const inB = session.teamB.find(p => p.userId === query.from.id);
  const player = inA ?? inB;
  if (!player) {
    await answerCallbackQuery(token, query.id, '❌ Kamu bukan peserta game ini.', true);
    return;
  }

  const updatedA = session.teamA.filter(p => p.userId !== query.from.id);
  const updatedB = session.teamB.filter(p => p.userId !== query.from.id);
  await answerCallbackQuery(token, query.id, '🏳️ Kamu meninggalkan game.');
  await editInlineMessage(token, player.inlineMessageId, '🏳️ Kamu meninggalkan game.');

  if (session.status === 'waiting') {
    const updated: TeamSession = { ...session, teamA: updatedA, teamB: updatedB };
    await kv.put(`team:${gameId}`, JSON.stringify(updated), { expirationTtl: 600 });
    if (query.from.id === session.hostUserId) {
      await kv.delete(`team:${gameId}`);
      const others = [...updatedA, ...updatedB];
      await Promise.allSettled(others.map(p => editInlineMessage(token, p.inlineMessageId, '🏳️ Host membatalkan team game.')));
      return;
    }
    const slotsA = session.teamSize - updatedA.length;
    const slotsB = session.teamSize - updatedB.length;
    const allRemaining = [...updatedA, ...updatedB];
    const hasOthers = allRemaining.some(p => p.userId !== session.hostUserId);
    const canForceFlee = updatedA.length === updatedB.length && updatedA.length >= 1;
    const waitText = teamWaitingText(updated);
    await Promise.allSettled(allRemaining.map(p =>
      editInlineMessage(token, p.inlineMessageId, waitText,
        p.userId === session.hostUserId ? teamWaitingKeyboard(gameId, slotsA, slotsB, hasOthers, canForceFlee) : teamMemberWaitingKeyboard(gameId))
    ));
    return;
  }

  if (updatedA.length === 0 || updatedB.length === 0) {
    const winnerTeam = updatedA.length > 0 ? 'A' : 'B';
    const finalText = `🏳️ <b>Tim ${winnerTeam === 'A' ? 'B' : 'A'} meninggalkan game. Tim ${winnerTeam} menang!</b>`;
    const allRemaining = [...updatedA, ...updatedB];
    const updated: TeamSession = { ...session, teamA: updatedA, teamB: updatedB, status: 'done' };
    await kv.put(`team:${gameId}`, JSON.stringify(updated), { expirationTtl: 300 });
    await Promise.allSettled(allRemaining.map(p => editInlineMessage(token, p.inlineMessageId, finalText)));
    return;
  }
  const updated: TeamSession = { ...session, teamA: updatedA, teamB: updatedB };
  const allRemaining = [...updatedA, ...updatedB];
  const allPicked = allRemaining.every(p => p.choice !== null);
  await kv.put(`team:${gameId}`, JSON.stringify(updated), { expirationTtl: 300 });
  if (allPicked) {
    ctx.waitUntil(runTeamRound(token, kv, updated, env, ctx));
  } else {
    const picked = allRemaining.filter(p => p.choice !== null).length;
    const statusLine = (team: typeof updatedA, label: string) =>
      `${label}: ${team.map(p => `${escHtml(p.name)} ${p.choice ? '🔒' : '❓'}`).join(', ')}`;
    const fleeText =
      `⚔️ <b>Round ${session.currentRound}</b>\n` +
      `${statusLine(updatedA, '🔵 Tim A')}\n${statusLine(updatedB, '🔴 Tim B')}\n\n` +
      `🏳️ ${escHtml(player.name)} meninggalkan game.\n⏳ ${picked}/${allRemaining.length} sudah pilih...`;
    await Promise.allSettled(
      allRemaining.filter(p => p.choice !== null).map(p =>
        editInlineMessage(token, p.inlineMessageId, fleeText, teamPickKeyboard(gameId, p.userId === session.hostUserId))
      )
    );
  }
}

async function handleExtendLms(
  query: CallbackQuery,
  env: Env,
  gameId: string
): Promise<void> {
  const token = env.BOT_TOKEN;
  const kv = env.GAME_SESSIONS;
  const session = await kv.get<LmsSession>(`lms:${gameId}`, 'json');
  if (!session || session.status !== 'waiting') {
    await answerCallbackQuery(token, query.id, '❌ Game tidak bisa di-extend.', true);
    return;
  }
  if (query.from.id !== session.hostUserId) {
    await answerCallbackQuery(token, query.id, '❌ Hanya host yang bisa extend.', true);
    return;
  }
  const updated: LmsSession = { ...session, createdAt: Date.now() };
  await kv.put(`lms:${gameId}`, JSON.stringify(updated), { expirationTtl: 600 });
  await answerCallbackQuery(token, query.id, '⏰ Waktu diperpanjang 10 menit!');
  const canForceExt = session.players.length >= 2;
  const hasOthersExt = session.players.some(p => p.userId !== session.hostUserId);
  await Promise.allSettled(
    session.players.map(p =>
      editInlineMessage(token, p.inlineMessageId, lmsWaitingText(updated),
        p.userId === updated.hostUserId ? lmsHostKeyboard(gameId, canForceExt, hasOthersExt) : lmsJoinKeyboard(gameId))
    )
  );
}

async function handleLmsForce(
  query: CallbackQuery,
  env: Env,
  ctx: ExecutionContext,
  gameId: string
): Promise<void> {
  const token = env.BOT_TOKEN;
  const kv = env.GAME_SESSIONS;
  const session = await kv.get<LmsSession>(`lms:${gameId}`, 'json');
  if (!session || session.status !== 'waiting') {
    await answerCallbackQuery(token, query.id, '❌ Game sudah dimulai.', true);
    return;
  }
  if (query.from.id !== session.hostUserId) {
    await answerCallbackQuery(token, query.id, '❌ Hanya host yang bisa force start.', true);
    return;
  }
  if (session.players.length < 2) {
    await answerCallbackQuery(token, query.id, '⚠️ Butuh minimal 2 pemain.', true);
    return;
  }
  const forcedSession: LmsSession = { ...session, status: 'playing' };
  await kv.put(`lms:${gameId}`, JSON.stringify(forcedSession), { expirationTtl: 300 });
  const fsRateKey = `ratelimit:${session.hostUserId}`;
  const fsRateCur = parseInt(await kv.get(fsRateKey) ?? '0');
  if (fsRateCur > 0) await kv.put(fsRateKey, String(fsRateCur - 1), { expirationTtl: 600 });
  await answerCallbackQuery(token, query.id, '▶️ Game dimulai!');
  ctx.waitUntil(runLmsRound(token, kv, forcedSession, ctx, env));
}

async function handleTeamForce(
  query: CallbackQuery,
  env: Env,
  ctx: ExecutionContext,
  gameId: string
): Promise<void> {
  const token = env.BOT_TOKEN;
  const kv = env.GAME_SESSIONS;
  const session = await kv.get<TeamSession>(`team:${gameId}`, 'json');
  if (!session || session.status !== 'waiting') {
    await answerCallbackQuery(token, query.id, '❌ Game sudah dimulai.', true);
    return;
  }
  if (query.from.id !== session.hostUserId) {
    await answerCallbackQuery(token, query.id, '❌ Hanya host yang bisa force start.', true);
    return;
  }
  if (session.teamA.length !== session.teamB.length || session.teamA.length < 1) {
    await answerCallbackQuery(token, query.id, '⚠️ Kedua tim harus seimbang dan minimal 1v1.', true);
    return;
  }
  const forcedSession: TeamSession = { ...session, status: 'playing' };
  await kv.put(`team:${gameId}`, JSON.stringify(forcedSession), { expirationTtl: 300 });
  const fsRateKey = `ratelimit:${session.hostUserId}`;
  const fsRateCur = parseInt(await kv.get(fsRateKey) ?? '0');
  if (fsRateCur > 0) await kv.put(fsRateKey, String(fsRateCur - 1), { expirationTtl: 600 });
  await answerCallbackQuery(token, query.id, '▶️ Game dimulai!');
  ctx.waitUntil(runTeamRound(token, kv, forcedSession, env, ctx));
}

async function handleExtendTeam(
  query: CallbackQuery,
  env: Env,
  gameId: string
): Promise<void> {
  const token = env.BOT_TOKEN;
  const kv = env.GAME_SESSIONS;
  const session = await kv.get<TeamSession>(`team:${gameId}`, 'json');
  if (!session || session.status !== 'waiting') {
    await answerCallbackQuery(token, query.id, '❌ Game tidak bisa di-extend.', true);
    return;
  }
  if (query.from.id !== session.hostUserId) {
    await answerCallbackQuery(token, query.id, '❌ Hanya host yang bisa extend.', true);
    return;
  }
  const updated: TeamSession = { ...session, createdAt: Date.now() };
  await kv.put(`team:${gameId}`, JSON.stringify(updated), { expirationTtl: 600 });
  await answerCallbackQuery(token, query.id, '⏰ Waktu diperpanjang 10 menit!');
  const slotsA = session.teamSize - session.teamA.length;
  const slotsB = session.teamSize - session.teamB.length;
  const allExtPlayers = [...session.teamA, ...session.teamB];
  const hasOthersTeamExt = allExtPlayers.some(p => p.userId !== session.hostUserId);
  const canForceExt = session.teamA.length === session.teamB.length && session.teamA.length >= 1;
  const hostKb = teamWaitingKeyboard(gameId, slotsA, slotsB, hasOthersTeamExt, canForceExt);
  const waitText = teamWaitingText(updated);
  await Promise.allSettled(
    allExtPlayers.map(p =>
      editInlineMessage(token, p.inlineMessageId, waitText, p.userId === updated.hostUserId ? hostKb : teamMemberWaitingKeyboard(gameId))
    )
  );
}

async function handleTeamDiceResolve(
  query: CallbackQuery,
  env: Env,
  ctx: ExecutionContext,
  gameId: string
): Promise<void> {
  const token = env.BOT_TOKEN;
  const kv = env.GAME_SESSIONS;
  const chatId = query.message?.chat.id;
  if (!chatId) { await answerCallbackQuery(token, query.id, '❌ Tidak bisa resolve.', true); return; }

  const state = await kv.get<TeamDiceWaitState>(`chat:dice_wait:${chatId}`, 'json');
  if (!state || state.gameId !== gameId) {
    await answerCallbackQuery(token, query.id, '❌ Tidak ada tiebreaker aktif.', true);
    return;
  }
  if (query.from.id !== state.teamSession.hostUserId) {
    await answerCallbackQuery(token, query.id, '❌ Hanya host yang bisa resolve.', true);
    return;
  }

  await answerCallbackQuery(token, query.id, '🎲 Bot resolve...');

  let { resolvedA, resolvedB } = state;
  if (state.tieA && !resolvedA) resolvedA = await botResolveTie(state.tieA, chatId, token);
  if (state.tieB && !resolvedB) resolvedB = await botResolveTie(state.tieB, chatId, token);

  ctx.waitUntil(resolveTeamDiceWait(token, kv, { ...state, resolvedA, resolvedB }, env, ctx));
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


async function handleGuide(query: CallbackQuery, env: Env): Promise<void> {
  const token = env.BOT_TOKEN;
  const kv = env.GAME_SESSIONS;
  const chatId = query.message?.chat.id;
  const msgId = query.message?.message_id;
  if (!chatId || !msgId) { await answerCallbackQuery(token, query.id); return; }

  const lang = await getLang(kv, query.from.id);
  const mode = query.data!.split(':')[1];

  if (!mode || mode === 'main') {
    const { text, kb } = guideMainMenu(lang, env.BOT_USERNAME);
    await editMessage(token, chatId, msgId, text, kb);
  } else {
    const content = guideContent(mode, lang, env.BOT_USERNAME);
    const backLabel = lang === 'en' ? '← Back to modes' : '← Kembali ke menu';
    const kb = { inline_keyboard: [[{ text: backLabel, callback_data: 'guide:main' }]] };
    await editMessage(token, chatId, msgId, content, kb);
  }
  await answerCallbackQuery(token, query.id);
}

async function handleSetLang(query: CallbackQuery, env: Env, lang: string): Promise<void> {
  const token = env.BOT_TOKEN;
  const kv = env.GAME_SESSIONS;
  if (lang !== 'id' && lang !== 'en') { await answerCallbackQuery(token, query.id); return; }

  await kv.put(`lang:${query.from.id}`, lang);
  const editText = lang === 'en'
    ? '🌐 Language set to <b>English</b>.'
    : '🌐 Bahasa diubah ke <b>Bahasa Indonesia</b>.';
  if (query.message) {
    await editMessage(token, query.message.chat.id, query.message.message_id, editText);
  }
  await answerCallbackQuery(token, query.id);
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
