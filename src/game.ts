import type { Choice, Env, GameMode, GameSession, InlineKeyboardMarkup, TelegramUser, UserStats } from './types';
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

export function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

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

// Returns a <tg-emoji> tag when a custom emoji ID is configured, otherwise plain emoji.
export function fmtEmoji(choice: Choice, custom: Record<Choice, string>): string {
  const id = custom[choice];
  if (id) return `<tg-emoji emoji-id="${id}">${EMOJI[choice]}</tg-emoji>`;
  return EMOJI[choice];
}

function customEmojiMap(env: Env): Record<Choice, string> {
  return {
    rock: env.CUSTOM_EMOJI_ROCK ?? '',
    paper: env.CUSTOM_EMOJI_PAPER ?? '',
    scissors: env.CUSTOM_EMOJI_SCISSORS ?? '',
  };
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

export function cancelKeyboard(gameId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [[
      { text: '❌ Cancel', callback_data: `cancel:${gameId}` },
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

export function rematchPickKeyboard(gameId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [[
      { text: '✊', callback_data: `rpick:${gameId}:rock` },
      { text: '✋', callback_data: `rpick:${gameId}:paper` },
      { text: '✌️', callback_data: `rpick:${gameId}:scissors` },
    ]],
  };
}

function gameHeader(session: GameSession): string {
  if (session.mode === 'best_of_3') {
    return `🏆 <b>Best of 3</b> • ${session.hostScore}-${session.opponentScore} • Round ${session.currentRound}/3`;
  }
  return '';
}

export function waitingText(session: GameSession, botUsername: string): string {
  const modeTag = session.mode === 'best_of_3' ? ' 🏆 Best of 3' : '';
  return `🟢 ${escHtml(session.hostName)} is ready!${modeTag}\nType <code>@${botUsername} ${session.gameId}</code> to join`;
}

export function expiringText(session: GameSession, botUsername: string): string {
  return `${waitingText(session, botUsername)}\n\n⚠️ <i>Expires soon!</i>`;
}

export function countdownText(n: string): string {
  return n;
}

export function revealText(
  session: GameSession,
  perspective: 'host' | 'opponent',
  custom: Record<Choice, string>
): string {
  const choice = perspective === 'host' ? session.hostChoice! : session.opponentChoice!;
  return fmtEmoji(choice, custom);
}

export function resultText(
  matchOutcome: 'a' | 'b' | 'draw',
  perspective: 'host' | 'opponent',
  session: GameSession,
  custom: Record<Choice, string>
): string {
  const hE = fmtEmoji(session.hostChoice!, custom);
  const oE = fmtEmoji(session.opponentChoice!, custom);
  const isHost = perspective === 'host';

  let verdict: string;
  if (matchOutcome === 'draw') {
    verdict = "🤝 It's a draw!";
  } else if ((matchOutcome === 'a') === isHost) {
    verdict = '🏆 You win!';
  } else {
    verdict = '😔 Better luck next time!';
  }

  return `${verdict}\n${hE} vs ${oE}`;
}

export function nextRoundText(session: GameSession): string {
  const header = gameHeader(session);
  return `${header ? header + '\n' : ''}${escHtml(session.hostName)} vs ${escHtml(session.opponentName!)}\n\nRound ${session.currentRound} — pick your weapon!`;
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
  matchOutcome: 'a' | 'b' | 'draw',
  custom: Record<Choice, string>
): Promise<void> {
  const done = { ...session, status: 'done' as const };
  await kv.put(`game:${session.gameId}`, JSON.stringify(done), { expirationTtl: 120 });

  await updateStats(kv, session.hostUserId, matchOutcome === 'a' ? 'win' : matchOutcome === 'draw' ? 'draw' : 'loss');
  await updateStats(kv, session.opponentUserId!, matchOutcome === 'b' ? 'win' : matchOutcome === 'draw' ? 'draw' : 'loss');

  const keyboard = rematchKeyboard(session.gameId);
  await Promise.all([
    editInlineMessage(token, session.hostInlineMessageId, resultText(matchOutcome, 'host', done, custom), keyboard),
    editInlineMessage(token, session.opponentInlineMessageId!, resultText(matchOutcome, 'opponent', done, custom), keyboard),
  ]);
}

export async function runCountdownAndReveal(
  token: string,
  kv: KVNamespace,
  session: GameSession,
  env: Env
): Promise<void> {
  const custom = customEmojiMap(env);
  const h = session.hostInlineMessageId;
  const o = session.opponentInlineMessageId!;

  // Countdown 3 → 2 → 1
  for (const n of ['3️⃣', '2️⃣', '1️⃣']) {
    await Promise.all([
      editInlineMessage(token, h, countdownText(n)),
      editInlineMessage(token, o, countdownText(n)),
    ]);
    await sleep(1000);
  }

  // Reveal each player's own choice simultaneously
  await Promise.all([
    editInlineMessage(token, h, revealText(session, 'host', custom)),
    editInlineMessage(token, o, revealText(session, 'opponent', custom)),
  ]);
  await sleep(5000);

  const roundOutcome = determineWinner(session.hostChoice!, session.opponentChoice!);

  if (session.mode === 'single') {
    await finishGame(token, kv, session, roundOutcome, custom);
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
    await finishGame(token, kv, updated, matchOutcome, custom);
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
