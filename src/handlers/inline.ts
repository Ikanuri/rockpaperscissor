import type {
  ChainMeta,
  Choice,
  ChosenInlineResult,
  Env,
  GameConfig,
  GameMode,
  GameSession,
  InlineKeyboardMarkup,
  InlineQuery,
  InlineResult,
  LastGameRecord,
  LeaderboardEntry,
  LmsPlayer,
  LmsSession,
  OpenChallenge,
  TeamPlayer,
  TeamSession,
  UserStats,
  VsStats,
} from '../types';
import { answerInlineQuery, editInlineMessage, getChatMember, sendMessage } from '../telegram';
import {
  EMOJI,
  determineWinner,
  escHtml,
  formatUser,
  generateId,
  lmsHostKeyboard,
  lmsJoinKeyboard,
  lmsWaitingText,
  loadConfigAuthorized,
  runLmsRound,
  runRevealAndResult,
  runTeamRound,
  teamWaitingKeyboard,
  teamWaitingText,
  trackHostedGame,
  updateStats,
  waitingKeyboard,
  waitingText,
} from '../game';
import { hasFeature, isBetaUser } from '../feature';
import { loadDonatorTier } from '../donator';

const GAME_ID_RE = /^[A-Z2-9]{6}$/;
const CHAIN_CODE_RE = /^R[A-Z2-9]{6}$/;
// LMS game codes: L + 6 random chars = 7 chars
const LMS_CODE_RE = /^L[A-Z2-9]{6}$/;
// Team game codes: T + 6 random chars = 7 chars
const TEAM_CODE_RE = /^T[A-Z2-9]{6}$/;
// @USERNAME or @USERNAME BO3/BO5/BO7 — private challenge
const PRIVATE_RE = /^@(\w{1,32})(?:\s+(BO[357]))?$/;
// Ranked mode: RANKED [BO3/BO5/BO7]
const RANKED_RE = /^RANKED(?:\s+(BO[357]))?$/;
// LMS creation: LMS or LMS N (3–8 players)
const LMS_RE = /^LMS(?:\s+(\d+))?$/;
// Team creation: TEAM NvN [BO3/BO5/BO7]
const TEAM_RE = /^TEAM\s+(\d+)V(\d+)(?:\s+(BO[357]))?$/;
// Team join: TJOIN <T+6char> A|B
const TJOIN_RE = /^TJOIN\s+(T[A-Z2-9]{6})\s+([AB])$/;
// Head-to-head: VS @username
const VS_RE = /^VS\s+@(\w{1,32})$/;
// Custom game code: 2–20 alphanumeric chars (must not match other patterns)
const CUSTOM_CODE_RE = /^[A-Z0-9]{2,20}$/;
const RESERVED_CODES = new Set(['TOP', 'STATS', 'CLEARHOST', 'SYNCSTATS', 'BO3', 'BO5', 'BO7', 'START', 'HELP', 'RANKED', 'LAST', 'BOT', 'VS', 'LMS', 'OPEN', 'TEAM', 'TJOIN']);

function parseMode(s: string): GameMode {
  if (s === 'BO3') return 'best_of_3';
  if (s === 'BO5') return 'best_of_5';
  if (s === 'BO7') return 'best_of_7';
  return 'single';
}

function isCustomCode(q: string): boolean {
  // LMS/Team join codes look like custom codes but are routed via KV — exclude by prefix pattern
  return CUSTOM_CODE_RE.test(q) && !RESERVED_CODES.has(q)
    && !GAME_ID_RE.test(q) && !CHAIN_CODE_RE.test(q)
    && !TEAM_CODE_RE.test(q);
}

async function maybeAnnounceGame(
  token: string,
  kv: KVNamespace,
  session: GameSession,
  botUsername: string
): Promise<void> {
  const key = `group:announce:${session.hostUserId}`;
  const chatIdStr = await kv.get(key);
  if (!chatIdStr) return;
  const chatId = parseInt(chatIdStr);
  if (isNaN(chatId)) return;
  // Delete announce key + persist group association for this game (for per-group stats)
  await Promise.all([
    kv.delete(key),
    kv.put(`group:game:${session.gameId}`, String(chatId), { expirationTtl: 600 }),
  ]);
  const joinCode = session.chainId ?? session.gameId;
  const extras: string[] = [];
  if (session.ranked) extras.push('🏆 Ranked');
  if (session.mode === 'best_of_3') extras.push('Best of 3');
  else if (session.mode === 'best_of_5') extras.push('Best of 5');
  else if (session.mode === 'best_of_7') extras.push('Best of 7');
  const suffix = extras.length ? ` · ${extras.join(' · ')}` : '';
  await sendMessage(token, chatId,
    `🎮 <b>${escHtml(session.hostName)}</b> mulai game RPS${suffix}!\n` +
    `Siapa mau lawan? Ketik <code>@${botUsername} ${joinCode}</code> 👆`
  );
}
const CHOICES: Choice[] = ['rock', 'paper', 'scissors'];

const PLACEHOLDER_KEYBOARD = {
  inline_keyboard: [[{ text: '⏳', callback_data: 'loading' }]],
};

const LABELS: Record<Choice, string> = {
  rock: '✊ Rock',
  paper: '✋ Paper',
  scissors: '✌️ Scissors',
};

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildChoiceResults(initText: string, env: Env, config?: GameConfig | null): InlineResult[] {
  const envAny = env as unknown as Record<string, string>;

  const choices = shuffle(CHOICES).map(choice => {
    // Config-based: sticker popup
    if (config?.sticker[choice]) {
      return {
        type: 'sticker' as const,
        id: choice,
        sticker_file_id: config.sticker[choice]!,
        input_message_content: { message_text: initText },
        reply_markup: PLACEHOLDER_KEYBOARD,
      };
    }
    // Config-based: gif thumbnail
    if (config?.thumb[choice]?.type === 'gif') {
      return {
        type: 'gif' as const,
        id: choice,
        gif_file_id: config.thumb[choice]!.value,
        title: LABELS[choice],
        input_message_content: { message_text: initText },
        reply_markup: PLACEHOLDER_KEYBOARD,
      };
    }
    // Env-based: sticker (when no per-user config)
    if (!config) {
      const stickerId = envAny[`STICKER_${choice.toUpperCase()}`];
      if (stickerId) {
        return {
          type: 'sticker' as const,
          id: choice,
          sticker_file_id: stickerId,
          input_message_content: { message_text: initText },
          reply_markup: PLACEHOLDER_KEYBOARD,
        };
      }
    }
    // Article with optional url thumbnail
    const thumbUrl = config?.thumb[choice]?.type === 'url' ? config.thumb[choice]!.value : undefined;
    return {
      type: 'article' as const,
      id: choice,
      title: LABELS[choice],
      input_message_content: { message_text: initText },
      reply_markup: PLACEHOLDER_KEYBOARD,
      ...(thumbUrl && { thumbnail_url: thumbUrl }),
    };
  });

  const randomResult: InlineResult = {
    type: 'article',
    id: 'random',
    title: '🎲 Random',
    description: 'Let fate decide',
    input_message_content: { message_text: initText },
    reply_markup: PLACEHOLDER_KEYBOARD,
  };

  return [randomResult, ...choices];
}

function resolveChoice(resultId: string): Choice {
  if (CHOICES.includes(resultId as Choice)) return resultId as Choice;
  return CHOICES[Math.floor(Math.random() * 3)];
}

function statsResult(stats: UserStats): InlineResult {
  const choiceEntries = Object.entries(stats.choices ?? {}).sort(([, a], [, b]) => b - a);
  const favLine = choiceEntries.length
    ? `\n🎯 Fav: ${EMOJI[choiceEntries[0][0] as Choice]} (${choiceEntries[0][1]}x)`
    : '';

  const currentStreak = stats.currentStreak ?? 0;
  const longestStreak = stats.longestStreak ?? 0;

  let streakBlock = '';
  if (currentStreak > 0 || longestStreak > 0) {
    streakBlock = `\n\n🔥 <b>Streak</b>\n`;
    if (currentStreak >= 2) streakBlock += `Sekarang: ${currentStreak} win beruntun\n`;
    if (longestStreak > 0) streakBlock += `Terpanjang: ${longestStreak}x`;

    const dayS = stats.dayStreak ?? 0;
    const weekS = stats.weekStreak ?? 0;
    const monthS = stats.monthStreak ?? 0;
    if (dayS > 0 || weekS > 0 || monthS > 0) {
      streakBlock += '\n';
      if (dayS > 0) streakBlock += `\n  📅 Hari ini: ${dayS}x`;
      if (weekS > 0) streakBlock += `\n  📅 Minggu ini: ${weekS}x`;
      if (monthS > 0) streakBlock += `\n  📅 Bulan ini: ${monthS}x`;
    }
  }

  let vsLine = '';
  if ((stats.longestVsStreak ?? 0) > 0) {
    const vsName = stats.longestVsOpponentName ? escHtml(stats.longestVsOpponentName) : '';
    const vsId = stats.longestVsOpponentId ?? '';
    vsLine = `\n\n🏅 Vs satu lawan: ${stats.longestVsStreak}x` +
      (vsName ? ` (vs ${vsName}${vsId ? ` · ${vsId}` : ''})` : '');
  }

  const weekWins = stats.weekWins ?? 0;
  const weekLosses = stats.weekLosses ?? 0;
  const weekDraws = stats.weekDraws ?? 0;
  const weekLine = (weekWins + weekLosses + weekDraws) > 0
    ? `\n\n📅 <b>This week</b>\n🏆 ${weekWins}W · 😔 ${weekLosses}L · 🤝 ${weekDraws}D`
    : '';

  const streakTitle = currentStreak >= 2 ? ` 🔥${currentStreak}` : '';

  const eloLine = stats.rating !== undefined ? `\n⚡ ELO: ${stats.rating}` : '';

  const achCount = Object.keys(stats.achievements ?? {}).length;
  const achLine = achCount > 0 ? `\n\n🏅 ${achCount} achievement${achCount > 1 ? 's' : ''} dibuka` : '';

  return {
    type: 'article',
    id: 'stats',
    title: `📊 ${stats.wins}W / ${stats.losses}L / ${stats.draws}D — ${stats.total} games${streakTitle}`,
    description: `This week: ${weekWins}W ${weekLosses}L ${weekDraws}D`,
    input_message_content: {
      message_text:
        `📊 <b>My RPS Stats</b>\n━━━━━━━━━━━━━━\n` +
        `🏆 Wins: ${stats.wins}\n😔 Losses: ${stats.losses}\n🤝 Draws: ${stats.draws}\n📈 Total: ${stats.total}${favLine}${eloLine}` +
        streakBlock + vsLine + weekLine + achLine,
      parse_mode: 'HTML',
    },
  };
}

function formatLastGame(last: LastGameRecord): string {
  const myE = EMOJI[last.myChoice];
  const oppE = EMOJI[last.opponentChoice];
  const outcomeText = last.outcome === 'win' ? '🏆 Kamu menang!'
    : last.outcome === 'loss' ? '😔 Kalah' : '🤝 Draw!';
  const rankedLabel = last.ranked ? ' · 🏆 Ranked' : '';
  const timeStr = new Date(last.at).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  return `📽️ <b>Game terakhirmu</b>\n━━━━━━━━━━━━━━\n` +
    `${outcomeText}${rankedLabel}\n` +
    `Kamu: ${myE}  vs  ${escHtml(last.opponentName)}: ${oppE}\n` +
    `🕐 ${timeStr}`;
}

export async function handleInlineQuery(query: InlineQuery, env: Env): Promise<void> {
  const q = query.query.trim().toUpperCase();
  const token = env.BOT_TOKEN;
  const kv = env.GAME_SESSIONS;
  const { from } = query;

  // Force-start gate: user must DM /start before playing inline
  const userInfo = await kv.get(`user:info:${from.id}`);
  if (!userInfo) {
    await answerInlineQuery(token, query.id, [{
      type: 'article',
      id: 'start_required',
      title: '⚠️ Start bot dulu sebelum main',
      description: `Buka chat dengan @${env.BOT_USERNAME} lalu ketik /start`,
      input_message_content: { message_text: `Buka @${env.BOT_USERNAME} dan ketik /start untuk bisa main! 👋` },
    }]);
    return;
  }

  // Beta gate: when enabled, only owner + approved beta users can play inline
  if (hasFeature(env, 'beta_gate') && String(from.id) !== env.BOT_OWNER_ID) {
    const approved = await isBetaUser(kv, from.id, env.BOT_OWNER_ID);
    if (!approved) {
      await answerInlineQuery(token, query.id, [{
        type: 'article',
        id: 'beta_only',
        title: '🔒 Beta access only',
        description: 'Bot ini masih beta. Hubungi admin untuk mendapat akses.',
        input_message_content: { message_text: '🔒 Bot ini masih dalam beta testing. Hubungi admin untuk mendapat akses.' },
      }]);
      return;
    }
  }

  if (q === 'TOP' && hasFeature(env, 'leaderboard')) {
    const board = (await kv.get<LeaderboardEntry[]>('leaderboard', 'json')) ?? [];
    const lines = board.slice(0, 20).map((e, i) =>
      `${i + 1}. ${escHtml(e.name)} — ${e.wins}W / ${e.total - e.wins}L`
    );
    const text = board.length === 0
      ? '📊 Leaderboard is empty. Play some games!'
      : `🏆 <b>Top ${board.length} Players</b>\n━━━━━━━━━━━━━━\n${lines.join('\n')}`;
    await answerInlineQuery(token, query.id, [{
      type: 'article',
      id: 'leaderboard',
      title: board.length > 0 ? `🏆 #1: ${board[0].name} (${board[0].wins}W)` : '🏆 Leaderboard',
      description: board.length > 0 ? `Top ${board.length} players this season` : 'No data yet',
      input_message_content: { message_text: text, parse_mode: 'HTML' },
    }]);
    return;
  }

  if (q === 'CLEARHOST') {
    await answerInlineQuery(token, query.id, [{
      type: 'article',
      id: 'clearhost',
      title: '🧹 Cancel all my hosted games',
      description: "Removes all waiting games you're currently hosting",
      input_message_content: { message_text: '🧹 Cancelling hosted games...' },
      reply_markup: PLACEHOLDER_KEYBOARD,
    }]);
    return;
  }

  if (q === 'SYNCSTATS') {
    await answerInlineQuery(token, query.id, [{
      type: 'article',
      id: 'syncstats',
      title: '🔄 Sync weekly stats',
      description: 'Copy your all-time stats to this week',
      input_message_content: { message_text: '🔄 Syncing stats...' },
      reply_markup: PLACEHOLDER_KEYBOARD,
    }]);
    return;
  }

  if (q === 'STATS') {
    const s = (await kv.get<UserStats>(`stats:${from.id}`, 'json')) ?? { wins: 0, losses: 0, draws: 0, total: 0 };
    await answerInlineQuery(token, query.id, [statsResult(s)]);
    return;
  }

  if (q === 'LAST') {
    const last = await kv.get<LastGameRecord>(`stats:${from.id}:last`, 'json');
    const text = last ? formatLastGame(last) : '❌ Belum ada game yang dimainkan.';
    const title = last
      ? `📽️ Kamu ${EMOJI[last.myChoice]} vs ${escHtml(last.opponentName)} ${EMOJI[last.opponentChoice]} — ${last.outcome}`
      : '📽️ Belum ada game';
    await answerInlineQuery(token, query.id, [{
      type: 'article', id: 'last', title,
      description: last ? new Date(last.at).toISOString().slice(0, 10) : 'Play a game first',
      input_message_content: { message_text: text, parse_mode: 'HTML' },
    }]);
    return;
  }

  if (q === 'BOT') {
    const config = hasFeature(env, 'gif_thumb') ? await loadConfigAuthorized(kv, from.id, env) : null;
    await answerInlineQuery(token, query.id, buildChoiceResults('🤖 vs Bot', env, config));
    return;
  }

  const vsMatch = VS_RE.exec(q);
  if (vsMatch) {
    const username = vsMatch[1].toLowerCase();
    const targetIdStr = await kv.get(`user:by_username:${username}`);
    if (!targetIdStr) {
      await answerInlineQuery(token, query.id, [{
        type: 'article', id: 'vs_notfound',
        title: `❌ @${vsMatch[1]} not found`,
        description: 'Player belum pernah main atau belum /start',
        input_message_content: { message_text: `❌ @${vsMatch[1]} belum ditemukan. Minta mereka /start dulu.` },
      }]);
      return;
    }
    const opponentId = parseInt(targetIdStr);
    const [vs, opponentInfo] = await Promise.all([
      kv.get<VsStats>(`stats:${from.id}:vs:${opponentId}`, 'json'),
      kv.get<{ name: string; username: string | null }>(`user:info:${opponentId}`, 'json'),
    ]);
    const opponentName = opponentInfo?.name ?? vsMatch[1];
    if (!vs || vs.total === 0) {
      await answerInlineQuery(token, query.id, [{
        type: 'article', id: 'vs_empty',
        title: `📊 vs @${vsMatch[1]}: belum ada game`,
        description: 'Belum pernah main vs player ini',
        input_message_content: { message_text: `📊 Kamu belum pernah main vs @${vsMatch[1]}.` },
      }]);
      return;
    }
    const winRate = Math.round((vs.wins / vs.total) * 100);
    const vsText = `📊 <b>Kamu vs @${vsMatch[1]}</b>\n━━━━━━━━━━━━━━\n` +
      `🏆 ${vs.wins}W · 😔 ${vs.losses}L · 🤝 ${vs.draws}D\n` +
      `📈 ${vs.total} game · ${winRate}% win rate\n` +
      ((vs.longestStreak ?? 0) > 0 ? `🔥 Streak terpanjang: ${vs.longestStreak}x\n` : '') +
      ((vs.currentStreak ?? 0) >= 2 ? `⚡ Streak saat ini: ${vs.currentStreak}x` : '');
    await answerInlineQuery(token, query.id, [{
      type: 'article', id: 'vs',
      title: `📊 vs ${escHtml(opponentName)}: ${vs.wins}W / ${vs.losses}L / ${vs.draws}D`,
      description: `${vs.total} game · ${winRate}% win rate`,
      input_message_content: { message_text: vsText, parse_mode: 'HTML' },
    }]);
    return;
  }

  // Team creation: TEAM NvN [BO3]
  const teamQueryMatch = TEAM_RE.exec(q);
  if (teamQueryMatch) {
    const chatIdStr = await kv.get(`team_chat:${from.id}`);
    if (!chatIdStr) {
      await answerInlineQuery(token, query.id, [{
        type: 'article', id: 'err',
        title: '⚠️ Setup dulu di grup',
        description: 'Ketik /team NvN di grup yang ingin digunakan, lalu coba lagi.',
        input_message_content: { message_text: 'Ketik /team NvN di grup dulu, lalu buka @botname TEAM NvN.' },
      }]);
      return;
    }
    const n = Math.min(4, Math.max(1, parseInt(teamQueryMatch[1])));
    const modeLabel = teamQueryMatch[3] ? ` ${teamQueryMatch[3]}` : '';
    const config = hasFeature(env, 'gif_thumb') ? await loadConfigAuthorized(kv, from.id, env) : null;
    await answerInlineQuery(token, query.id, buildChoiceResults(`⚔️ Team ${n}v${n}${modeLabel}`, env, config));
    return;
  }

  // Team join: TJOIN <gameId> A|B
  const tjoinMatch = TJOIN_RE.exec(q);
  if (tjoinMatch) {
    const gameId = tjoinMatch[1];
    const teamSess = await kv.get<TeamSession>(`team:${gameId}`, 'json');
    if (!teamSess || teamSess.status !== 'waiting') {
      await answerInlineQuery(token, query.id, [{
        type: 'article', id: 'err', title: '❌ Game tidak ditemukan',
        description: 'Team game sudah penuh atau tidak ada.',
        input_message_content: { message_text: '❌ Team game tidak ditemukan atau sudah penuh.' },
      }]);
      return;
    }
    const team = tjoinMatch[2] as 'A' | 'B';
    const targetTeam = team === 'A' ? teamSess.teamA : teamSess.teamB;
    if (targetTeam.length >= teamSess.teamSize) {
      await answerInlineQuery(token, query.id, [{
        type: 'article', id: 'err', title: `❌ Tim ${team} sudah penuh`,
        description: 'Coba tim yang lain.',
        input_message_content: { message_text: `❌ Tim ${team} sudah penuh.` },
      }]);
      return;
    }
    if ([...teamSess.teamA, ...teamSess.teamB].some(p => p.userId === from.id)) {
      await answerInlineQuery(token, query.id, [{
        type: 'article', id: 'already', title: '✅ Sudah bergabung',
        description: 'Kamu sudah ada di game ini.',
        input_message_content: { message_text: '✅ Kamu sudah bergabung di game ini.' },
      }]);
      return;
    }
    const config = hasFeature(env, 'gif_thumb') ? await loadConfigAuthorized(kv, from.id, env) : null;
    await answerInlineQuery(token, query.id, buildChoiceResults(`🤝 Join Tim ${team}`, env, config));
    return;
  }

  // LMS creation: LMS or LMS N
  const lmsQueryMatch = LMS_RE.exec(q);
  if (lmsQueryMatch) {
    const rateKeyLq = `ratelimit:${from.id}`;
    const activeLq = parseInt(await kv.get(rateKeyLq) ?? '0');
    if (activeLq >= 3) {
      await answerInlineQuery(token, query.id, [{
        type: 'article', id: 'err', title: '⏳ Too many active games',
        description: 'You already have 3 active games. Finish them first!',
        input_message_content: { message_text: '⏳ Too many active games.' },
      }]);
      return;
    }
    const n = lmsQueryMatch[1] ? Math.min(8, Math.max(3, parseInt(lmsQueryMatch[1]))) : 4;
    const configLq = hasFeature(env, 'gif_thumb') ? await loadConfigAuthorized(kv, from.id, env) : null;
    await answerInlineQuery(token, query.id, buildChoiceResults(`⚔️ LMS (${n} players)`, env, configLq));
    return;
  }

  // LMS join by code (waiting) or pick for next round (playing)
  if (LMS_CODE_RE.test(q)) {
    const lmsQ = await kv.get<LmsSession>(`lms:${q}`, 'json');
    if (lmsQ) {
      if (lmsQ.status === 'playing') {
        const lmsQPlayer = lmsQ.players.find(p => p.userId === from.id);
        if (!lmsQPlayer || !lmsQPlayer.active) {
          await answerInlineQuery(token, query.id, [{
            type: 'article', id: 'lms_elim', title: '❌ Kamu sudah eliminasi',
            description: 'Game masih berlanjut, tapi kamu tidak bisa lanjut.',
            input_message_content: { message_text: '❌ Kamu sudah eliminasi dari game ini.' },
          }]);
          return;
        }
        if (lmsQPlayer.choice !== null) {
          await answerInlineQuery(token, query.id, [{
            type: 'article', id: 'lms_wait', title: `✅ ${EMOJI[lmsQPlayer.choice]} dikunci`,
            description: 'Menunggu pemain lain memilih...',
            input_message_content: { message_text: `✅ ${EMOJI[lmsQPlayer.choice]} sudah dikunci. Menunggu pemain lain...` },
          }]);
          return;
        }
        const configLqP = hasFeature(env, 'gif_thumb') ? await loadConfigAuthorized(kv, from.id, env) : null;
        await answerInlineQuery(token, query.id, buildChoiceResults(`⚔️ Round ${lmsQ.currentRound}`, env, configLqP));
        return;
      }
      if (lmsQ.status === 'waiting') {
        if (lmsQ.players.some(p => p.userId === from.id)) {
          await answerInlineQuery(token, query.id, [{
            type: 'article', id: 'already', title: '✅ Already in this game',
            description: 'You already joined this LMS game.',
            input_message_content: { message_text: '✅ Already joined. Waiting for others...' },
          }]);
          return;
        }
        if (lmsQ.players.length >= lmsQ.maxPlayers) {
          await answerInlineQuery(token, query.id, [{
            type: 'article', id: 'err', title: '❌ Game is full',
            description: `${lmsQ.maxPlayers}/${lmsQ.maxPlayers} players joined.`,
            input_message_content: { message_text: '❌ LMS game is full.' },
          }]);
          return;
        }
        const configLqJ = hasFeature(env, 'gif_thumb') ? await loadConfigAuthorized(kv, from.id, env) : null;
        await answerInlineQuery(token, query.id, buildChoiceResults('⚔️ Join LMS!', env, configLqJ));
        return;
      }
    }
    // LMS game not found or done — fall through to custom code / new game
  }

  // Open Challenge
  if (q === 'OPEN') {
    const openList = ((await kv.get<OpenChallenge[]>('open:list', 'json')) ?? [])
      .filter(c => c.hostUserId !== from.id && Date.now() - c.createdAt < 9 * 60 * 1000);
    const configOq = hasFeature(env, 'gif_thumb') ? await loadConfigAuthorized(kv, from.id, env) : null;
    const createResults = buildChoiceResults('🌐 Open Challenge', env, configOq);
    if (openList.length === 0) {
      await answerInlineQuery(token, query.id, createResults);
      return;
    }
    const joinArticles: InlineResult[] = openList.slice(0, 4).map(c => ({
      type: 'article' as const,
      id: `open_join_${c.gameId}`,
      title: `⚔️ Join ${escHtml(c.hostName)}`,
      description: `Open challenge · ${Math.floor((Date.now() - c.createdAt) / 60000)}m ago`,
      input_message_content: { message_text: `⚔️ Joining ${escHtml(c.hostName)}'s open challenge...` },
      reply_markup: {
        inline_keyboard: [[{
          text: '⚔️ Join',
          switch_inline_query_current_chat: c.gameId,
        }]],
      },
    }));
    await answerInlineQuery(token, query.id, [...joinArticles, ...createResults]);
    return;
  }

  // Ranked mode: RANKED [BO3/BO5/BO7]
  const rankedQueryMatch = RANKED_RE.exec(q);
  if (rankedQueryMatch) {
    const rateKeyR = `ratelimit:${from.id}`;
    const activeR = parseInt(await kv.get(rateKeyR) ?? '0');
    if (activeR >= 3) {
      await answerInlineQuery(token, query.id, [{
        type: 'article', id: 'err', title: '⏳ Too many active games',
        description: 'You already have 3 active games. Finish them first!',
        input_message_content: { message_text: '⏳ Too many active games.' },
      }]);
      return;
    }
    const configR = hasFeature(env, 'gif_thumb') ? await loadConfigAuthorized(kv, from.id, env) : null;
    const modeLabelR = rankedQueryMatch[1] ? ` ${rankedQueryMatch[1]}` : '';
    await answerInlineQuery(token, query.id, buildChoiceResults(`🏆 Ranked${modeLabelR}`, env, configR));
    return;
  }

  // Chain rematch code
  if (CHAIN_CODE_RE.test(q)) {
    const meta = await kv.get<ChainMeta>(`chain:${q}:meta`, 'json');
    if (!meta) {
      await answerInlineQuery(token, query.id, [{
        type: 'article', id: 'err', title: '❌ Rematch expired',
        description: 'Start a new game instead.',
        input_message_content: { message_text: '❌ Rematch expired. Start a new game.' },
      }]);
      return;
    }
    if (from.id !== meta.hostUserId && from.id !== meta.opponentUserId) {
      await answerInlineQuery(token, query.id, [{
        type: 'article', id: 'err', title: '❌ Not your game',
        description: 'This rematch is for the original players only.',
        input_message_content: { message_text: '❌ Not your game.' },
      }]);
      return;
    }
    const config = hasFeature(env, 'gif_thumb') ? await loadConfigAuthorized(kv, from.id, env) : null;
    await answerInlineQuery(token, query.id, buildChoiceResults('🔄 Rematch!', env, config));
    return;
  }

  // Regular game join by code
  if (GAME_ID_RE.test(q)) {
    const session = await kv.get<GameSession>(`game:${q}`, 'json');

    if (!session) {
      // Check if this is a tournament match code
      const tmInfo = await kv.get<{ tournamentId: string; matchId: string }>(`tournament:matchgame:${q}`, 'json');
      if (tmInfo) {
        const config = hasFeature(env, 'gif_thumb') ? await loadConfigAuthorized(kv, from.id, env) : null;
        await answerInlineQuery(token, query.id, buildChoiceResults('🏆 Tournament Match', env, config));
        return;
      }
      await answerInlineQuery(token, query.id, [{
        type: 'article', id: 'err', title: '❌ Game not found',
        description: 'This game does not exist or has expired.',
        input_message_content: { message_text: '❌ Game not found.' },
      }]);
      return;
    }

    if (session.status !== 'waiting') {
      await answerInlineQuery(token, query.id, [{
        type: 'article', id: 'err', title: '❌ Game already started',
        description: 'This game is in progress or has ended.',
        input_message_content: { message_text: '❌ Game already started.' },
      }]);
      return;
    }

    if (session.hostUserId === from.id) {
      await answerInlineQuery(token, query.id, [{
        type: 'article', id: 'err', title: '❌ This is your own game!',
        description: 'Share the code with a friend to challenge them.',
        input_message_content: { message_text: '❌ You cannot join your own game!' },
      }]);
      return;
    }

    if (session.lockedToUsername &&
        from.username?.toLowerCase() !== session.lockedToUsername.toLowerCase()) {
      await answerInlineQuery(token, query.id, [{
        type: 'article', id: 'err', title: '🔒 Private game',
        description: `Only @${session.lockedToUsername} can join.`,
        input_message_content: { message_text: `❌ This game is for @${session.lockedToUsername} only.` },
      }]);
      return;
    }

    const ageMs = Date.now() - session.createdAt;
    if (ageMs > 8 * 60 * 1000) {
      const warnKey = `warn:sent:${session.gameId}`;
      const [alreadyWarned, groupChatIdStr] = await Promise.all([
        kv.get(warnKey),
        kv.get(`group:game:${session.gameId}`),
      ]);
      if (!alreadyWarned && groupChatIdStr) {
        const warnChatId = parseInt(groupChatIdStr);
        if (!isNaN(warnChatId)) {
          void Promise.all([
            sendMessage(token, warnChatId,
              `⚠️ Game <b>${escHtml(session.hostName)}</b> expire dalam ~1 menit! Masih ada yang mau join? Ketik <code>@${env.BOT_USERNAME} ${session.gameId}</code>`
            ),
            kv.put(warnKey, '1', { expirationTtl: 120 }),
          ]);
        }
      }
    }

    if (ageMs > 9 * 60 * 1000) {
      const joinQuery = session.chainId ?? undefined;
      await editInlineMessage(
        token,
        session.hostInlineMessageId,
        waitingText(session, env.BOT_USERNAME, Date.now()),
        waitingKeyboard(session.gameId, joinQuery, hasFeature(env, 'refresh_button'))
      );
    }

    const config = hasFeature(env, 'gif_thumb') ? await loadConfigAuthorized(kv, from.id, env) : null;
    await answerInlineQuery(token, query.id, buildChoiceResults('⚔️ Challenge accepted!', env, config));
    return;
  }

  // Private challenge: @username [BO3]
  const privateMatch = PRIVATE_RE.exec(q);
  if (privateMatch) {
    const rateKey = `ratelimit:${from.id}`;
    const active = parseInt(await kv.get(rateKey) ?? '0');
    if (active >= 3) {
      await answerInlineQuery(token, query.id, [{
        type: 'article', id: 'err', title: '⏳ Too many active games',
        description: 'You already have 3 active games. Finish them first!',
        input_message_content: { message_text: '⏳ Too many active games.' },
      }]);
      return;
    }
    const targetUsername = privateMatch[1];
    const modeLabel = privateMatch[2] ? ` ${privateMatch[2]}` : '';
    const config = hasFeature(env, 'gif_thumb') ? await loadConfigAuthorized(kv, from.id, env) : null;
    await answerInlineQuery(token, query.id, buildChoiceResults(`🔒 Private challenge for @${targetUsername}${modeLabel}`, env, config));
    return;
  }

  // Custom game code — check KV first so non-Premium can join existing codes
  if (isCustomCode(q)) {
    const existingC = await kv.get<GameSession>(`game:${q}`, 'json');
    if (existingC && existingC.status === 'waiting' && existingC.hostUserId !== from.id) {
      // Joinable existing game — no Premium gate
      if (existingC.lockedToUsername &&
          from.username?.toLowerCase() !== existingC.lockedToUsername.toLowerCase()) {
        await answerInlineQuery(token, query.id, [{
          type: 'article', id: 'err', title: '🔒 Private game',
          description: `Only @${existingC.lockedToUsername} can join.`,
          input_message_content: { message_text: `❌ This game is for @${existingC.lockedToUsername} only.` },
        }]);
        return;
      }
      if (Date.now() - existingC.createdAt > 9 * 60 * 1000) {
        await editInlineMessage(token, existingC.hostInlineMessageId,
          waitingText(existingC, env.BOT_USERNAME, Date.now()),
          waitingKeyboard(existingC.gameId, undefined, hasFeature(env, 'refresh_button'))
        );
      }
      const configCJ = hasFeature(env, 'gif_thumb') ? await loadConfigAuthorized(kv, from.id, env) : null;
      await answerInlineQuery(token, query.id, buildChoiceResults('⚔️ Challenge accepted!', env, configCJ));
      return;
    }
    if (existingC) {
      await answerInlineQuery(token, query.id, [{
        type: 'article', id: 'err', title: '❌ Game already started',
        description: 'This game is in progress or has ended.',
        input_message_content: { message_text: '❌ Game already started.' },
      }]);
      return;
    }
    // No existing game — Premium required to create custom code
    const tier = await loadDonatorTier(kv, from.id);
    const ownerMode = String(from.id) === env.BOT_OWNER_ID;
    if (tier !== 'premium' && !ownerMode) {
      await answerInlineQuery(token, query.id, [{
        type: 'article', id: 'premium_required',
        title: '🔒 Custom code — Premium only',
        description: 'Upgrade ke Premium untuk pakai kode game sendiri',
        input_message_content: { message_text: '🔒 Custom game code butuh Premium. /donate untuk upgrade.' },
      }]);
      return;
    }
    const rateKeyC = `ratelimit:${from.id}`;
    const activeC = parseInt(await kv.get(rateKeyC) ?? '0');
    if (activeC >= 3) {
      await answerInlineQuery(token, query.id, [{
        type: 'article', id: 'err', title: '⏳ Too many active games',
        description: 'You already have 3 active games. Finish them first!',
        input_message_content: { message_text: '⏳ Too many active games.' },
      }]);
      return;
    }
    const configC = hasFeature(env, 'gif_thumb') ? await loadConfigAuthorized(kv, from.id, env) : null;
    await answerInlineQuery(token, query.id, buildChoiceResults(`🎮 Game: ${q}`, env, configC));
    return;
  }

  const rateKey = `ratelimit:${from.id}`;
  const active = parseInt(await kv.get(rateKey) ?? '0');
  if (active >= 3) {
    await answerInlineQuery(token, query.id, [{
      type: 'article', id: 'err', title: '⏳ Too many active games',
      description: 'You already have 3 active games. Finish them first!',
      input_message_content: { message_text: '⏳ You have too many active games. Finish them first!' },
    }]);
    return;
  }

  const config = hasFeature(env, 'gif_thumb') ? await loadConfigAuthorized(kv, from.id, env) : null;
  await answerInlineQuery(token, query.id, buildChoiceResults('🎮 Setting up game...', env, config));
}

export async function handleChosenInlineResult(
  result: ChosenInlineResult,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  if (!result.inline_message_id) return;

  const q = result.query.trim().toUpperCase();
  const token = env.BOT_TOKEN;
  const kv = env.GAME_SESSIONS;

  if (q === 'CLEARHOST') {
    const listKey = `hostgames:${result.from.id}`;
    const gameIds = await kv.get<string[]>(listKey, 'json') ?? [];
    let cancelled = 0;
    for (const gameId of gameIds) {
      if (gameId.startsWith('L')) {
        const s = await kv.get<LmsSession>(`lms:${gameId}`, 'json');
        if (s && s.hostUserId === result.from.id && s.status !== 'done') {
          await Promise.all([
            kv.delete(`lms:${gameId}`),
            ...s.players.map(p => editInlineMessage(token, p.inlineMessageId, '❌ LMS game dibatalkan.')),
          ]);
          cancelled++;
        }
      } else if (gameId.startsWith('T')) {
        const s = await kv.get<TeamSession>(`team:${gameId}`, 'json');
        if (s && s.hostUserId === result.from.id && s.status !== 'playing') {
          await Promise.all([
            kv.delete(`team:${gameId}`),
            ...[...s.teamA, ...s.teamB].map(p => editInlineMessage(token, p.inlineMessageId, '❌ Team game dibatalkan.')),
          ]);
          cancelled++;
        }
      } else {
        const s = await kv.get<GameSession>(`game:${gameId}`, 'json');
        if (s && s.hostUserId === result.from.id && s.status !== 'done') {
          const ops: Promise<void>[] = [
            kv.delete(`game:${gameId}`),
            editInlineMessage(token, s.hostInlineMessageId, '❌ Game dibatalkan.'),
          ];
          if (s.opponentInlineMessageId) ops.push(editInlineMessage(token, s.opponentInlineMessageId, '❌ Game dibatalkan.'));
          await Promise.all(ops);
          cancelled++;
        }
      }
    }
    await Promise.all([
      kv.delete(listKey),
      kv.put(`ratelimit:${result.from.id}`, '0', { expirationTtl: 600 }),
    ]);
    await editInlineMessage(token, result.inline_message_id,
      cancelled > 0
        ? `🧹 ${cancelled} game${cancelled > 1 ? 's' : ''} dibatalkan.`
        : `🧹 Tidak ada game aktif.`
    );
    return;
  }

  if (q === 'SYNCSTATS') {
    // SYNCSTATS no longer needed — period stats are embedded in the main stats key and update automatically.
    await editInlineMessage(token, result.inline_message_id,
      `ℹ️ SYNCSTATS tidak lagi diperlukan.\nStats periode (hari/minggu/bulan) diupdate otomatis setiap game selesai.`
    );
    return;
  }

  // Informational articles — message already final from article content
  if (q === 'LAST') return;
  if (VS_RE.test(q)) return;

  const choice = resolveChoice(result.result_id);

  // Keep user info cache fresh even for users who haven't DM'd the bot
  kv.put(`user:info:${result.from.id}`, JSON.stringify({
    name: result.from.first_name,
    username: result.from.username ?? null,
  }));
  if (result.from.username) {
    kv.put(`user:by_username:${result.from.username.toLowerCase()}`, String(result.from.id));
  }

  // Instant game vs Bot
  if (q === 'BOT') {
    const botChoice = CHOICES[Math.floor(Math.random() * 3)];
    const rawOutcome = determineWinner(choice, botChoice);
    const botOutcome: 'win' | 'loss' | 'draw' = rawOutcome === 'a' ? 'win' : rawOutcome === 'b' ? 'loss' : 'draw';
    const botUpdateResult = await updateStats(kv, result.from.id, botOutcome, choice, 0, 'Bot', 1000, false, false);
    const botLastGame: LastGameRecord = {
      opponentId: 0,
      opponentName: 'Bot',
      myChoice: choice,
      opponentChoice: botChoice,
      outcome: botOutcome,
      ranked: false,
      at: Date.now(),
    };
    await kv.put(`stats:${result.from.id}:last`, JSON.stringify(botLastGame));
    const outcomeText = botOutcome === 'win' ? '🏆 Kamu menang!'
      : botOutcome === 'loss' ? '😔 Bot menang' : '🤝 Draw!';
    const botStreakPart = botOutcome === 'win' && (botUpdateResult.stats.currentStreak ?? 0) >= 2
      ? `\n🔥 ${botUpdateResult.stats.currentStreak} win streak!` : '';
    const playAgainKeyboard = {
      inline_keyboard: [[{ text: '🔄 Main lagi vs Bot', switch_inline_query_current_chat: 'BOT' }]],
    };
    await editInlineMessage(token, result.inline_message_id,
      `🤖 <b>vs Bot</b>\nKamu: ${EMOJI[choice]}  ·  Bot: ${EMOJI[botChoice]}\n${outcomeText}${botStreakPart}`,
      playAgainKeyboard
    );
    for (const achLabel of botUpdateResult.newAchievements) {
      ctx.waitUntil(sendMessage(token, result.from.id, `🏅 Achievement unlocked: ${achLabel}`));
    }
    if (botUpdateResult.notifyStreak) {
      ctx.waitUntil(sendMessage(token, result.from.id, `🔥 Streak <b>${botUpdateResult.notifyStreak}x</b> beruntun! Luar biasa! 🏆`));
    }
    return;
  }

  // LMS creation
  const lmsResultMatch = LMS_RE.exec(q);
  if (lmsResultMatch) {
    const maxPlayers = lmsResultMatch[1] ? Math.min(8, Math.max(3, parseInt(lmsResultMatch[1]))) : 4;
    const lmsGameId = `L${generateId()}`;
    const rateKeyLR = `ratelimit:${result.from.id}`;
    const countLR = parseInt(await kv.get(rateKeyLR) ?? '0');
    if (countLR >= 3) {
      await editInlineMessage(token, result.inline_message_id, '⏳ Too many active games.');
      return;
    }
    const lmsSession: LmsSession = {
      gameId: lmsGameId,
      hostUserId: result.from.id,
      maxPlayers,
      players: [{ userId: result.from.id, name: formatUser(result.from), choice, inlineMessageId: result.inline_message_id, active: true }],
      status: 'waiting',
      currentRound: 1,
      roundHistory: [],
      createdAt: Date.now(),
    };
    await Promise.all([
      kv.put(`lms:${lmsGameId}`, JSON.stringify(lmsSession), { expirationTtl: 600 }),
      kv.put(rateKeyLR, String(countLR + 1), { expirationTtl: 600 }),
      trackHostedGame(kv, result.from.id, lmsGameId),
    ]);
    await editInlineMessage(token, result.inline_message_id, lmsWaitingText(lmsSession), lmsHostKeyboard(lmsGameId, false));
    return;
  }

  // LMS — check KV to distinguish from custom codes starting with L
  if (LMS_CODE_RE.test(q)) {
    const lmsJoin = await kv.get<LmsSession>(`lms:${q}`, 'json');
    if (lmsJoin) {
      // Next-round pick: player sending a new inline message for an in-progress round
      if (lmsJoin.status === 'playing') {
        const lmsPickPlayer = lmsJoin.players.find(p => p.userId === result.from.id);
        if (!lmsPickPlayer || !lmsPickPlayer.active) {
          await editInlineMessage(token, result.inline_message_id, '❌ Kamu sudah eliminasi dari game ini.');
          return;
        }
        if (lmsPickPlayer.choice !== null) {
          await editInlineMessage(token, result.inline_message_id, `✅ ${EMOJI[lmsPickPlayer.choice]} sudah dikunci. Menunggu pemain lain...`);
          return;
        }
        const lmsPickUpdated = lmsJoin.players.map(p =>
          p.userId === result.from.id ? { ...p, choice, inlineMessageId: result.inline_message_id! } : p
        );
        const lmsPickSession: LmsSession = { ...lmsJoin, players: lmsPickUpdated };
        const lmsActive = lmsPickUpdated.filter(p => p.active);
        const lmsAllPicked = lmsActive.every(p => p.choice !== null);
        await kv.put(`lms:${q}`, JSON.stringify(lmsPickSession), { expirationTtl: 300 });
        if (lmsAllPicked) {
          ctx.waitUntil(runLmsRound(token, kv, lmsPickSession, ctx, env));
        } else {
          const lmsWaitLeft = lmsActive.filter(p => p.choice === null).length;
          const lmsRoundWaitText = `⚔️ <b>Round ${lmsJoin.currentRound}</b>\n` +
            lmsActive.map(p => {
              const up = lmsPickUpdated.find(u => u.userId === p.userId)!;
              return `• ${escHtml(up.name)}: ${up.choice ? '🔒' : '❓'}`;
            }).join('\n') +
            `\n\nMenunggu ${lmsWaitLeft} pemain lagi...`;
          await editInlineMessage(token, result.inline_message_id, lmsRoundWaitText);
        }
        return;
      }
      if (lmsJoin.status !== 'waiting') {
        await editInlineMessage(token, result.inline_message_id, '❌ LMS game tidak ditemukan.');
        return;
      }
      if (lmsJoin.players.some(p => p.userId === result.from.id)) {
        await editInlineMessage(token, result.inline_message_id, lmsWaitingText(lmsJoin));
        return;
      }
      if (lmsJoin.players.length >= lmsJoin.maxPlayers) {
        await editInlineMessage(token, result.inline_message_id, '❌ LMS game is full.');
        return;
      }
      const newLmsPlayer: LmsPlayer = {
        userId: result.from.id,
        name: formatUser(result.from),
        choice,
        inlineMessageId: result.inline_message_id,
        active: true,
      };
      const updatedLmsPlayers = [...lmsJoin.players, newLmsPlayer];
      const lmsIsFull = updatedLmsPlayers.length >= lmsJoin.maxPlayers;
      const updatedLms: LmsSession = { ...lmsJoin, players: updatedLmsPlayers, status: lmsIsFull ? 'playing' : 'waiting' };
      await kv.put(`lms:${q}`, JSON.stringify(updatedLms), { expirationTtl: lmsIsFull ? 300 : 600 });
      if (lmsIsFull) {
        // Free rate limit slot — game is now active, same pattern as 1v1 opponent-join
        const lmsRateKey = `ratelimit:${lmsJoin.hostUserId}`;
        const lmsRateCur = parseInt(await kv.get(lmsRateKey) ?? '1');
        if (lmsRateCur > 0) await kv.put(lmsRateKey, String(lmsRateCur - 1), { expirationTtl: 600 });
        ctx.waitUntil(runLmsRound(token, kv, updatedLms, ctx, env));
      } else {
        const canForce = updatedLmsPlayers.length >= 2;
        await Promise.allSettled(
          updatedLmsPlayers.map(p =>
            editInlineMessage(token, p.inlineMessageId, lmsWaitingText(updatedLms),
              p.userId === updatedLms.hostUserId ? lmsHostKeyboard(q, canForce) : lmsJoinKeyboard(q))
          )
        );
      }
      return;
    }
    // lms:${q} not found — fall through to custom code / new game path
  }

  // Team creation: TEAM NvN [BO3]
  const teamResultMatch = TEAM_RE.exec(q);
  if (teamResultMatch) {
    const chatIdStr = await kv.get(`team_chat:${result.from.id}`);
    if (!chatIdStr) {
      await editInlineMessage(token, result.inline_message_id, '⚠️ Setup /team di grup dulu.');
      return;
    }
    const chatId = parseInt(chatIdStr);
    if (isNaN(chatId)) { await editInlineMessage(token, result.inline_message_id, '❌ chatId tidak valid.'); return; }
    const teamSize = Math.min(4, Math.max(1, parseInt(teamResultMatch[1])));
    const mode: GameMode = teamResultMatch[3] ? parseMode(teamResultMatch[3]) : 'single';
    const gameId = `T${generateId()}`;
    const rateKeyT = `ratelimit:${result.from.id}`;
    const countT = parseInt(await kv.get(rateKeyT) ?? '0');
    if (countT >= 3) { await editInlineMessage(token, result.inline_message_id, '⏳ Too many active games.'); return; }
    const hostPlayer: TeamPlayer = { userId: result.from.id, name: formatUser(result.from), choice, inlineMessageId: result.inline_message_id };
    const teamSession: TeamSession = {
      gameId, chatId, teamSize,
      teamA: [hostPlayer], teamB: [],
      status: 'waiting', currentRound: 1, scoreA: 0, scoreB: 0,
      mode, hostUserId: result.from.id, createdAt: Date.now(),
    };
    await Promise.all([
      kv.put(`team:${gameId}`, JSON.stringify(teamSession), { expirationTtl: 600 }),
      kv.put(rateKeyT, String(countT + 1), { expirationTtl: 600 }),
      kv.delete(`team_chat:${result.from.id}`),
      trackHostedGame(kv, result.from.id, gameId),
    ]);
    const slotsA = teamSize - 1;
    const slotsB = teamSize;
    await editInlineMessage(token, result.inline_message_id, teamWaitingText(teamSession), teamWaitingKeyboard(gameId, slotsA, slotsB));
    return;
  }

  // Team join: TJOIN <gameId> A|B
  const tjoinResultMatch = TJOIN_RE.exec(q);
  if (tjoinResultMatch) {
    const gameId = tjoinResultMatch[1];
    const teamLabel = tjoinResultMatch[2] as 'A' | 'B';
    const teamSess = await kv.get<TeamSession>(`team:${gameId}`, 'json');
    if (!teamSess || teamSess.status !== 'waiting') {
      await editInlineMessage(token, result.inline_message_id, '❌ Team game tidak ditemukan.');
      return;
    }
    const member = await getChatMember(token, teamSess.chatId, result.from.id);
    if (!member || ['left', 'kicked'].includes(member.status)) {
      await editInlineMessage(token, result.inline_message_id, '❌ Kamu tidak ada di grup ini.');
      return;
    }
    const alreadyIn = [...teamSess.teamA, ...teamSess.teamB].some(p => p.userId === result.from.id);
    if (alreadyIn) {
      await editInlineMessage(token, result.inline_message_id, teamWaitingText(teamSess));
      return;
    }
    const newPlayer: TeamPlayer = { userId: result.from.id, name: formatUser(result.from), choice, inlineMessageId: result.inline_message_id };
    const updatedA = teamLabel === 'A' ? [...teamSess.teamA, newPlayer] : teamSess.teamA;
    const updatedB = teamLabel === 'B' ? [...teamSess.teamB, newPlayer] : teamSess.teamB;
    if ((teamLabel === 'A' && updatedA.length > teamSess.teamSize) ||
        (teamLabel === 'B' && updatedB.length > teamSess.teamSize)) {
      await editInlineMessage(token, result.inline_message_id, `❌ Tim ${teamLabel} sudah penuh.`);
      return;
    }
    const isFull = updatedA.length === teamSess.teamSize && updatedB.length === teamSess.teamSize;
    const updated: TeamSession = { ...teamSess, teamA: updatedA, teamB: updatedB, status: isFull ? 'playing' : 'waiting' };
    await kv.put(`team:${gameId}`, JSON.stringify(updated), { expirationTtl: isFull ? 300 : 600 });
    if (isFull) {
      // Free host's rate limit slot — game is now active
      const teamRateKey = `ratelimit:${teamSess.hostUserId}`;
      const teamRateCur = parseInt(await kv.get(teamRateKey) ?? '1');
      if (teamRateCur > 0) await kv.put(teamRateKey, String(teamRateCur - 1), { expirationTtl: 600 });
      ctx.waitUntil(runTeamRound(token, kv, updated, env, ctx));
    } else {
      const slotsA = teamSess.teamSize - updatedA.length;
      const slotsB = teamSess.teamSize - updatedB.length;
      const hostKb = teamWaitingKeyboard(gameId, slotsA, slotsB);
      const memberKb: InlineKeyboardMarkup = { inline_keyboard: [[{ text: '⏳', callback_data: 'loading' }]] };
      const waitText = teamWaitingText(updated);
      await Promise.allSettled([...updatedA, ...updatedB].map(p =>
        editInlineMessage(token, p.inlineMessageId, waitText, p.userId === updated.hostUserId ? hostKb : memberKb)
      ));
    }
    return;
  }

  // Open Challenge
  if (q === 'OPEN') {
    if (result.result_id.startsWith('open_join_')) {
      // User tapped a join article — message already shows join text + Switch button
      return;
    }
    // Create new open challenge
    const openGameId = generateId();
    const openSession: GameSession = {
      gameId: openGameId,
      hostUserId: result.from.id,
      hostName: formatUser(result.from),
      hostChoice: choice,
      opponentUserId: null,
      opponentName: null,
      opponentChoice: null,
      hostInlineMessageId: result.inline_message_id,
      opponentInlineMessageId: null,
      status: 'waiting',
      mode: 'single',
      currentRound: 1,
      hostScore: 0,
      opponentScore: 0,
      rounds: [],
      createdAt: Date.now(),
    };
    const rawOpenList = (await kv.get<OpenChallenge[]>('open:list', 'json')) ?? [];
    const newOpenEntry: OpenChallenge = { gameId: openGameId, hostName: formatUser(result.from), hostUserId: result.from.id, createdAt: Date.now() };
    const updatedOpenList = [...rawOpenList.filter(c => Date.now() - c.createdAt < 9 * 60 * 1000), newOpenEntry];
    const rateKeyOp = `ratelimit:${result.from.id}`;
    const countOp = parseInt(await kv.get(rateKeyOp) ?? '0');
    if (countOp >= 3) {
      await editInlineMessage(token, result.inline_message_id, '⏳ Too many active games.');
      return;
    }
    await Promise.all([
      kv.put(`game:${openGameId}`, JSON.stringify(openSession), { expirationTtl: 600 }),
      kv.put('open:list', JSON.stringify(updatedOpenList), { expirationTtl: 600 }),
      trackHostedGame(kv, result.from.id, openGameId),
      kv.put(rateKeyOp, String(countOp + 1), { expirationTtl: 600 }),
    ]);
    await editInlineMessage(token, result.inline_message_id,
      waitingText(openSession, env.BOT_USERNAME), waitingKeyboard(openGameId, undefined, hasFeature(env, 'refresh_button'))
    );
    ctx.waitUntil(maybeAnnounceGame(token, kv, openSession, env.BOT_USERNAME));
    return;
  }

  // Chain rematch
  if (CHAIN_CODE_RE.test(q)) {
    const chainCode = q;
    const meta = await kv.get<ChainMeta>(`chain:${chainCode}:meta`, 'json');
    if (!meta) {
      await editInlineMessage(token, result.inline_message_id, '❌ Rematch expired. Start a new game.');
      return;
    }
    if (result.from.id !== meta.hostUserId && result.from.id !== meta.opponentUserId) {
      await editInlineMessage(token, result.inline_message_id, '❌ Not your game.');
      return;
    }

    const activeGameId = await kv.get(`chain:${chainCode}:active`);

    if (!activeGameId) {
      const newGameId = generateId();
      const session: GameSession = {
        gameId: newGameId,
        hostUserId: result.from.id,
        hostName: formatUser(result.from),
        hostChoice: choice,
        opponentUserId: null,
        opponentName: null,
        opponentChoice: null,
        hostInlineMessageId: result.inline_message_id,
        opponentInlineMessageId: null,
        status: 'waiting',
        mode: meta.mode,
        currentRound: 1,
        hostScore: 0,
        opponentScore: 0,
        rounds: [],
        createdAt: Date.now(),
        chainId: chainCode,
      };
      await Promise.all([
        kv.put(`game:${newGameId}`, JSON.stringify(session), { expirationTtl: 300 }),
        kv.put(`chain:${chainCode}:active`, newGameId, { expirationTtl: 300 }),
        trackHostedGame(kv, result.from.id, newGameId),
      ]);
      const rateKey = `ratelimit:${result.from.id}`;
      const count = parseInt(await kv.get(rateKey) ?? '0');
      await kv.put(rateKey, String(count + 1), { expirationTtl: 600 });
      // Join button uses chain code so opponent goes through chain path (keeps active clean)
      await editInlineMessage(
        token,
        result.inline_message_id,
        waitingText(session, env.BOT_USERNAME),
        waitingKeyboard(newGameId, chainCode, hasFeature(env, 'refresh_button'))
      );
    } else {
      const session = await kv.get<GameSession>(`game:${activeGameId}`, 'json');
      if (!session || session.status !== 'waiting') {
        await editInlineMessage(token, result.inline_message_id, '❌ Rematch already started or expired.');
        return;
      }
      if (session.hostUserId === result.from.id) {
        await editInlineMessage(token, result.inline_message_id, '⏳ Already waiting — your opponent needs to click Rematch too.');
        return;
      }
      const updated: GameSession = {
        ...session,
        opponentUserId: result.from.id,
        opponentName: formatUser(result.from),
        opponentChoice: choice,
        opponentInlineMessageId: result.inline_message_id,
        status: 'playing',
      };
      await Promise.all([
        kv.put(`game:${activeGameId}`, JSON.stringify(updated), { expirationTtl: 120 }),
        kv.delete(`chain:${chainCode}:active`),
      ]);
      ctx.waitUntil(runRevealAndResult(token, kv, updated, env, ctx));
    }
    return;
  }

  // Private challenge: @USERNAME [BO3/BO5/BO7]
  const privateMatch = PRIVATE_RE.exec(q);
  if (privateMatch) {
    const lockedToUsername = privateMatch[1].toLowerCase();
    const mode: GameMode = privateMatch[2] ? parseMode(privateMatch[2]) : 'single';
    const gameId = generateId();

    const session: GameSession = {
      gameId,
      hostUserId: result.from.id,
      hostName: formatUser(result.from),
      hostChoice: choice,
      opponentUserId: null,
      opponentName: null,
      opponentChoice: null,
      hostInlineMessageId: result.inline_message_id,
      opponentInlineMessageId: null,
      status: 'waiting',
      mode,
      currentRound: 1,
      hostScore: 0,
      opponentScore: 0,
      rounds: [],
      createdAt: Date.now(),
      lockedToUsername,
    };

    await Promise.all([
      kv.put(`game:${gameId}`, JSON.stringify(session), { expirationTtl: 600 }),
      trackHostedGame(kv, result.from.id, gameId),
    ]);

    const rateKey = `ratelimit:${result.from.id}`;
    const count = parseInt(await kv.get(rateKey) ?? '0');
    await kv.put(rateKey, String(count + 1), { expirationTtl: 600 });

    await editInlineMessage(
      token,
      result.inline_message_id,
      waitingText(session, env.BOT_USERNAME),
      waitingKeyboard(gameId, undefined, hasFeature(env, 'refresh_button'))
    );
    ctx.waitUntil(maybeAnnounceGame(token, kv, session, env.BOT_USERNAME));
    return;
  }

  // Ranked mode — must come before GAME_ID_RE since "RANKED" is a valid 6-char ID
  const rankedResultMatch = RANKED_RE.exec(q);
  if (rankedResultMatch) {
    const mode: GameMode = rankedResultMatch[1] ? parseMode(rankedResultMatch[1]) : 'single';
    const gameId = generateId();
    const rateKeyR = `ratelimit:${result.from.id}`;
    const countR = parseInt(await kv.get(rateKeyR) ?? '0');
    if (countR >= 3) {
      await editInlineMessage(token, result.inline_message_id, '⏳ Too many active games.');
      return;
    }
    const rankedSession: GameSession = {
      gameId,
      hostUserId: result.from.id,
      hostName: formatUser(result.from),
      hostChoice: choice,
      opponentUserId: null,
      opponentName: null,
      opponentChoice: null,
      hostInlineMessageId: result.inline_message_id,
      opponentInlineMessageId: null,
      status: 'waiting',
      mode,
      currentRound: 1,
      hostScore: 0,
      opponentScore: 0,
      rounds: [],
      createdAt: Date.now(),
      ranked: true,
    };
    await Promise.all([
      kv.put(`game:${gameId}`, JSON.stringify(rankedSession), { expirationTtl: 600 }),
      trackHostedGame(kv, result.from.id, gameId),
    ]);
    await kv.put(rateKeyR, String(countR + 1), { expirationTtl: 600 });
    await editInlineMessage(token, result.inline_message_id,
      waitingText(rankedSession, env.BOT_USERNAME),
      waitingKeyboard(gameId, undefined, hasFeature(env, 'refresh_button'))
    );
    ctx.waitUntil(maybeAnnounceGame(token, kv, rankedSession, env.BOT_USERNAME));
    return;
  }

  // Regular game join by code (also handles tournament match codes)
  if (GAME_ID_RE.test(q)) {
    let session = await kv.get<GameSession>(`game:${q}`, 'json');

    // Tournament match — first player creates the session
    if (!session) {
      const tmInfo = await kv.get<{ tournamentId: string; matchId: string }>(`tournament:matchgame:${q}`, 'json');
      if (tmInfo) {
        const tmSession: GameSession = {
          gameId: q,
          hostUserId: result.from.id,
          hostName: formatUser(result.from),
          hostChoice: choice,
          opponentUserId: null, opponentName: null, opponentChoice: null,
          hostInlineMessageId: result.inline_message_id,
          opponentInlineMessageId: null,
          status: 'waiting', mode: 'single',
          currentRound: 1, hostScore: 0, opponentScore: 0, rounds: [],
          createdAt: Date.now(),
          tournamentId: tmInfo.tournamentId,
          tournamentMatchId: tmInfo.matchId,
        };
        await kv.put(`game:${q}`, JSON.stringify(tmSession), { expirationTtl: 600 });
        await editInlineMessage(token, result.inline_message_id,
          `🏆 Tournament Match\n⏳ Menunggu lawan...\n\nKode: <code>${q}</code>`
        );
        return;
      }
      return;
    }

    if (session.status !== 'waiting' || session.hostUserId === result.from.id) return;

    if (session.lockedToUsername &&
        result.from.username?.toLowerCase() !== session.lockedToUsername.toLowerCase()) {
      await editInlineMessage(token, result.inline_message_id, `❌ This game is for @${session.lockedToUsername} only.`);
      return;
    }

    const updated: GameSession = {
      ...session,
      opponentUserId: result.from.id,
      opponentName: formatUser(result.from),
      opponentChoice: choice,
      opponentInlineMessageId: result.inline_message_id,
      status: 'playing',
    };

    await Promise.all([
      kv.put(`game:${q}`, JSON.stringify(updated), { expirationTtl: 120 }),
      // Clean up chain active pointer so next rematch isn't blocked
      ...(session.chainId ? [kv.delete(`chain:${session.chainId}:active`)] : []),
    ]);

    const rateKey = `ratelimit:${session.hostUserId}`;
    const cur = parseInt(await kv.get(rateKey) ?? '1');
    if (cur > 0) await kv.put(rateKey, String(cur - 1), { expirationTtl: 600 });

    ctx.waitUntil(runRevealAndResult(token, kv, updated, env, ctx));
    return;
  }

  // Custom game code — check KV first so non-Premium can join existing codes
  if (isCustomCode(q)) {
    const existingCustom = await kv.get<GameSession>(`game:${q}`, 'json');

    // Joinable existing game — no Premium gate for joining
    if (existingCustom && existingCustom.status === 'waiting' && existingCustom.hostUserId !== result.from.id) {
      if (existingCustom.lockedToUsername &&
          result.from.username?.toLowerCase() !== existingCustom.lockedToUsername.toLowerCase()) {
        await editInlineMessage(token, result.inline_message_id, `❌ This game is for @${existingCustom.lockedToUsername} only.`);
        return;
      }
      const updatedCustom: GameSession = {
        ...existingCustom,
        opponentUserId: result.from.id,
        opponentName: formatUser(result.from),
        opponentChoice: choice,
        opponentInlineMessageId: result.inline_message_id,
        status: 'playing',
      };
      await Promise.all([
        kv.put(`game:${q}`, JSON.stringify(updatedCustom), { expirationTtl: 120 }),
        ...(existingCustom.chainId ? [kv.delete(`chain:${existingCustom.chainId}:active`)] : []),
      ]);
      const rateKeyHost = `ratelimit:${existingCustom.hostUserId}`;
      const curHost = parseInt(await kv.get(rateKeyHost) ?? '1');
      if (curHost > 0) await kv.put(rateKeyHost, String(curHost - 1), { expirationTtl: 600 });
      ctx.waitUntil(runRevealAndResult(token, kv, updatedCustom, env, ctx));
      return;
    }

    // Game exists but not joinable
    if (existingCustom) {
      await editInlineMessage(token, result.inline_message_id, `❌ Kode "${q}" sudah dipakai. Coba kode lain.`);
      return;
    }

    // No existing game — Premium required to create custom code
    const tier = await loadDonatorTier(kv, result.from.id);
    const ownerMode = String(result.from.id) === env.BOT_OWNER_ID;
    if (tier !== 'premium' && !ownerMode) {
      await editInlineMessage(token, result.inline_message_id, '🔒 Custom game code butuh Premium. /donate untuk upgrade.');
      return;
    }
    const customSession: GameSession = {
      gameId: q,
      hostUserId: result.from.id,
      hostName: formatUser(result.from),
      hostChoice: choice,
      opponentUserId: null,
      opponentName: null,
      opponentChoice: null,
      hostInlineMessageId: result.inline_message_id,
      opponentInlineMessageId: null,
      status: 'waiting',
      mode: 'single',
      currentRound: 1,
      hostScore: 0,
      opponentScore: 0,
      rounds: [],
      createdAt: Date.now(),
    };
    await Promise.all([
      kv.put(`game:${q}`, JSON.stringify(customSession), { expirationTtl: 600 }),
      trackHostedGame(kv, result.from.id, q),
    ]);
    const rateKeyCustom = `ratelimit:${result.from.id}`;
    const countCustom = parseInt(await kv.get(rateKeyCustom) ?? '0');
    await kv.put(rateKeyCustom, String(countCustom + 1), { expirationTtl: 600 });
    await editInlineMessage(token, result.inline_message_id,
      waitingText(customSession, env.BOT_USERNAME),
      waitingKeyboard(q, undefined, hasFeature(env, 'refresh_button'))
    );
    ctx.waitUntil(maybeAnnounceGame(token, kv, customSession, env.BOT_USERNAME));
    return;
  }

  // New game (single / BO3 / BO5 / BO7)
  const mode: GameMode = parseMode(q);
  const gameId = generateId();

  const session: GameSession = {
    gameId,
    hostUserId: result.from.id,
    hostName: formatUser(result.from),
    hostChoice: choice,
    opponentUserId: null,
    opponentName: null,
    opponentChoice: null,
    hostInlineMessageId: result.inline_message_id,
    opponentInlineMessageId: null,
    status: 'waiting',
    mode,
    currentRound: 1,
    hostScore: 0,
    opponentScore: 0,
    rounds: [],
    createdAt: Date.now(),
  };

  await Promise.all([
    kv.put(`game:${gameId}`, JSON.stringify(session), { expirationTtl: 600 }),
    trackHostedGame(kv, result.from.id, gameId),
  ]);

  const rateKey = `ratelimit:${result.from.id}`;
  const count = parseInt(await kv.get(rateKey) ?? '0');
  await kv.put(rateKey, String(count + 1), { expirationTtl: 600 });

  await editInlineMessage(
    token,
    result.inline_message_id,
    waitingText(session, env.BOT_USERNAME),
    waitingKeyboard(gameId, undefined, hasFeature(env, 'refresh_button'))
  );
  ctx.waitUntil(maybeAnnounceGame(token, kv, session, env.BOT_USERNAME));
}
