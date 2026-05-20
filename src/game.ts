import type {
  Choice,
  Env,
  GameConfig,
  GameMode,
  GameSession,
  InlineKeyboardMarkup,
  LeaderboardEntry,
  RematchMeta,
  TelegramUser,
  UserStats,
} from './types';
import { editInlineMessage } from './telegram';
import { loadConfig } from './config';

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

// Renders a config value: numeric string ≥10 chars → <tg-emoji>, otherwise plain text.
export function fmtEmoji(configValue: string, fallback: string): string {
  if (/^\d{10,}$/.test(configValue)) {
    return `<tg-emoji emoji-id="${configValue}">${fallback}</tg-emoji>`;
  }
  return configValue;
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

export function waitingText(
  session: GameSession,
  botUsername: string,
  now = Date.now(),
  badge = ''
): string {
  const remaining = Math.max(1, Math.ceil((session.createdAt + 600_000 - now) / 60_000));
  const modeTag = session.mode === 'best_of_3' ? ' 🏆 Best of 3' : '';
  const badgeStr = badge ? ` ${badge}` : '';
  return (
    `🟢 ${escHtml(session.hostName)}${badgeStr} is ready!${modeTag}\n` +
    `Type <code>@${botUsername} ${session.gameId}</code> to join\n` +
    `⏰ ${remaining} min remaining`
  );
}

export function revealText(
  session: GameSession,
  perspective: 'host' | 'opponent',
  config: GameConfig
): string {
  const choice = perspective === 'host' ? session.hostChoice! : session.opponentChoice!;
  return fmtEmoji(config.reveal[choice], EMOJI[choice]);
}

export function resultText(
  matchOutcome: 'a' | 'b' | 'draw',
  perspective: 'host' | 'opponent',
  session: GameSession,
  config: GameConfig
): string {
  const hE = fmtEmoji(config.reveal[session.hostChoice!], EMOJI[session.hostChoice!]);
  const oE = fmtEmoji(config.reveal[session.opponentChoice!], EMOJI[session.opponentChoice!]);
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
  return (
    `${header ? header + '\n' : ''}` +
    `${escHtml(session.hostName)} vs ${escHtml(session.opponentName!)}\n\n` +
    `Round ${session.currentRound} — pick your weapon!`
  );
}

async function updateLeaderboard(
  kv: KVNamespace,
  userId: number,
  name: string,
  stats: UserStats
): Promise<void> {
  const lb = await kv.get<LeaderboardEntry[]>('leaderboard', 'json') ?? [];
  const idx = lb.findIndex(e => e.userId === userId);
  const entry: LeaderboardEntry = { userId, name, wins: stats.wins, total: stats.total };
  if (idx >= 0) lb[idx] = entry; else lb.push(entry);
  lb.sort((a, b) => b.wins - a.wins || b.total - a.total);
  await kv.put('leaderboard', JSON.stringify(lb.slice(0, 20)));
}

async function updateStats(
  kv: KVNamespace,
  userId: number,
  outcome: 'win' | 'loss' | 'draw',
  name?: string
): Promise<void> {
  const key = `stats:${userId}`;
  const s = await kv.get<UserStats>(key, 'json') ?? { wins: 0, losses: 0, draws: 0, total: 0 };
  if (outcome === 'win') s.wins++;
  else if (outcome === 'loss') s.losses++;
  else s.draws++;
  s.total++;
  await kv.put(key, JSON.stringify(s));
  if (name) await updateLeaderboard(kv, userId, name, s);
}

async function finishGame(
  token: string,
  kv: KVNamespace,
  session: GameSession,
  matchOutcome: 'a' | 'b' | 'draw',
  config: GameConfig
): Promise<void> {
  const done = { ...session, status: 'done' as const };

  // Pre-populate rematch meta so rematch works even after game TTL expires
  const rematchMeta: RematchMeta = {
    hostUserId: session.hostUserId,
    hostName: session.hostName,
    opponentUserId: session.opponentUserId!,
    opponentName: session.opponentName!,
    mode: session.mode,
    hostInlineMessageId: session.hostInlineMessageId,
    opponentInlineMessageId: session.opponentInlineMessageId!,
  };

  await Promise.all([
    kv.put(`game:${session.gameId}`, JSON.stringify(done), { expirationTtl: 600 }),
    kv.put(`rematch:R${session.gameId}:meta`, JSON.stringify(rematchMeta), { expirationTtl: 600 }),
  ]);

  await Promise.all([
    updateStats(kv, session.hostUserId, matchOutcome === 'a' ? 'win' : matchOutcome === 'draw' ? 'draw' : 'loss', session.hostName),
    updateStats(kv, session.opponentUserId!, matchOutcome === 'b' ? 'win' : matchOutcome === 'draw' ? 'draw' : 'loss', session.opponentName!),
  ]);

  const keyboard = rematchKeyboard(session.gameId);
  await Promise.all([
    editInlineMessage(token, session.hostInlineMessageId, resultText(matchOutcome, 'host', done, config), keyboard),
    editInlineMessage(token, session.opponentInlineMessageId!, resultText(matchOutcome, 'opponent', done, config), keyboard),
  ]);
}

// Max retry wait for time-sensitive countdown/reveal edits.
// Low cap keeps both messages in sync even when one hits a 429.
const REALTIME_RETRY_MS = 500;

export async function runCountdownAndReveal(
  token: string,
  kv: KVNamespace,
  session: GameSession,
  env: Env
): Promise<void> {
  const config = await loadConfig(kv, session.hostUserId, env);
  const h = session.hostInlineMessageId;
  const o = session.opponentInlineMessageId!;

  const t0 = Date.now();
  const ticks = (['3', '2', '1'] as const).map(n => config.countdown[n]);

  for (let i = 0; i < ticks.length; i++) {
    // Wait until exactly i*1000ms after start, compensating for API latency of previous tick
    const wait = t0 + i * 1000 - Date.now();
    if (wait > 0) await sleep(wait);

    await Promise.all([
      editInlineMessage(token, h, ticks[i], undefined, REALTIME_RETRY_MS),
      editInlineMessage(token, o, ticks[i], undefined, REALTIME_RETRY_MS),
    ]);
  }

  // Reveal exactly 1s after the last tick fires
  const waitReveal = t0 + 3 * 1000 - Date.now();
  if (waitReveal > 0) await sleep(waitReveal);

  await Promise.all([
    editInlineMessage(token, h, revealText(session, 'host', config), undefined, REALTIME_RETRY_MS),
    editInlineMessage(token, o, revealText(session, 'opponent', config), undefined, REALTIME_RETRY_MS),
  ]);
  await sleep(5000);

  const roundOutcome = determineWinner(session.hostChoice!, session.opponentChoice!);

  if (session.mode === 'single') {
    await finishGame(token, kv, session, roundOutcome, config);
    return;
  }

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
    await finishGame(token, kv, updated, matchOutcome, config);
    return;
  }

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
