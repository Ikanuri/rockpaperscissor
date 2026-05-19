import type { Choice, GameMode, GameSession, InlineKeyboardMarkup, TelegramUser, UserStats } from './types';
import { editInlineMessage } from './telegram';

export const EMOJI: Record<Choice, string> = {
  rock: '✊',
  paper: '✋',
  scissors: '✌️',
};

export const LABEL: Record<Choice, string> = {
  rock: '✊ Rock',
  paper: '✋ Paper',
  scissors: '✌️ Scissors',
};

export function formatUser(user: TelegramUser): string {
  return user.username ? `@${user.username}` : user.first_name;
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function generateId(): string {
  // No O/I/0/1 to avoid confusion when typing the code
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}

export function determineWinner(a: Choice, b: Choice): 'a' | 'b' | 'draw' {
  if (a === b) return 'draw';
  if (
    (a === 'rock' && b === 'scissors') ||
    (a === 'scissors' && b === 'paper') ||
    (a === 'paper' && b === 'rock')
  ) return 'a';
  return 'b';
}

export function pickKeyboard(gameId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [[
      { text: '✊', callback_data: `pick:${gameId}:rock` },
      { text: '✋', callback_data: `pick:${gameId}:paper` },
      { text: '✌️', callback_data: `pick:${gameId}:scissors` },
    ]],
  };
}

export function rematchKeyboard(gameId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [[
      { text: '🔄 Rematch', callback_data: `rematch:${gameId}` },
    ]],
  };
}

function gameHeader(session: GameSession): string {
  if (session.mode === 'best_of_3') {
    return `🏆 *Best of 3* • ${session.hostScore}-${session.opponentScore} • Round ${session.currentRound}/3\n━━━━━━━━━━━━━━`;
  }
  return `🎮 *Rock-Paper-Scissors*\n━━━━━━━━━━━━━━`;
}

export function waitingText(session: GameSession, botUsername: string): string {
  return `${gameHeader(session)}\n🟢 ${session.hostName} is ready!\n\nOpponent: type \`@${botUsername} ${session.gameId}\` to join`;
}

export function expiringText(session: GameSession, botUsername: string): string {
  return `${waitingText(session, botUsername)}\n\n⚠️ _This game expires in ~1 minute!_`;
}

export function countdownText(session: GameSession, n: string): string {
  return `${gameHeader(session)}\n${session.hostName} vs ${session.opponentName}\n\n*${n}*`;
}

export function revealText(session: GameSession): string {
  const hE = EMOJI[session.hostChoice!];
  const oE = EMOJI[session.opponentChoice!];
  return `${gameHeader(session)}\n${session.hostName}: *${hE}*\n${session.opponentName}: *${oE}*`;
}

export function resultText(
  matchOutcome: 'a' | 'b' | 'draw',
  perspective: 'host' | 'opponent',
  session: GameSession
): string {
  const hE = EMOJI[session.hostChoice!];
  const oE = EMOJI[session.opponentChoice!];
  const isHost = perspective === 'host';

  let verdict: string;
  if (matchOutcome === 'draw') {
    verdict = "🤝 *It's a draw!*";
  } else if ((matchOutcome === 'a') === isHost) {
    verdict = '🏆 *You win!*';
  } else {
    verdict = '😔 *Better luck next time!*';
  }

  return `${gameHeader(session)}\n${verdict}\n\n${session.hostName}: *${hE}* vs ${session.opponentName}: *${oE}*`;
}

export function nextRoundText(session: GameSession): string {
  return `${gameHeader(session)}\n${session.hostName} vs ${session.opponentName}\n\nRound ${session.currentRound} — pick your weapon!`;
}

async function updateStats(
  kv: KVNamespace,
  userId: number,
  outcome: 'win' | 'loss' | 'draw'
): Promise<void> {
  const key = `stats:${userId}`;
  const s = await kv.get<UserStats>(key, 'json') ?? { wins: 0, losses: 0, draws: 0, total: 0 };
  if (outcome === 'win') s.wins++;
  else if (outcome === 'loss') s.losses++;
  else s.draws++;
  s.total++;
  await kv.put(key, JSON.stringify(s));
}

async function finishGame(
  token: string,
  kv: KVNamespace,
  session: GameSession,
  matchOutcome: 'a' | 'b' | 'draw'
): Promise<void> {
  const done = { ...session, status: 'done' as const };
  await kv.put(`game:${session.gameId}`, JSON.stringify(done), { expirationTtl: 120 });

  await updateStats(kv, session.hostUserId, matchOutcome === 'a' ? 'win' : matchOutcome === 'draw' ? 'draw' : 'loss');
  await updateStats(kv, session.opponentUserId!, matchOutcome === 'b' ? 'win' : matchOutcome === 'draw' ? 'draw' : 'loss');

  const keyboard = rematchKeyboard(session.gameId);
  await Promise.all([
    editInlineMessage(token, session.hostInlineMessageId, resultText(matchOutcome, 'host', done), keyboard),
    editInlineMessage(token, session.opponentInlineMessageId!, resultText(matchOutcome, 'opponent', done), keyboard),
  ]);
}

export async function runCountdownAndReveal(
  token: string,
  kv: KVNamespace,
  session: GameSession
): Promise<void> {
  const h = session.hostInlineMessageId;
  const o = session.opponentInlineMessageId!;

  // Countdown 3 → 2 → 1
  for (const n of ['3\\.\\.\\.', '2\\.\\.\\.', '1\\.\\.\\.']) {
    // Use dots without Markdown escaping (legacy Markdown doesn't need it)
    const label = n.replace(/\\\./g, '.');
    await Promise.all([
      editInlineMessage(token, h, countdownText(session, label)),
      editInlineMessage(token, o, countdownText(session, label)),
    ]);
    await sleep(1000);
  }

  // Reveal both choices simultaneously
  const reveal = revealText(session);
  await Promise.all([
    editInlineMessage(token, h, reveal),
    editInlineMessage(token, o, reveal),
  ]);
  await sleep(3000);

  const roundOutcome = determineWinner(session.hostChoice!, session.opponentChoice!);

  if (session.mode === 'single') {
    await finishGame(token, kv, session, roundOutcome);
    return;
  }

  // Best of 3: update scores and check if match is over
  const updated = {
    ...session,
    rounds: [...session.rounds, { hostChoice: session.hostChoice!, opponentChoice: session.opponentChoice! }],
    hostScore: session.hostScore + (roundOutcome === 'a' ? 1 : 0),
    opponentScore: session.opponentScore + (roundOutcome === 'b' ? 1 : 0),
  };

  const matchOver = updated.hostScore >= 2 || updated.opponentScore >= 2 || updated.currentRound >= 3;

  if (matchOver) {
    const matchOutcome: 'a' | 'b' | 'draw' =
      updated.hostScore > updated.opponentScore ? 'a' :
      updated.hostScore < updated.opponentScore ? 'b' : 'draw';
    await finishGame(token, kv, updated, matchOutcome);
    return;
  }

  // Start next round
  const nextRound: GameSession = {
    ...updated,
    currentRound: updated.currentRound + 1,
    hostChoice: null,
    opponentChoice: null,
    status: 'playing',
  };

  await kv.put(`game:${session.gameId}`, JSON.stringify(nextRound), { expirationTtl: 300 });

  const nextMsg = nextRoundText(nextRound);
  const keyboard = pickKeyboard(session.gameId);
  await Promise.all([
    editInlineMessage(token, h, nextMsg, keyboard),
    editInlineMessage(token, o, nextMsg, keyboard),
  ]);
}

export { updateStats };
export type { GameMode };
