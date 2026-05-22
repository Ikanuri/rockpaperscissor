import type {
  ChainEntry,
  ChainMeta,
  Choice,
  Env,
  GameConfig,
  GameMode,
  GameSession,
  InlineKeyboardMarkup,
  LeaderboardEntry,
  TelegramUser,
  UserStats,
} from './types';
import { editInlineMessage } from './telegram';
import { loadConfig } from './config';
import { hasFeature } from './feature';

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

export function fmtEmoji(customId: string | undefined, fallback: string): string {
  if (customId && /^\d{10,}$/.test(customId)) {
    return `<tg-emoji emoji-id="${customId}">${fallback}</tg-emoji>`;
  }
  return customId || fallback;
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

export function waitingKeyboard(gameId: string, joinQuery?: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: '🎮 Join', switch_inline_query_current_chat: joinQuery ?? gameId }],
      [{ text: '❌ Cancel', callback_data: `cancel:${gameId}` }],
    ],
  };
}

export function rematchKeyboard(chainCode: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [[
      { text: '🔄 Rematch', switch_inline_query_current_chat: chainCode },
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
  _botUsername: string,
  now = Date.now()
): string {
  const remaining = Math.max(1, Math.ceil((session.createdAt + 600_000 - now) / 60_000));
  const modeTag = session.mode === 'best_of_3' ? ' 🏆 Best of 3' : '';
  const lockLine = session.lockedToUsername ? `\n🔒 For @${session.lockedToUsername} only` : '';
  return (
    `🟢 ${escHtml(session.hostName)} is ready!${modeTag}${lockLine}\n` +
    `⏰ ${remaining} min remaining`
  );
}

export function nextRoundText(session: GameSession): string {
  const header = gameHeader(session);
  return (
    `${header ? header + '\n' : ''}` +
    `${escHtml(session.hostName)} vs ${escHtml(session.opponentName!)}\n\n` +
    `Round ${session.currentRound} — pick your weapon!`
  );
}

function revealEmoji(choice: Choice, env: Env, config?: GameConfig | null): string {
  if (config) return fmtEmoji(config.reveal[choice], EMOJI[choice]);
  const envAny = env as unknown as Record<string, string>;
  return fmtEmoji(envAny[`CUSTOM_EMOJI_${choice.toUpperCase()}`], EMOJI[choice]);
}

function choiceDisplay(choice: Choice, env: Env, config?: GameConfig | null): string {
  const customId = config?.reveal[choice]
    ?? (env as unknown as Record<string, string>)[`CUSTOM_EMOJI_${choice.toUpperCase()}`];
  const rendered = revealEmoji(choice, env, config);
  if (customId && /^\d{10,}$/.test(customId)) {
    return `${rendered} (${EMOJI[choice]})`;
  }
  return rendered;
}

export function getWeekKey(now = Date.now()): string {
  const d = new Date(now);
  const day = d.getUTCDay() || 7;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 1));
  const yearStart = new Date(Date.UTC(monday.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((monday.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${monday.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function shortName(name: string): string {
  return name.length > 12 ? name.slice(0, 12) + '…' : name;
}

function historyBlock(history: ChainEntry[]): string {
  if (history.length < 2) return '';

  const refId = history[0].hostUserId;
  const refName = escHtml(shortName(history[0].hostName));
  const altName = escHtml(shortName(history[0].opponentName));

  let refWins = 0, altWins = 0, draws = 0;
  const refRow: string[] = [];
  const altRow: string[] = [];

  for (const e of history) {
    const refIsHost = e.hostUserId === refId;
    if (e.winner === 'draw') {
      draws++;
      refRow.push('🌀');
      altRow.push('🌀');
    } else {
      const refWon = (e.winner === 'host') === refIsHost;
      if (refWon) {
        refWins++;
        refRow.push('✅');
        altRow.push('❌');
      } else {
        altWins++;
        refRow.push('❌');
        altRow.push('✅');
      }
    }
  }

  const n = history.length;
  const score = `${refWins}–${altWins}${draws > 0 ? ` (${draws}🤝)` : ''}`;

  return (
    `\n<blockquote expandable>` +
    `📊 ${n} game${n > 1 ? 's' : ''} · ${score}\n` +
    `${refName}: ${refRow.join('')}\n` +
    `${altName}: ${altRow.join('')}` +
    `</blockquote>`
  );
}

function resultText(
  matchOutcome: 'a' | 'b' | 'draw',
  session: GameSession,
  env: Env,
  history?: ChainEntry[],
  hostConfig?: GameConfig | null,
  opponentConfig?: GameConfig | null,
  winnerStreak?: number
): string {
  const hE = choiceDisplay(session.hostChoice!, env, hostConfig);
  const oE = choiceDisplay(session.opponentChoice!, env, opponentConfig);
  const hName = escHtml(session.hostName);
  const oName = escHtml(session.opponentName!);

  let verdict: string;
  if (matchOutcome === 'draw') {
    verdict = '🤝 Draw!';
  } else if (matchOutcome === 'a') {
    verdict = `🏆 ${hName} wins!`;
  } else {
    verdict = `🏆 ${oName} wins!`;
  }

  const streakLine = winnerStreak && winnerStreak >= 2 ? `\n🔥 ${winnerStreak} win streak!` : '';
  const histBlock = history ? historyBlock(history) : '';
  return `${verdict}${streakLine}\n${hName} ${hE} · ${oName} ${oE}${histBlock}`;
}

async function updateStats(
  kv: KVNamespace,
  userId: number,
  outcome: 'win' | 'loss' | 'draw',
  choice: Choice,
  opponentId: number,
  opponentName: string
): Promise<UserStats> {
  const weekKey = getWeekKey();

  const [lifetime, weekly, vsOpp] = await Promise.all([
    kv.get<UserStats>(`stats:${userId}`, 'json'),
    kv.get<UserStats>(`stats:${userId}:week:${weekKey}`, 'json'),
    kv.get<UserStats>(`stats:${userId}:vs:${opponentId}`, 'json'),
  ]);

  const s = lifetime ?? { wins: 0, losses: 0, draws: 0, total: 0 };
  const w = weekly ?? { wins: 0, losses: 0, draws: 0, total: 0 };
  const v = vsOpp ?? { wins: 0, losses: 0, draws: 0, total: 0 };

  const bump = (stat: UserStats) => {
    if (outcome === 'win') stat.wins++;
    else if (outcome === 'loss') stat.losses++;
    else stat.draws++;
    stat.total++;
  };

  bump(s);
  bump(w);
  bump(v);

  s.choices = s.choices ?? { rock: 0, paper: 0, scissors: 0 };
  s.choices[choice]++;

  // Streak: win = +1, loss = reset, draw = no change
  if (outcome === 'win') {
    s.currentStreak = (s.currentStreak ?? 0) + 1;
    if (s.currentStreak > (s.longestStreak ?? 0)) {
      s.longestStreak = s.currentStreak;
      s.longestStreakOpponent = opponentName;
    }
  } else if (outcome === 'loss') {
    s.currentStreak = 0;
  }

  await Promise.all([
    kv.put(`stats:${userId}`, JSON.stringify(s)),
    kv.put(`stats:${userId}:week:${weekKey}`, JSON.stringify(w), { expirationTtl: 7 * 24 * 3600 }),
    kv.put(`stats:${userId}:vs:${opponentId}`, JSON.stringify(v)),
  ]);

  return s;
}

async function updateLeaderboard(
  kv: KVNamespace,
  host: { userId: number; name: string },
  op: { userId: number; name: string },
  outcome: 'a' | 'b' | 'draw'
): Promise<void> {
  const board = (await kv.get<LeaderboardEntry[]>('leaderboard', 'json')) ?? [];
  for (const [user, won] of [[host, outcome === 'a'], [op, outcome === 'b']] as Array<[{ userId: number; name: string }, boolean]>) {
    const idx = board.findIndex(e => e.userId === user.userId);
    if (idx >= 0) {
      board[idx].name = user.name;
      board[idx].total++;
      if (won) board[idx].wins++;
    } else {
      board.push({ userId: user.userId, name: user.name, wins: won ? 1 : 0, total: 1 });
    }
  }
  board.sort((a, b) => b.wins - a.wins || b.total - a.total);
  await kv.put('leaderboard', JSON.stringify(board.slice(0, 20)));
}

async function finishGame(
  token: string,
  kv: KVNamespace,
  session: GameSession,
  matchOutcome: 'a' | 'b' | 'draw',
  env: Env,
  hostConfig?: GameConfig | null,
  opponentConfig?: GameConfig | null
): Promise<void> {
  const done = { ...session, status: 'done' as const };

  await kv.put(`game:${session.gameId}`, JSON.stringify(done), { expirationTtl: 600 });

  const [hostStats, opponentStats] = await Promise.all([
    updateStats(
      kv, session.hostUserId,
      matchOutcome === 'a' ? 'win' : matchOutcome === 'draw' ? 'draw' : 'loss',
      session.hostChoice!, session.opponentUserId!, session.opponentName!
    ),
    updateStats(
      kv, session.opponentUserId!,
      matchOutcome === 'b' ? 'win' : matchOutcome === 'draw' ? 'draw' : 'loss',
      session.opponentChoice!, session.hostUserId, session.hostName
    ),
    ...(hasFeature(env, 'leaderboard') ? [updateLeaderboard(
      kv,
      { userId: session.hostUserId, name: session.hostName },
      { userId: session.opponentUserId!, name: session.opponentName! },
      matchOutcome
    )] : []),
  ]);

  // Always track chain history so rematch #1 already has game 1 on record
  const chainCode = session.chainId ?? `R${session.gameId}`;
  const histKey = `chain:${chainCode}:history`;
  const prev = await kv.get<ChainEntry[]>(histKey, 'json') ?? [];
  const entry: ChainEntry = {
    hostUserId: session.hostUserId,
    hostName: session.hostName,
    opponentUserId: session.opponentUserId!,
    opponentName: session.opponentName!,
    hostChoice: session.hostChoice!,
    opponentChoice: session.opponentChoice!,
    winner: matchOutcome === 'draw' ? 'draw' : matchOutcome === 'a' ? 'host' : 'opponent',
  };
  const history = [...prev, entry];

  // Preserve original player IDs in chain meta across rematches
  const existingMeta = session.chainId
    ? await kv.get<ChainMeta>(`chain:${chainCode}:meta`, 'json')
    : null;
  const chainMeta: ChainMeta = {
    hostUserId: existingMeta?.hostUserId ?? session.hostUserId,
    opponentUserId: existingMeta?.opponentUserId ?? session.opponentUserId!,
    mode: session.mode,
  };

  await Promise.all([
    kv.put(histKey, JSON.stringify(history), { expirationTtl: 3600 }),
    kv.put(`chain:${chainCode}:meta`, JSON.stringify(chainMeta), { expirationTtl: 300 }),
  ]);

  const keyboard = rematchKeyboard(chainCode);
  const winnerStreak = matchOutcome === 'a' ? hostStats.currentStreak : matchOutcome === 'b' ? opponentStats.currentStreak : undefined;
  const text = resultText(matchOutcome, done, env, history, hostConfig, opponentConfig, winnerStreak);

  await Promise.all([
    editInlineMessage(token, session.hostInlineMessageId, text, keyboard),
    editInlineMessage(token, session.opponentInlineMessageId!, text, keyboard),
  ]);
}

// Low cap keeps both messages in sync even if one hits a 429
const REALTIME_RETRY_MS = 500;

export async function runRevealAndResult(
  token: string,
  kv: KVNamespace,
  session: GameSession,
  env: Env
): Promise<void> {
  const h = session.hostInlineMessageId;
  const o = session.opponentInlineMessageId!;

  const [hostConfig, opponentConfig] = await Promise.all([
    loadConfig(kv, session.hostUserId, env),
    loadConfig(kv, session.opponentUserId!, env),
  ]);

  const hE = revealEmoji(session.hostChoice!, env, hostConfig);
  const oE = revealEmoji(session.opponentChoice!, env, opponentConfig);

  // Each player sees their own choice emoji (rendered with their own config) for 5s before result
  await Promise.all([
    editInlineMessage(token, h, hE, undefined, REALTIME_RETRY_MS),
    editInlineMessage(token, o, oE, undefined, REALTIME_RETRY_MS),
  ]);
  await sleep(5000);

  const roundOutcome = determineWinner(session.hostChoice!, session.opponentChoice!);

  if (session.mode === 'single') {
    await finishGame(token, kv, session, roundOutcome, env, hostConfig, opponentConfig);
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
    await finishGame(token, kv, updated, matchOutcome, env, hostConfig, opponentConfig);
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

export async function trackHostedGame(kv: KVNamespace, userId: number, gameId: string): Promise<void> {
  const key = `hostgames:${userId}`;
  const list = await kv.get<string[]>(key, 'json') ?? [];
  if (!list.includes(gameId)) {
    list.push(gameId);
    await kv.put(key, JSON.stringify(list), { expirationTtl: 660 });
  }
}
