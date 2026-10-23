// 1v1 game logic for the Telegram Serverless slice. Every state change is a single atomic SQL
// statement (no transactions exist on the platform), and every effect is awaited before returning
// (work after the handler returns is dropped).
import { db } from 'sdk';
import { eq, and, ne, inArray, sql } from 'sdk/db';
import { games, stats, userEmoji } from '../schema.js';
import { editInline, editInlineClassic, escHtml } from './tg.js';

export const CHOICES = ['rock', 'paper', 'scissors'];
export const EMOJI = { rock: '✊', paper: '✋', scissors: '✌️' };
export const LABEL = { rock: '✊ Rock', paper: '✋ Paper', scissors: '✌️ Scissors' };
const BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

// 'a' = first argument wins, 'b' = second, 'draw'.
export function determineWinner(a, b) {
  if (a === b) return 'draw';
  return BEATS[a] === b ? 'a' : 'b';
}

export function randomChoice() {
  return CHOICES[parseInt(crypto.randomUUID().slice(0, 4), 16) % 3];
}

export function newGameId() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
}

// A numeric value is a custom_emoji_id; anything else is plain text.
export function fmtEmoji(custom, fallback) {
  if (custom && /^\d{10,}$/.test(custom)) return `<tg-emoji emoji-id="${custom}">${fallback}</tg-emoji>`;
  return custom ? escHtml(custom) : fallback;
}

export function revealEmoji(choice, cfg) {
  return fmtEmoji(cfg && cfg[choice], EMOJI[choice]);
}

export function choiceDisplay(choice, cfg) {
  const custom = cfg && cfg[choice];
  const rendered = revealEmoji(choice, cfg);
  return custom && custom !== EMOJI[choice] ? `${rendered} (${EMOJI[choice]})` : rendered;
}

export async function loadEmoji(userId) {
  const keys = CHOICES.map((c) => `${userId}:${c}`);
  const rows = await db.select().from(userEmoji).where(inArray(userEmoji.key, keys)).all();
  const cfg = {};
  for (const r of rows) cfg[r.key.split(':')[1]] = r.value;
  return cfg;
}

export async function setEmoji(userId, choice, value) {
  await db.insert(userEmoji).values({ key: `${userId}:${choice}`, value })
    .onConflictDoUpdate({ target: userEmoji.key, set: { value } }).run();
}

// No timers exist on the platform and work after return is dropped. Waiting is done with DB round
// trips (measured: ~1830 queries = exactly 3000 ms, no CPU-timer kill, even for 5 s).
export async function waitMs(ms) {
  const t0 = Date.now();
  let i = 0;
  while (Date.now() - t0 < ms && i < 100000) { await db.get(sql`SELECT 1 AS x`); i++; }
  return i;
}

export function readyText(name) {
  return `${escHtml(name)} is ready!`;
}

export function readyKeyboard(id) {
  return {
    inline_keyboard: [
      [{ text: '🎮 Join', switch_inline_query_current_chat: id, style: 'success' }],
      [{ text: 'ℹ️', callback_data: `mypick:${id}` }, { text: '❌ Cancel', callback_data: `cancel:${id}`, style: 'danger' }],
    ],
  };
}

export function resultText(g, hostCfg, oppCfg) {
  const outcome = determineWinner(g.hostChoice, g.oppChoice);
  const head = outcome === 'draw' ? '🤝 Draw!' : `🏆 ${escHtml(outcome === 'a' ? g.hostName : g.oppName)} wins!`;
  return `${head}\n${escHtml(g.hostName)} ${choiceDisplay(g.hostChoice, hostCfg)} · ${escHtml(g.oppName)} ${choiceDisplay(g.oppChoice, oppCfg)}`;
}

export async function addStat(userId, name, result) {
  const w = result === 'win' ? 1 : 0;
  const l = result === 'loss' ? 1 : 0;
  const d = result === 'draw' ? 1 : 0;
  await db.insert(stats).values({ userId, name, wins: w, losses: l, draws: d, total: 1 })
    .onConflictDoUpdate({
      target: stats.userId,
      set: {
        name,
        wins: sql`${stats.wins} + ${w}`,
        losses: sql`${stats.losses} + ${l}`,
        draws: sql`${stats.draws} + ${d}`,
        total: sql`${stats.total} + 1`,
      },
    }).run();
}

export async function startGame(from, choice, inlineId) {
  const id = newGameId();
  const name = from.first_name || 'Player';
  await db.insert(games).values({
    id, hostId: from.id, hostName: name, hostChoice: choice, hostMsg: inlineId, status: 'waiting', createdAt: Date.now(),
  }).run();
  await editInline(inlineId, readyText(name), readyKeyboard(id));
  return { gameId: id };
}

// Exactly one joiner wins the slot: a single UPDATE ... WHERE status = 'waiting' ... RETURNING.
export async function joinGame(from, id, choice, inlineId) {
  const rows = await db.update(games)
    .set({ oppId: from.id, oppName: from.first_name || 'Player', oppChoice: choice, oppMsg: inlineId, status: 'playing' })
    .where(and(eq(games.id, id), eq(games.status, 'waiting'), ne(games.hostId, from.id)))
    .returning().run();
  if (!rows.length) {
    await editInline(inlineId, 'Game tidak tersedia (sudah dimulai, dibatalkan, atau kamu host-nya).');
    return { joined: false };
  }
  return Object.assign({ joined: true }, await runReveal(rows[0]));
}

// Single-emoji state (classic, so a custom emoji animates) -> wait 3 s -> result.
export async function runReveal(g) {
  const t0 = Date.now();
  const [hostCfg, oppCfg] = await Promise.all([loadEmoji(g.hostId), loadEmoji(g.oppId)]);
  await Promise.all([
    editInlineClassic(g.hostMsg, revealEmoji(g.hostChoice, hostCfg)),
    editInlineClassic(g.oppMsg, revealEmoji(g.oppChoice, oppCfg)),
  ]);
  const wait_queries = await waitMs(3000);

  const claimed = await db.update(games).set({ status: 'done' })
    .where(and(eq(games.id, g.id), eq(games.status, 'playing'))).returning().run();
  if (!claimed.length) return { skipped: true };

  const outcome = determineWinner(g.hostChoice, g.oppChoice);
  const text = resultText(g, hostCfg, oppCfg);
  await Promise.all([editInline(g.hostMsg, text), editInline(g.oppMsg, text)]);

  const hostRes = outcome === 'draw' ? 'draw' : outcome === 'a' ? 'win' : 'loss';
  const oppRes = outcome === 'draw' ? 'draw' : outcome === 'b' ? 'win' : 'loss';
  await Promise.all([addStat(g.hostId, g.hostName, hostRes), addStat(g.oppId, g.oppName, oppRes)]);
  return { outcome, wait_queries, ms: Date.now() - t0 };
}
