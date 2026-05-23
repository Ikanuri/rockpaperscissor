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
  LmsPlayer,
  LmsRoundRecord,
  LmsSession,
  TeamDiceWaitState,
  TeamPlayer,
  TeamSession,
  TelegramUser,
  TournamentMatch,
  TournamentPlayer,
  TournamentSession,
  UserStats,
  VsStats,
} from './types';
import { editInlineMessage, editMessage, pinChatMessage, sendDice, sendMessage, sendMessageForId } from './telegram';
import { loadConfig, RELEASE_DATE } from './config';
import { hasFeature, isBetaUser } from './feature';

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

export function waitingKeyboard(gameId: string, joinQuery?: string, showRefresh = false): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '🎮 Join', switch_inline_query_current_chat: joinQuery ?? gameId },
        ...(showRefresh ? [{ text: '🔄', callback_data: `refresh:${gameId}` }] : []),
      ],
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
  const ttlMs = session.chainId ? 300_000 : 600_000;
  const remaining = Math.max(1, Math.ceil((session.createdAt + ttlMs - now) / 60_000));
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
  if (customId && customId !== EMOJI[choice]) {
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

async function updateDailyLeaderboard(
  kv: KVNamespace,
  host: { userId: number; name: string },
  op: { userId: number; name: string },
  outcome: 'a' | 'b' | 'draw'
): Promise<void> {
  const dayIdx = getDayIndex();
  const key = `daily:${dayIdx}:leaderboard`;
  const board = (await kv.get<LeaderboardEntry[]>(key, 'json')) ?? [];
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
  await kv.put(key, JSON.stringify(board.slice(0, 20)), { expirationTtl: 86400 * 3 });
}

// ── Team Mode ────────────────────────────────────────────────────────────────

export function teamPickKeyboard(gameId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [[
      { text: '✊', callback_data: `tpick:${gameId}:rock` },
      { text: '✋', callback_data: `tpick:${gameId}:paper` },
      { text: '✌️', callback_data: `tpick:${gameId}:scissors` },
    ]],
  };
}

export function teamWaitingKeyboard(gameId: string, slotsA: number, slotsB: number): InlineKeyboardMarkup {
  const joinRow: Array<{ text: string; switch_inline_query_current_chat: string }> = [];
  if (slotsA > 0) joinRow.push({ text: `🤝 Tim A (${slotsA})`, switch_inline_query_current_chat: `TJOIN ${gameId} A` });
  if (slotsB > 0) joinRow.push({ text: `⚔️ Tim B (${slotsB})`, switch_inline_query_current_chat: `TJOIN ${gameId} B` });
  const rows: InlineKeyboardMarkup['inline_keyboard'] = [];
  if (joinRow.length) rows.push(joinRow);
  rows.push([
    { text: '⏰ Extend', callback_data: `extteam:${gameId}` },
    { text: '❌ Batal', callback_data: `tcancel:${gameId}` },
  ]);
  return { inline_keyboard: rows };
}

export function lmsJoinKeyboard(gameId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [[
      { text: '⚔️ Join', switch_inline_query_current_chat: gameId },
      { text: '⏰ Extend', callback_data: `extlms:${gameId}` },
    ]],
  };
}

export function lmsHostKeyboard(gameId: string, canForce: boolean): InlineKeyboardMarkup {
  const rows: InlineKeyboardMarkup['inline_keyboard'] = [[
    { text: '⚔️ Join', switch_inline_query_current_chat: gameId },
    { text: '⏰ Extend', callback_data: `extlms:${gameId}` },
  ]];
  if (canForce) rows.push([{ text: '▶️ Force Start', callback_data: `lmsforce:${gameId}` }]);
  return { inline_keyboard: rows };
}

export async function loadConfigAuthorized(
  kv: KVNamespace,
  userId: number,
  env: Env
): Promise<GameConfig | null> {
  if (String(userId) === env.BOT_OWNER_ID) return loadConfig(kv, userId, env);
  const [config, donator, beta] = await Promise.all([
    loadConfig(kv, userId, env),
    kv.get<{ tier: string; expiry: number }>(`donator:${userId}`, 'json'),
    isBetaUser(kv, userId, env.BOT_OWNER_ID),
  ]);
  const authorized = beta || (!!donator && donator.tier !== 'free' && Date.now() <= donator.expiry);
  return authorized ? config : null;
}

function expiryTimeStr(createdAt: number, ttlMs = 600_000): string {
  const d = new Date(createdAt + ttlMs);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
}

export function teamWaitingText(session: TeamSession): string {
  const modeLabel = session.mode === 'single' ? ''
    : session.mode === 'best_of_3' ? ' · BO3'
    : session.mode === 'best_of_5' ? ' · BO5' : ' · BO7';
  const slotLine = (team: TeamPlayer[], label: string) => {
    const slots = Array.from({ length: session.teamSize }, (_, i) =>
      team[i] ? escHtml(team[i].name) : '❓'
    ).join(' · ');
    return `${label}: ${slots}`;
  };
  const expiryStr = expiryTimeStr(session.createdAt);
  return (
    `⚔️ <b>Team ${session.teamSize}v${session.teamSize}${modeLabel}</b> · <code>${session.gameId}</code>\n` +
    `${slotLine(session.teamA, '🔵 Tim A')}\n` +
    `${slotLine(session.teamB, '🔴 Tim B')}\n\n` +
    `⏰ Berlaku hingga ${expiryStr}\n` +
    `👇 Bergabung untuk main!`
  );
}

// Returns the majority choice if unambiguous, null if tied.
function resolveChoiceNoDice(team: TeamPlayer[]): { choice: Choice; notes: string[] } | null {
  const votes: Record<Choice, TeamPlayer[]> = { rock: [], paper: [], scissors: [] };
  for (const p of team) if (p.choice) votes[p.choice].push(p);
  const sorted = (['rock', 'paper', 'scissors'] as Choice[])
    .filter(c => votes[c].length > 0)
    .sort((a, b) => votes[b].length - votes[a].length);
  if (sorted.length === 0) return { choice: 'rock', notes: [] };
  if (sorted.length === 1 || votes[sorted[0]].length > votes[sorted[1]].length) {
    return {
      choice: sorted[0],
      notes: sorted.slice(1).flatMap(c => votes[c].map(p => `${escHtml(p.name)} ${EMOJI[c]} tidak dipakai`)),
    };
  }
  return null;
}

// Returns all players involved in the top-count tie.
function getTiedPlayers(team: TeamPlayer[]): Array<{ userId: number; name: string; choice: Choice }> {
  const votes: Record<Choice, TeamPlayer[]> = { rock: [], paper: [], scissors: [] };
  for (const p of team) if (p.choice) votes[p.choice].push(p);
  const sorted = (['rock', 'paper', 'scissors'] as Choice[])
    .filter(c => votes[c].length > 0)
    .sort((a, b) => votes[b].length - votes[a].length);
  if (sorted.length === 0) return [];
  const topCount = votes[sorted[0]].length;
  return sorted
    .filter(c => votes[c].length === topCount)
    .flatMap(c => votes[c].map(p => ({ userId: p.userId, name: p.name, choice: c as Choice })));
}

// Bot rolls dice for tied players and returns the winner's choice.
export async function botResolveTie(
  tied: Array<{ userId: number; name: string; choice: Choice }>,
  chatId: number,
  token: string
): Promise<{ choice: Choice; notes: string[] }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const rolls = await Promise.all(tied.map(async e => ({ ...e, roll: await sendDice(token, chatId) })));
    const maxRoll = Math.max(...rolls.map(r => r.roll));
    const winners = rolls.filter(r => r.roll === maxRoll);
    if (winners.length === 1) {
      const w = winners[0];
      return {
        choice: w.choice,
        notes: rolls
          .filter(r => r.userId !== w.userId)
          .map(r => `${escHtml(r.name)} 🎲${r.roll} ${EMOJI[r.choice]} tidak dipakai`),
      };
    }
  }
  const fallback = tied[Math.floor(Math.random() * tied.length)];
  return { choice: fallback.choice, notes: ['Dadu seri 3x — pilihan acak'] };
}

// Core round resolution — called once both team choices are determined.
async function executeTeamRound(
  token: string,
  kv: KVNamespace,
  session: TeamSession,
  resA: { choice: Choice; notes: string[] },
  resB: { choice: Choice; notes: string[] },
  env: Env,
  ctx: ExecutionContext,
  configs = new Map<number, GameConfig | null>()
): Promise<void> {
  // Reveal: each player briefly sees their own choice emoji with personal config
  const allPlayers = [...session.teamA, ...session.teamB];
  await Promise.allSettled(allPlayers.map(p =>
    editInlineMessage(token, p.inlineMessageId, revealEmoji(p.choice!, env, configs.get(p.userId) ?? null))
  ));
  await sleep(4000);

  const choiceA = resA.choice;
  const choiceB = resB.choice;
  const roundOutcome = determineWinner(choiceA, choiceB);
  const newScoreA = session.scoreA + (roundOutcome === 'a' ? 1 : 0);
  const newScoreB = session.scoreB + (roundOutcome === 'b' ? 1 : 0);
  const maxWins = getMaxWins(session.mode);
  const isDone = roundOutcome !== 'draw' && (newScoreA >= maxWins || newScoreB >= maxWins);
  const teamALine = `🔵 Tim A ${EMOJI[choiceA]}: ${session.teamA.map(p => `${escHtml(p.name)} ${choiceDisplay(p.choice!, env, configs.get(p.userId) ?? null)}`).join(', ')}`;
  const teamBLine = `🔴 Tim B ${EMOJI[choiceB]}: ${session.teamB.map(p => `${escHtml(p.name)} ${choiceDisplay(p.choice!, env, configs.get(p.userId) ?? null)}`).join(', ')}`;
  const notesText = [...resA.notes, ...resB.notes].map(n => `<i>${n}</i>`).join('\n');

  if (isDone) {
    const winner = newScoreA > newScoreB ? 'A' : 'B';
    const finalText = `🏆 <b>Tim ${winner} menang!</b>\n${teamALine}\n${teamBLine}` +
      (notesText ? `\n${notesText}` : '');
    await Promise.allSettled(allPlayers.map(p => editInlineMessage(token, p.inlineMessageId, finalText)));
    await sendMessage(token, session.chatId, finalText);
    const winTeam = winner === 'A' ? session.teamA : session.teamB;
    const loseTeam = winner === 'A' ? session.teamB : session.teamA;
    for (const p of winTeam) {
      ctx.waitUntil(updateStats(kv, p.userId, 'win', p.choice!, loseTeam[0].userId, loseTeam[0].name, 1000, false, false));
    }
    for (const p of loseTeam) {
      ctx.waitUntil(updateStats(kv, p.userId, 'loss', p.choice!, winTeam[0].userId, winTeam[0].name, 1000, false, false));
    }
    await kv.put(`team:${session.gameId}`, JSON.stringify({ ...session, status: 'done', scoreA: newScoreA, scoreB: newScoreB }), { expirationTtl: 300 });
  } else {
    const outcomeText = roundOutcome === 'a' ? '🔵 Tim A menang round ini!'
      : roundOutcome === 'b' ? '🔴 Tim B menang round ini!' : '🤝 Draw!';
    const nextSession: TeamSession = {
      ...session,
      scoreA: newScoreA,
      scoreB: newScoreB,
      currentRound: session.currentRound + 1,
      teamA: session.teamA.map(p => ({ ...p, choice: null })),
      teamB: session.teamB.map(p => ({ ...p, choice: null })),
    };
    await kv.put(`team:${session.gameId}`, JSON.stringify(nextSession), { expirationTtl: 300 });
    const roundText =
      `Round ${session.currentRound}: ${outcomeText}\n${teamALine}\n${teamBLine}` +
      (notesText ? `\n${notesText}` : '') +
      `\n\nScore: 🔵 ${newScoreA} – ${newScoreB} 🔴\n\n⬇️ Round ${nextSession.currentRound}:`;
    const pickKb = teamPickKeyboard(session.gameId);
    await Promise.allSettled(allPlayers.map(p => editInlineMessage(token, p.inlineMessageId, roundText, pickKb)));
  }
}

export async function runTeamRound(
  token: string,
  kv: KVNamespace,
  session: TeamSession,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  const resA = resolveChoiceNoDice(session.teamA);
  const resB = resolveChoiceNoDice(session.teamB);

  if (resA === null || resB === null) {
    const tieA = resA === null ? getTiedPlayers(session.teamA) : null;
    const tieB = resB === null ? getTiedPlayers(session.teamB) : null;

    const state: TeamDiceWaitState = {
      gameId: session.gameId,
      chatId: session.chatId,
      teamSession: session,
      tieA,
      tieB,
      rollsA: [],
      rollsB: [],
      resolvedA: resA,
      resolvedB: resB,
    };
    await kv.put(`chat:dice_wait:${session.chatId}`, JSON.stringify(state), { expirationTtl: 300 });

    const tieLines: string[] = [];
    if (tieA) tieLines.push(`🔵 Tim A seri: ${tieA.map(p => `${escHtml(p.name)} ${EMOJI[p.choice]}`).join(' vs ')}`);
    if (tieB) tieLines.push(`🔴 Tim B seri: ${tieB.map(p => `${escHtml(p.name)} ${EMOJI[p.choice]}`).join(' vs ')}`);

    const resolveKb: InlineKeyboardMarkup = {
      inline_keyboard: [[{ text: '⏱️ Bot resolve (host)', callback_data: `teamdice:resolve:${session.gameId}` }]],
    };
    await sendMessage(token, session.chatId,
      `⚔️ <b>Seri internal!</b> Semua lempar 🎲 di grup!\n\n` +
      tieLines.join('\n') +
      `\n\n<i>Semua player yang seri harus lempar dadu — 🎲 tertinggi menang.</i>\n` +
      `<i>Tidak ada yang lempar? Tekan tombol di bawah.</i>`,
      resolveKb
    );
    await Promise.allSettled([...session.teamA, ...session.teamB].map(p =>
      editInlineMessage(token, p.inlineMessageId, '⏳ Menunggu tiebreaker dadu di grup...')
    ));
    return;
  }

  const configs = new Map<number, GameConfig | null>();
  await Promise.all([...session.teamA, ...session.teamB].map(async p => {
    configs.set(p.userId, await loadConfigAuthorized(kv, p.userId, env));
  }));
  await executeTeamRound(token, kv, session, resA, resB, env, ctx, configs);
}

// Called once all ties are resolved (by player dice or bot fallback).
export async function resolveTeamDiceWait(
  token: string,
  kv: KVNamespace,
  state: TeamDiceWaitState,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  if (!state.resolvedA || !state.resolvedB) return;
  await kv.delete(`chat:dice_wait:${state.chatId}`);
  const configs = new Map<number, GameConfig | null>();
  await Promise.all([...state.teamSession.teamA, ...state.teamSession.teamB].map(async p => {
    configs.set(p.userId, await loadConfigAuthorized(kv, p.userId, env));
  }));
  await executeTeamRound(token, kv, state.teamSession, state.resolvedA, state.resolvedB, env, ctx, configs);
}

// ── Tournament ────────────────────────────────────────────────────────────────

function shuffleArr<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function formatTournamentRound(
  matches: TournamentMatch[],
  roundNum: number,
  botUsername: string
): string {
  const lines = matches.map((m, i) => {
    const code = m.gameCode ? `\n  📋 Kode: <code>@${botUsername} ${m.gameCode}</code>` : '';
    const result = m.winner ? `\n  ✅ ${escHtml(m.winner.name)} menang` : '';
    return `Match ${i + 1}: <b>${escHtml(m.p1.name)}</b> vs <b>${escHtml(m.p2.name)}</b>${code}${result}`;
  });
  return `🏆 <b>Round ${roundNum}</b>\n━━━━━━━━━━━━━━\n${lines.join('\n\n')}`;
}

export function tournamentSignupText(tournament: TournamentSession): string {
  const playerList = tournament.players.length > 0
    ? '\n' + tournament.players.map((p, i) => `${i + 1}. ${escHtml(p.name)}`).join('\n')
    : '';
  return (
    `🏆 <b>Turnamen RPS</b> · ${tournament.maxPlayers} pemain\n` +
    `Host: ${escHtml(tournament.players[0]?.name ?? 'Menunggu...')}\n` +
    `Pendaftar: ${tournament.players.length}/${tournament.maxPlayers}` +
    playerList
  );
}

export function tournamentSignupKeyboard(tournamentId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '🤝 Daftar', callback_data: `tourjoin:${tournamentId}` },
        { text: '🚀 Mulai', callback_data: `tourstart:${tournamentId}` },
      ],
    ],
  };
}

export async function startTournamentBracket(
  token: string,
  kv: KVNamespace,
  tournament: TournamentSession,
  botUsername: string
): Promise<void> {
  const shuffled = shuffleArr(tournament.players);
  const round0: TournamentMatch[] = [];
  for (let i = 0; i < shuffled.length; i += 2) {
    const code = generateId();
    round0.push({
      matchId: `r0m${i / 2}`,
      p1: shuffled[i],
      p2: shuffled[i + 1],
      winner: null,
      gameCode: code,
    });
    await kv.put(`tournament:matchgame:${code}`, JSON.stringify({
      tournamentId: tournament.tournamentId,
      matchId: `r0m${i / 2}`,
    }), { expirationTtl: 600 });
  }
  const updated: TournamentSession = { ...tournament, status: 'active', currentRound: 0, rounds: [round0] };
  await kv.put(`tournament:${tournament.tournamentId}`, JSON.stringify(updated), { expirationTtl: 7200 });
  await sendMessage(token, tournament.chatId, formatTournamentRound(round0, 1, botUsername));
}

export async function advanceTournament(
  token: string,
  kv: KVNamespace,
  tournamentId: string,
  matchId: string,
  winner: TournamentPlayer,
  loser: TournamentPlayer,
  isDraw: boolean,
  botUsername: string
): Promise<void> {
  const tournament = await kv.get<TournamentSession>(`tournament:${tournamentId}`, 'json');
  if (!tournament || tournament.status !== 'active') return;
  const roundIdx = tournament.currentRound;
  const round = tournament.rounds[roundIdx];
  const matchIdx = round.findIndex(m => m.matchId === matchId);
  if (matchIdx < 0) return;
  const updatedRound = round.map((m, i) => i === matchIdx ? { ...m, winner } : m);
  const updatedRounds = [...tournament.rounds];
  updatedRounds[roundIdx] = updatedRound;
  const roundDone = updatedRound.every(m => m.winner !== null);
  if (!roundDone) {
    await kv.put(`tournament:${tournamentId}`, JSON.stringify({ ...tournament, rounds: updatedRounds }), { expirationTtl: 7200 });
    const drawNote = isDraw ? ' (menang undi)' : '';
    await sendMessage(token, tournament.chatId,
      `✅ <b>${escHtml(winner.name)}</b> menang${drawNote} vs ${escHtml(loser.name)}! Menunggu match lain...`
    );
    return;
  }
  const winners = updatedRound.map(m => m.winner!);
  if (winners.length === 1) {
    const finalWinner = winners[0];
    await kv.put(`tournament:${tournamentId}`,
      JSON.stringify({ ...tournament, rounds: updatedRounds, status: 'done', winner: finalWinner }),
      { expirationTtl: 3600 }
    );
    await sendMessage(token, tournament.chatId,
      `🏆 <b>Juara Tournament: ${escHtml(finalWinner.name)}!</b>\nSelamat! 🎉`
    );
    return;
  }
  // Next round
  const nextRoundIdx = roundIdx + 1;
  const nextMatches: TournamentMatch[] = [];
  for (let i = 0; i < winners.length; i += 2) {
    const code = generateId();
    nextMatches.push({ matchId: `r${nextRoundIdx}m${i / 2}`, p1: winners[i], p2: winners[i + 1], winner: null, gameCode: code });
    await kv.put(`tournament:matchgame:${code}`, JSON.stringify({ tournamentId, matchId: `r${nextRoundIdx}m${i / 2}` }), { expirationTtl: 600 });
  }
  const updated: TournamentSession = { ...tournament, rounds: [...updatedRounds, nextMatches], currentRound: nextRoundIdx };
  await kv.put(`tournament:${tournamentId}`, JSON.stringify(updated), { expirationTtl: 7200 });
  await sendMessage(token, tournament.chatId, formatTournamentRound(nextMatches, nextRoundIdx + 1, botUsername));
}

async function updateGroupLeaderboard(
  kv: KVNamespace,
  chatId: number,
  host: { userId: number; name: string },
  op: { userId: number; name: string },
  outcome: 'a' | 'b' | 'draw'
): Promise<void> {
  const key = `group:score:${chatId}`;
  const board = (await kv.get<LeaderboardEntry[]>(key, 'json')) ?? [];
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
  await kv.put(key, JSON.stringify(board.slice(0, 20)));
}

async function sendGroupStreakMention(
  kv: KVNamespace,
  token: string,
  userId: number,
  name: string,
  streak: number
): Promise<void> {
  const chatIdStr = await kv.get('config:daily_challenge_chat');
  if (!chatIdStr) return;
  const chatId = parseInt(chatIdStr);
  if (isNaN(chatId)) return;
  await sendMessage(token, chatId,
    `🔥 <b>${escHtml(name)}</b> baru capai streak <b>${streak}x</b> beruntun! Ada yang mau tantang? <code>@</code> · ${userId}`
  );
}

async function updatePinnedScoreboard(
  token: string,
  kv: KVNamespace,
  chatId: number
): Promise<void> {
  const [board, settings] = await Promise.all([
    kv.get<LeaderboardEntry[]>(`group:score:${chatId}`, 'json'),
    kv.get<{ pinnedMsgId?: number }>(`group:settings:${chatId}`, 'json'),
  ]);
  if (!board || board.length === 0) return;
  const lines = board.slice(0, 10).map((e, i) =>
    `${i + 1}. ${escHtml(e.name)} — ${e.wins}W / ${e.total - e.wins}L`
  );
  const updateTime = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const text = `📊 <b>SCOREBOARD GRUP</b>\nUpdate: ${updateTime} UTC\n━━━━━━━━━━━━━━\n${lines.join('\n')}`;
  if (settings?.pinnedMsgId) {
    await editMessage(token, chatId, settings.pinnedMsgId, text);
  } else {
    const msgId = await sendMessageForId(token, chatId, text);
    if (msgId) {
      await Promise.all([
        kv.put(`group:settings:${chatId}`, JSON.stringify({ ...(settings ?? {}), pinnedMsgId: msgId })),
        pinChatMessage(token, chatId, msgId),
      ]);
    }
  }
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

  // Pre-fetch lifetimes + donator tiers + group chat in one batch
  const [hostLifetime, opponentLifetime, hostDonator, opponentDonator, groupChatIdStr] = await Promise.all([
    kv.get<UserStats>(`stats:${session.hostUserId}`, 'json'),
    kv.get<UserStats>(`stats:${session.opponentUserId!}`, 'json'),
    kv.get<{ tier: string; expiry: number }>(`donator:${session.hostUserId}`, 'json'),
    kv.get<{ tier: string; expiry: number }>(`donator:${session.opponentUserId!}`, 'json'),
    kv.get(`group:game:${session.gameId}`),
  ]);
  const groupChatId = groupChatIdStr ? parseInt(groupChatIdStr) : null;
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
    ...(hasFeature(env, 'leaderboard') ? [
      updateLeaderboard(
        kv,
        { userId: session.hostUserId, name: session.hostName },
        { userId: session.opponentUserId!, name: session.opponentName! },
        matchOutcome
      ),
      updateDailyLeaderboard(
        kv,
        { userId: session.hostUserId, name: session.hostName },
        { userId: session.opponentUserId!, name: session.opponentName! },
        matchOutcome
      ),
    ] : []),
    ...(groupChatId && !isNaN(groupChatId) ? [updateGroupLeaderboard(
      kv, groupChatId,
      { userId: session.hostUserId, name: session.hostName },
      { userId: session.opponentUserId!, name: session.opponentName! },
      matchOutcome
    )] : []),
  ]);

  const hostStats = hostResult.stats;
  const opponentStats = opponentResult.stats;

  // Streak milestone DMs + group mention (fire-and-forget)
  if (hostResult.notifyStreak) {
    ctx.waitUntil(sendMessage(token, session.hostUserId,
      `🔥 Streak <b>${hostResult.notifyStreak}x</b> beruntun! Luar biasa! 🏆`
    ));
    ctx.waitUntil(sendGroupStreakMention(kv, token, session.hostUserId, session.hostName, hostResult.notifyStreak));
  }
  if (opponentResult.notifyStreak) {
    ctx.waitUntil(sendMessage(token, session.opponentUserId!,
      `🔥 Streak <b>${opponentResult.notifyStreak}x</b> beruntun! Luar biasa! 🏆`
    ));
    ctx.waitUntil(sendGroupStreakMention(kv, token, session.opponentUserId!, session.opponentName!, opponentResult.notifyStreak));
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

  if (session.tournamentId && session.tournamentMatchId) {
    const isHostWinner = matchOutcome === 'a' || (matchOutcome === 'draw' && Math.random() < 0.5);
    const tWinner = isHostWinner
      ? { userId: session.hostUserId, name: session.hostName }
      : { userId: session.opponentUserId!, name: session.opponentName! };
    const tLoser = isHostWinner
      ? { userId: session.opponentUserId!, name: session.opponentName! }
      : { userId: session.hostUserId, name: session.hostName };
    ctx.waitUntil(advanceTournament(token, kv, session.tournamentId, session.tournamentMatchId, tWinner, tLoser, matchOutcome === 'draw', env.BOT_USERNAME));
  }

  if (groupChatId && !isNaN(groupChatId) && hasFeature(env, 'group_mode')) {
    ctx.waitUntil(updatePinnedScoreboard(token, kv, groupChatId));
  }
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
    loadConfigAuthorized(kv, session.hostUserId, env),
    loadConfigAuthorized(kv, session.opponentUserId!, env),
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

// ─── Last Man Standing ───────────────────────────────────────────────────────

export function runLmsElimination(activePlayers: LmsPlayer[]): {
  survivors: LmsPlayer[];
  eliminated: LmsPlayer[];
  isChaos: boolean;
} {
  const choices = activePlayers.map(p => p.choice!);
  const unique = [...new Set(choices)] as Choice[];

  if (unique.length !== 2) {
    // All same or all 3 present → chaos round, no elimination
    return { survivors: activePlayers, eliminated: [], isChaos: true };
  }

  const [a, b] = unique;
  const losingChoice = determineWinner(a, b) === 'a' ? b : a;
  return {
    survivors: activePlayers.filter(p => p.choice !== losingChoice),
    eliminated: activePlayers.filter(p => p.choice === losingChoice),
    isChaos: false,
  };
}

export function lmsPickKeyboard(gameId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [[
      { text: '✊', callback_data: `lmspick:${gameId}:rock` },
      { text: '✋', callback_data: `lmspick:${gameId}:paper` },
      { text: '✌️', callback_data: `lmspick:${gameId}:scissors` },
    ]],
  };
}

export function lmsWaitingText(session: LmsSession): string {
  const slots = session.maxPlayers - session.players.length;
  const expiryStr = expiryTimeStr(session.createdAt);
  const list = session.players.map(p => `• ${escHtml(p.name)}`).join('\n');
  return `⚔️ <b>Last Man Standing</b> (${session.maxPlayers} players)\n\n${list}\n\n` +
    (slots > 0
      ? `⏳ Waiting for ${slots} more player${slots > 1 ? 's' : ''}...\n⏰ Berlaku hingga ${expiryStr}`
      : '🚀 Starting!');
}

export async function runLmsRound(
  token: string,
  kv: KVNamespace,
  session: LmsSession,
  ctx: ExecutionContext,
  env: Env
): Promise<void> {
  const activePlayers = session.players.filter(p => p.active);
  if (activePlayers.length <= 1) return;

  const configs = new Map<number, GameConfig | null>();
  await Promise.all(session.players.map(async p => {
    configs.set(p.userId, await loadConfigAuthorized(kv, p.userId, env));
  }));

  const { survivors, eliminated, isChaos } = runLmsElimination(activePlayers);

  const roundRecord: LmsRoundRecord = {
    choices: activePlayers.map(p => ({ userId: p.userId, choice: p.choice! })),
    eliminated: eliminated.map(p => p.userId),
    isChaos,
  };

  const eliminatedIds = new Set(eliminated.map(p => p.userId));

  // Reveal: each active player briefly sees their own choice emoji
  await Promise.allSettled(activePlayers.map(p =>
    editInlineMessage(token, p.inlineMessageId, revealEmoji(p.choice!, env, configs.get(p.userId) ?? null))
  ));
  await sleep(3000);

  if (!isChaos && survivors.length === 1) {
    // ── Game over ──
    const winner = survivors[0];
    const allLines = session.players.map(p => {
      const isOut = !p.active || eliminatedIds.has(p.userId);
      return `${escHtml(p.name)}: ${choiceDisplay(p.choice!, env, configs.get(p.userId) ?? null)}${isOut ? ' ❌' : ' 🏆'}`;
    }).join('\n');
    const winText = `🏆 <b>${escHtml(winner.name)} wins Last Man Standing!</b>\n━━━━━━━━━━━━━━\n${allLines}`;

    const doneSession: LmsSession = {
      ...session,
      players: session.players.map(p => ({
        ...p,
        active: p.userId === winner.userId,
      })),
      status: 'done',
      roundHistory: [...session.roundHistory, roundRecord],
    };
    await kv.put(`lms:${session.gameId}`, JSON.stringify(doneSession), { expirationTtl: 600 });
    await Promise.allSettled(
      session.players.map(p => editInlineMessage(token, p.inlineMessageId, winText))
    );
    // Stats: 1 win for winner, 1 loss for each loser
    ctx.waitUntil(updateStats(kv, winner.userId, 'win', winner.choice!, 0, 'LMS', 1000, false, false));
    for (const loser of session.players.filter(p => p.userId !== winner.userId)) {
      ctx.waitUntil(updateStats(kv, loser.userId, 'loss', loser.choice!, winner.userId, winner.name, 1000, false, false));
    }
    return;
  }

  // ── Show round result, set up next round ──
  const allLines = session.players.map(p => {
    if (!p.active) return `${escHtml(p.name)}: ❌`;
    const isNowElim = eliminatedIds.has(p.userId);
    return `${escHtml(p.name)}: ${choiceDisplay(p.choice!, env, configs.get(p.userId) ?? null)}${isNowElim ? ' ❌' : ''}`;
  }).join('\n');

  const header = isChaos
    ? `😱 <b>Chaos! Round ${session.currentRound}</b> — No elimination`
    : `🔥 <b>Round ${session.currentRound}</b>`;
  const roundText = `${header}\n${allLines}`;

  const nextRound = session.currentRound + 1;
  const updatedPlayers = session.players.map(p => ({
    ...p,
    active: p.active && !eliminatedIds.has(p.userId),
    choice: (p.active && !eliminatedIds.has(p.userId)) ? null : p.choice,
  }));
  const updatedSession: LmsSession = {
    ...session,
    players: updatedPlayers,
    status: 'playing',
    currentRound: nextRound,
    roundHistory: [...session.roundHistory, roundRecord],
  };
  await kv.put(`lms:${session.gameId}`, JSON.stringify(updatedSession), { expirationTtl: 300 });

  // Show round result with next-round button for survivors; elimination notice for newly eliminated
  const nextRoundKb: InlineKeyboardMarkup = {
    inline_keyboard: [[{ text: `▶️ Round ${nextRound}`, switch_inline_query_current_chat: session.gameId }]],
  };
  await Promise.allSettled([
    ...updatedPlayers.filter(p => p.active).map(p =>
      editInlineMessage(token, p.inlineMessageId, roundText, nextRoundKb)
    ),
    ...session.players.filter(p => eliminatedIds.has(p.userId)).map(p =>
      editInlineMessage(token, p.inlineMessageId, roundText + '\n\n❌ Kamu eliminasi di ronde ini.')
    ),
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
