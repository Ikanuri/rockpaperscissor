import type {
  ChainEntry,
  ChainMeta,
  Choice,
  Env,
  GameConfig,
  GameMode,
  GameSession,
  InlineKeyboardMarkup,
  LastGameRecord,
  LeaderboardEntry,
  TelegramUser,
  UserStats,
  VsStats,
} from './types';
import { editInlineMessage, sendMessage } from './telegram';
import { loadConfig, RELEASE_DATE } from './config';
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

export const STREAK_MILESTONES = [5, 10, 20, 50, 100];

interface AchievementDef {
  id: string;
  label: string;
  check: (s: UserStats) => boolean;
}

const ACHIEVEMENT_DEFS: AchievementDef[] = [
  { id: 'first_win',  label: '🏆 Kemenangan pertama!',    check: s => s.wins >= 1 },
  { id: 'wins_10',    label: '🔟 10 kemenangan!',          check: s => s.wins >= 10 },
  { id: 'wins_50',    label: '🥇 50 kemenangan!',          check: s => s.wins >= 50 },
  { id: 'wins_100',   label: '💯 100 kemenangan!',         check: s => s.wins >= 100 },
  { id: 'total_10',   label: '🎮 10 game dimainkan',       check: s => s.total >= 10 },
  { id: 'total_100',  label: '🎮 100 game dimainkan',      check: s => s.total >= 100 },
  { id: 'streak_5',   label: '🔥 Streak 5x beruntun!',    check: s => (s.longestStreak ?? 0) >= 5 },
  { id: 'streak_10',  label: '🔥 Streak 10x beruntun!',   check: s => (s.longestStreak ?? 0) >= 10 },
  { id: 'streak_20',  label: '🔥 Streak 20x beruntun!',   check: s => (s.longestStreak ?? 0) >= 20 },
];

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
  const bytes = new Uint8Array(6);
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

const MODE_LABEL: Record<GameMode, string> = {
  single: '',
  best_of_3: 'Best of 3',
  best_of_5: 'Best of 5',
  best_of_7: 'Best of 7',
};

function gameHeader(session: GameSession): string {
  if (session.mode === 'single') return '';
  const label = MODE_LABEL[session.mode];
  const maxRounds = getMaxRounds(session.mode);
  return `🏆 <b>${label}</b> • ${session.hostScore}-${session.opponentScore} • Round ${session.currentRound}/${maxRounds}`;
}

export function waitingText(
  session: GameSession,
  _botUsername: string,
  now = Date.now()
): string {
  const remaining = Math.max(1, Math.ceil((session.createdAt + 600_000 - now) / 60_000));
  const modeStr = session.mode !== 'single' ? ` · ${MODE_LABEL[session.mode]}` : '';
  const gameTag = session.ranked
    ? ` 🏆 Ranked${modeStr}`
    : (session.mode !== 'single' ? ` 🏆 ${MODE_LABEL[session.mode]}` : '');
  const lockLine = session.lockedToUsername ? `\n🔒 For @${session.lockedToUsername} only` : '';
  return (
    `🟢 ${escHtml(session.hostName)} is ready!${gameTag}${lockLine}\n` +
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

export function getMaxRounds(mode: GameMode): number {
  if (mode === 'best_of_7') return 7;
  if (mode === 'best_of_5') return 5;
  if (mode === 'best_of_3') return 3;
  return 1;
}

export function getMaxWins(mode: GameMode): number {
  if (mode === 'best_of_7') return 4;
  if (mode === 'best_of_5') return 3;
  if (mode === 'best_of_3') return 2;
  return 1;
}

export function getDayIndex(now = Date.now()): number {
  return Math.floor((now - RELEASE_DATE.getTime()) / 86_400_000);
}

export function getWeekIndex(now = Date.now()): number {
  return Math.floor((now - RELEASE_DATE.getTime()) / (7 * 86_400_000));
}

export function getMonthIndex(now = Date.now()): number {
  const r = RELEASE_DATE;
  const d = new Date(now);
  return (d.getUTCFullYear() - r.getUTCFullYear()) * 12 + (d.getUTCMonth() - r.getUTCMonth());
}

// Kept for backward compat with SYNCSTATS message handler
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

interface UpdateStatsResult {
  stats: UserStats;
  notifyStreak?: number;
  newAchievements: string[];
}

async function updateStats(
  kv: KVNamespace,
  userId: number,
  outcome: 'win' | 'loss' | 'draw',
  choice: Choice,
  opponentId: number,
  opponentName: string,
  opponentRating: number,
  isRanked: boolean,
  isPremium: boolean,
  preloadedLifetime?: UserStats | null
): Promise<UpdateStatsResult> {
  const now = Date.now();
  const curDay = getDayIndex(now);
  const curWeek = getWeekIndex(now);
  const curMonth = getMonthIndex(now);

  const [lifetime, vsOpp] = await Promise.all([
    preloadedLifetime !== undefined ? Promise.resolve(preloadedLifetime) : kv.get<UserStats>(`stats:${userId}`, 'json'),
    kv.get<VsStats>(`stats:${userId}:vs:${opponentId}`, 'json'),
  ]);

  const s: UserStats = lifetime ?? { wins: 0, losses: 0, draws: 0, total: 0 };
  const v: VsStats = vsOpp ?? { wins: 0, losses: 0, draws: 0, total: 0 };

  // Lifetime W/L/D
  if (outcome === 'win') s.wins++;
  else if (outcome === 'loss') s.losses++;
  else s.draws++;
  s.total++;

  s.choices = s.choices ?? { rock: 0, paper: 0, scissors: 0 };
  s.choices[choice]++;

  // Overall streak — shield absorbs one loss per day for Premium players
  if (outcome === 'win') {
    s.currentStreak = (s.currentStreak ?? 0) + 1;
    if (s.currentStreak > (s.longestStreak ?? 0)) {
      s.longestStreak = s.currentStreak;
      s.longestStreakOpponent = opponentName;
    }
  } else if (outcome === 'loss') {
    const shieldAvailable = isPremium && (s.shieldUsedDayIndex ?? -1) !== curDay && (s.currentStreak ?? 0) > 0;
    if (shieldAvailable) {
      s.shieldUsedDayIndex = curDay;
    } else {
      s.currentStreak = 0;
    }
  }

  // Day period
  if (s.dayIndex !== curDay) {
    s.dayIndex = curDay;
    s.dayWins = 0; s.dayLosses = 0; s.dayDraws = 0; s.dayStreak = 0;
  }
  if (outcome === 'win') {
    s.dayWins = (s.dayWins ?? 0) + 1;
    s.dayStreak = (s.dayStreak ?? 0) + 1;
    if (s.dayStreak > (s.longestDayStreak ?? 0)) s.longestDayStreak = s.dayStreak;
  } else if (outcome === 'loss') {
    s.dayLosses = (s.dayLosses ?? 0) + 1;
    s.dayStreak = 0;
  } else {
    s.dayDraws = (s.dayDraws ?? 0) + 1;
  }

  // Week period
  if (s.weekIndex !== curWeek) {
    s.weekIndex = curWeek;
    s.weekWins = 0; s.weekLosses = 0; s.weekDraws = 0; s.weekStreak = 0;
  }
  if (outcome === 'win') {
    s.weekWins = (s.weekWins ?? 0) + 1;
    s.weekStreak = (s.weekStreak ?? 0) + 1;
    if (s.weekStreak > (s.longestWeekStreak ?? 0)) s.longestWeekStreak = s.weekStreak;
  } else if (outcome === 'loss') {
    s.weekLosses = (s.weekLosses ?? 0) + 1;
    s.weekStreak = 0;
  } else {
    s.weekDraws = (s.weekDraws ?? 0) + 1;
  }

  // Month period
  if (s.monthIndex !== curMonth) {
    s.monthIndex = curMonth;
    s.monthWins = 0; s.monthLosses = 0; s.monthDraws = 0; s.monthStreak = 0;
  }
  if (outcome === 'win') {
    s.monthWins = (s.monthWins ?? 0) + 1;
    s.monthStreak = (s.monthStreak ?? 0) + 1;
    if (s.monthStreak > (s.longestMonthStreak ?? 0)) s.longestMonthStreak = s.monthStreak;
  } else if (outcome === 'loss') {
    s.monthLosses = (s.monthLosses ?? 0) + 1;
    s.monthStreak = 0;
  } else {
    s.monthDraws = (s.monthDraws ?? 0) + 1;
  }

  // vs-opponent
  if (outcome === 'win') {
    v.wins++;
    v.currentStreak = (v.currentStreak ?? 0) + 1;
    if (v.currentStreak > (v.longestStreak ?? 0)) v.longestStreak = v.currentStreak;
  } else if (outcome === 'loss') {
    v.losses++;
    v.currentStreak = 0;
  } else {
    v.draws++;
  }
  v.total++;

  // Update longest vs-streak record in lifetime stats
  if ((v.longestStreak ?? 0) > (s.longestVsStreak ?? 0)) {
    s.longestVsStreak = v.longestStreak;
    s.longestVsOpponentId = opponentId;
    s.longestVsOpponentName = opponentName;
  }

  // ELO rating — only updated for ranked games
  if (isRanked) {
    const K = 16;
    const myRating = s.rating ?? 1000;
    const expected = 1 / (1 + Math.pow(10, (opponentRating - myRating) / 400));
    const scoreVal = outcome === 'win' ? 1 : outcome === 'loss' ? 0 : 0.5;
    s.rating = Math.round(myRating + K * (scoreVal - expected));
  }

  // Streak milestone notification check (win only)
  let notifyStreak: number | undefined;
  if (outcome === 'win') {
    const cur = s.currentStreak ?? 0;
    const lastNotified = s.lastNotifiedStreak ?? 0;
    const milestone = STREAK_MILESTONES.filter(m => m <= cur && m > lastNotified).pop();
    if (milestone) {
      s.lastNotifiedStreak = milestone;
      notifyStreak = milestone;
    }
  }

  // Achievement unlock check
  const newAchievements: string[] = [];
  for (const ach of ACHIEVEMENT_DEFS) {
    if (!(s.achievements?.[ach.id]) && ach.check(s)) {
      s.achievements = s.achievements ?? {};
      s.achievements[ach.id] = now;
      newAchievements.push(ach.label);
    }
  }

  await Promise.all([
    kv.put(`stats:${userId}`, JSON.stringify(s)),
    kv.put(`stats:${userId}:vs:${opponentId}`, JSON.stringify(v)),
  ]);

  return { stats: s, notifyStreak, newAchievements };
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
  ctx: ExecutionContext,
  hostConfig?: GameConfig | null,
  opponentConfig?: GameConfig | null
): Promise<void> {
  const done = { ...session, status: 'done' as const };

  await kv.put(`game:${session.gameId}`, JSON.stringify(done), { expirationTtl: 600 });

  const isRanked = session.ranked ?? false;

  // Pre-fetch lifetimes + donator tiers in one batch
  const [hostLifetime, opponentLifetime, hostDonator, opponentDonator] = await Promise.all([
    kv.get<UserStats>(`stats:${session.hostUserId}`, 'json'),
    kv.get<UserStats>(`stats:${session.opponentUserId!}`, 'json'),
    kv.get<{ tier: string; expiry: number }>(`donator:${session.hostUserId}`, 'json'),
    kv.get<{ tier: string; expiry: number }>(`donator:${session.opponentUserId!}`, 'json'),
  ]);
  const hostRating = hostLifetime?.rating ?? 1000;
  const opponentRating = opponentLifetime?.rating ?? 1000;
  const now = Date.now();
  const hostIsPremium = hostDonator?.tier === 'premium' && now <= hostDonator.expiry;
  const opponentIsPremium = opponentDonator?.tier === 'premium' && now <= opponentDonator.expiry;

  const [hostResult, opponentResult] = await Promise.all([
    updateStats(
      kv, session.hostUserId,
      matchOutcome === 'a' ? 'win' : matchOutcome === 'draw' ? 'draw' : 'loss',
      session.hostChoice!, session.opponentUserId!, session.opponentName!,
      opponentRating, isRanked, hostIsPremium, hostLifetime
    ),
    updateStats(
      kv, session.opponentUserId!,
      matchOutcome === 'b' ? 'win' : matchOutcome === 'draw' ? 'draw' : 'loss',
      session.opponentChoice!, session.hostUserId, session.hostName,
      hostRating, isRanked, opponentIsPremium, opponentLifetime
    ),
    ...(hasFeature(env, 'leaderboard') ? [updateLeaderboard(
      kv,
      { userId: session.hostUserId, name: session.hostName },
      { userId: session.opponentUserId!, name: session.opponentName! },
      matchOutcome
    )] : []),
  ]);

  const hostStats = hostResult.stats;
  const opponentStats = opponentResult.stats;

  // Streak milestone DMs (fire-and-forget)
  if (hostResult.notifyStreak) {
    ctx.waitUntil(sendMessage(token, session.hostUserId,
      `🔥 Streak <b>${hostResult.notifyStreak}x</b> beruntun! Luar biasa! 🏆`
    ));
  }
  if (opponentResult.notifyStreak) {
    ctx.waitUntil(sendMessage(token, session.opponentUserId!,
      `🔥 Streak <b>${opponentResult.notifyStreak}x</b> beruntun! Luar biasa! 🏆`
    ));
  }

  // Achievement DMs (fire-and-forget)
  for (const label of hostResult.newAchievements) {
    ctx.waitUntil(sendMessage(token, session.hostUserId, `🏅 Achievement unlocked: ${label}`));
  }
  for (const label of opponentResult.newAchievements) {
    ctx.waitUntil(sendMessage(token, session.opponentUserId!, `🏅 Achievement unlocked: ${label}`));
  }

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
    ranked: isRanked || (existingMeta?.ranked ?? false),
  };

  const hostLastGame: LastGameRecord = {
    opponentId: session.opponentUserId!,
    opponentName: session.opponentName!,
    myChoice: session.hostChoice!,
    opponentChoice: session.opponentChoice!,
    outcome: matchOutcome === 'a' ? 'win' : matchOutcome === 'draw' ? 'draw' : 'loss',
    ranked: isRanked,
    at: now,
  };
  const opponentLastGame: LastGameRecord = {
    opponentId: session.hostUserId,
    opponentName: session.hostName,
    myChoice: session.opponentChoice!,
    opponentChoice: session.hostChoice!,
    outcome: matchOutcome === 'b' ? 'win' : matchOutcome === 'draw' ? 'draw' : 'loss',
    ranked: isRanked,
    at: now,
  };

  await Promise.all([
    kv.put(histKey, JSON.stringify(history), { expirationTtl: 3600 }),
    kv.put(`chain:${chainCode}:meta`, JSON.stringify(chainMeta), { expirationTtl: 300 }),
    kv.put(`stats:${session.hostUserId}:last`, JSON.stringify(hostLastGame)),
    kv.put(`stats:${session.opponentUserId!}:last`, JSON.stringify(opponentLastGame)),
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
  env: Env,
  ctx: ExecutionContext
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
    await finishGame(token, kv, session, roundOutcome, env, ctx, hostConfig, opponentConfig);
    return;
  }

  const updated = {
    ...session,
    rounds: [...session.rounds, { hostChoice: session.hostChoice!, opponentChoice: session.opponentChoice! }],
    hostScore: session.hostScore + (roundOutcome === 'a' ? 1 : 0),
    opponentScore: session.opponentScore + (roundOutcome === 'b' ? 1 : 0),
  };

  const maxWins = getMaxWins(session.mode);
  const maxRounds = getMaxRounds(session.mode);
  const matchOver = updated.hostScore >= maxWins || updated.opponentScore >= maxWins || updated.currentRound >= maxRounds;

  if (matchOver) {
    const matchOutcome: 'a' | 'b' | 'draw' =
      updated.hostScore > updated.opponentScore ? 'a' :
      updated.hostScore < updated.opponentScore ? 'b' : 'draw';
    await finishGame(token, kv, updated, matchOutcome, env, ctx, hostConfig, opponentConfig);
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
