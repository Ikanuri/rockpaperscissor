// SPIKE (TEMPORARY) — owner-only probe commands for the Telegram Serverless platform.
// Run live ("/sl_env" in the bot's DM) or via `tgcloud run` with { quiet: true } (no DM reply).
import { db, api, fetch } from 'sdk';
import { eq, asc, desc, inArray, sql } from 'sdk/db';
import { probeLog, probeCounter } from '../schema.js';
import { OWNER_ID, log, say, pause, attempt } from '../lib/probe.js';

const DEFAULT_EMOJI_ID = '5231084692660300175';

const commands = {
  // What does the runtime actually provide? (setTimeout, waitUntil, crypto, ...)
  async sl_env(arg, message, ctx) {
    const g = globalThis;
    const names = ['setTimeout', 'clearTimeout', 'setInterval', 'queueMicrotask', 'structuredClone',
      'TextEncoder', 'TextDecoder', 'URL', 'URLSearchParams', 'AbortController', 'performance', 'crypto',
      'Intl', 'atob', 'btoa', 'Buffer', 'process', 'WebAssembly', 'FormData', 'Headers', 'Request',
      'Response', 'ReadableStream', 'BigInt', 'Proxy'];
    const types = {};
    for (const n of names) {
      try { types[n] = typeof g[n]; } catch (e) { types[n] = 'error'; }
    }
    let subtle = null;
    let uuid = null;
    try { subtle = typeof g.crypto.subtle; uuid = typeof g.crypto.randomUUID; } catch (e) { /* absent */ }
    let tz = null;
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { /* absent */ }
    return {
      types,
      crypto_subtle: subtle,
      crypto_randomUUID: uuid,
      ctx_keys: Object.keys(ctx || {}),
      ctx_waitUntil: typeof (ctx && ctx.waitUntil),
      db_transaction: typeof db.transaction,
      db_batch: typeof db.batch,
      timezone: tz,
      global_property_count: Object.getOwnPropertyNames(g).length,
    };
  },

  // Does a 5 s (or given ms) wait work? Without timers it is built from Bot API round trips.
  async sl_sleep(arg) {
    const ms = Math.min(parseInt(arg, 10) || 5000, 60000);
    const t0 = Date.now();
    const how = await pause(ms, 2000);
    return { requested_ms: ms, actual_ms: Date.now() - t0, ...how };
  },

  // Wall-clock limit: escalating I/O-based waits, progress logged to the DB before each step.
  async sl_wall() {
    const done = [];
    for (const sec of [2, 5, 10, 20, 30]) {
      await log('wall:start', { sec });
      const t0 = Date.now();
      const how = await pause(sec * 1000, 3000);
      const actual_ms = Date.now() - t0;
      await log('wall:done', { sec, actual_ms, ...how });
      done.push({ sec, actual_ms, ...how });
    }
    return { completed: done };
  },

  // One I/O-based wait of N seconds: pins the wall-clock limit down one value at a time.
  async sl_wall2(arg) {
    const sec = Math.min(parseInt(arg, 10) || 25, 60);
    await log('wall2:start', { sec });
    const t0 = Date.now();
    const how = await pause(sec * 1000, 6000);
    const actual_ms = Date.now() - t0;
    await log('wall2:done', { sec, actual_ms, ...how });
    return { sec, actual_ms, ...how };
  },

  // Wait built from DB round trips only (no Bot API calls, nothing leaves the platform).
  async sl_dbwait(arg) {
    const ms = Math.min(parseInt(arg, 10) || 3000, 25000);
    const t0 = Date.now();
    let i = 0;
    while (Date.now() - t0 < ms && i < 200000) { await db.get(sql`SELECT 1 AS x`); i++; }
    return { requested_ms: ms, actual_ms: Date.now() - t0, queries: i };
  },

  async sl_cleanup() {
    await db.run('DROP TRIGGER IF EXISTS probe_trg');
    return { dropped_trigger: true };
  },

  // CPU cost calibration: `n` iterations of pure CPU work (no clock reads, since the clock is frozen
  // during CPU work). The CLI prints the server-side elapsed time, or the CPU-timer kill.
  async sl_cpu(arg) {
    const n = Math.min(parseInt(arg, 10) || 1000000, 2000000000);
    await log('cpu:start', { n });
    let x = 0;
    for (let i = 0; i < n; i++) { x += Math.sqrt(i + 1); }
    await log('cpu:done', { n });
    return { iterations: n, checksum: Math.round(x) % 1000 };
  },

  // Is the clock frozen during CPU work and advanced by I/O?
  async sl_clock() {
    const t0 = Date.now();
    let x = 0;
    for (let i = 0; i < 3000000; i++) { x += Math.sqrt(i + 1); }
    const after_cpu = Date.now();
    await db.select().from(probeCounter).all();
    const after_io = Date.now();
    return { cpu_loop_delta_ms: after_cpu - t0, io_delta_ms: after_io - after_cpu, checksum: Math.round(x) % 1000 };
  },

  // Can outbound fetch reach anything? Telegram's own host failed in phase 1.
  async sl_fetch(arg) {
    const urls = arg ? arg.split(/\s+/) : [
      'https://example.com/', 'http://example.com/', 'https://api.github.com/zen',
      'https://raw.githubusercontent.com/Ikanuri/rockpaperscissor/main/package.json',
      'https://httpbin.org/get', 'https://api.telegram.org/', 'https://cloud.telegram.org/capabilities',
    ];
    const out = {};
    for (const u of urls) {
      const t0 = Date.now();
      try {
        const r = await fetch(u);
        const body = await r.text();
        out[u] = { status: r.status, ms: Date.now() - t0, bytes: body.length };
      } catch (e) {
        out[u] = { ms: Date.now() - t0, error: String((e && e.message) || e) };
      }
    }
    return out;
  },

  // Does work continue after the handler returns? (stand-in for ctx.waitUntil, used 47x today)
  async sl_bg() {
    const marker = 'bg-' + Math.random().toString(36).slice(2, 8);
    (async () => {
      try {
        for (let i = 0; i < 5; i++) await db.select().from(probeCounter).all();
        await pause(300, 40);
        await log('bg:done', { marker });
      } catch (e) {
        await log('bg:error', { marker, error: String(e) });
      }
    })();
    await log('bg:started', { marker });
    return { marker, note: 'look for bg:done with this marker in sl_log' };
  },

  // Single-statement claim: exactly one concurrent caller must win.
  async sl_claim() {
    const rows = await db.insert(probeCounter).values({ name: 'claim', n: 1 })
      .onConflictDoNothing({ target: probeCounter.name }).returning().run();
    const won = rows.length > 0;
    await log('claim', { won });
    return { won };
  },

  // More DB capabilities: db.batch, multi-statement strings, UPDATE ... RETURNING.
  async sl_db2() {
    const out = { typeof_db_batch: typeof db.batch };
    const t = async (label, fn) => {
      try { out[label] = await fn(); } catch (e) { out[label] = { error: String((e && e.description) || (e && e.message) || e) }; }
    };
    await t('multi_statement_string', async () => {
      await db.run("INSERT OR REPLACE INTO probe_counter (name, n) VALUES ('m1', 1); INSERT OR REPLACE INTO probe_counter (name, n) VALUES ('m2', 2)");
      return db.all(sql`SELECT name FROM probe_counter WHERE name IN ('m1', 'm2')`);
    });
    await t('update_returning', async () => {
      await db.run("INSERT OR REPLACE INTO probe_counter (name, n) VALUES ('u1', 5)");
      return db.update(probeCounter).set({ n: sql`${probeCounter.n} + 1` }).where(eq(probeCounter.name, 'u1')).returning().run();
    });
    await t('create_trigger', async () => db.run('CREATE TRIGGER IF NOT EXISTS probe_trg AFTER INSERT ON probe_log BEGIN SELECT 1; END'));
    return out;
  },

  // Concurrency inside ONE invocation: 30 parallel read-modify-writes vs atomic increments.
  async sl_race() {
    const N = 30;
    const names = ['r_nonatomic', 'r_atomic'];
    await db.delete(probeCounter).where(inArray(probeCounter.name, names)).run();
    await db.insert(probeCounter).values(names.map((name) => ({ name, n: 0 }))).run();
    await Promise.all(Array.from({ length: N }, async () => {
      const row = await db.select().from(probeCounter).where(eq(probeCounter.name, 'r_nonatomic')).get();
      await db.update(probeCounter).set({ n: row.n + 1 }).where(eq(probeCounter.name, 'r_nonatomic')).run();
      await db.update(probeCounter).set({ n: sql`${probeCounter.n} + 1` }).where(eq(probeCounter.name, 'r_atomic')).run();
    }));
    const rows = await db.select().from(probeCounter).where(inArray(probeCounter.name, names)).all();
    const out = { expected: N };
    for (const r of rows) out[r.name] = r.n;
    return out;
  },

  // Concurrency ACROSS invocations: one slow non-atomic RMW + one atomic increment per call.
  async sl_hit() {
    const t0 = Date.now();
    const row = await db.select().from(probeCounter).where(eq(probeCounter.name, 'h_nonatomic')).get();
    const cur = row ? row.n : 0;
    await pause(400, 60);
    await db.insert(probeCounter).values({ name: 'h_nonatomic', n: cur + 1 })
      .onConflictDoUpdate({ target: probeCounter.name, set: { n: cur + 1 } }).run();
    await db.insert(probeCounter).values({ name: 'h_atomic', n: 1 })
      .onConflictDoUpdate({ target: probeCounter.name, set: { n: sql`${probeCounter.n} + 1` } }).run();
    const t1 = Date.now();
    await log('hit', { t0, t1, read: cur });
    return { t0, t1, read: cur };
  },

  async sl_counts() {
    const rows = await db.select().from(probeCounter).where(inArray(probeCounter.name, ['h_nonatomic', 'h_atomic'])).all();
    const hits = await db.select().from(probeLog).where(eq(probeLog.name, 'hit')).orderBy(asc(probeLog.id)).all();
    const iv = hits.map((h) => JSON.parse(h.data));
    const events = [];
    for (const x of iv) { events.push([x.t0, 1]); events.push([x.t1, -1]); }
    events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let cur = 0;
    let max = 0;
    for (const e of events) { cur += e[1]; if (cur > max) max = cur; }
    const claims = await db.select().from(probeLog).where(eq(probeLog.name, 'claim')).all();
    const claim_winners = claims.filter((c) => JSON.parse(c.data).won).length;
    const counters = {};
    for (const r of rows) counters[r.name] = r.n;
    return {
      claim_attempts: claims.length,
      claim_winners,
      invocations: iv.length,
      counters,
      lost_updates: (counters.h_atomic || 0) - (counters.h_nonatomic || 0),
      max_overlapping_invocations: max,
      span_ms: iv.length ? Math.max(...iv.map((x) => x.t1)) - Math.min(...iv.map((x) => x.t0)) : 0,
    };
  },

  async sl_reset() {
    await db.run('DELETE FROM probe_counter');
    await db.run('DELETE FROM probe_log');
    return { reset: true };
  },

  // DB feature + size probes: bulk insert, upsert RETURNING, transactions, PRAGMAs, big values.
  async sl_db() {
    const out = {};
    const t = async (label, fn) => {
      const t0 = Date.now();
      try { out[label] = { ms: Date.now() - t0, v: await fn() }; out[label].ms = Date.now() - t0; }
      catch (e) { out[label] = { ms: Date.now() - t0, error: String((e && e.description) || (e && e.message) || e) }; }
    };
    await t('bulk_insert_500_rows', async () => {
      for (let b = 0; b < 5; b++) {
        const rows = [];
        for (let i = 0; i < 100; i++) rows.push({ name: 'bulk', data: 'x'.repeat(50), ts: Date.now() });
        await db.insert(probeLog).values(rows).run();
      }
      return 'ok';
    });
    await t('count_bulk', () => db.$count(probeLog, eq(probeLog.name, 'bulk')));
    const upsert = () => db.insert(probeCounter).values({ name: 'ups', n: 1 })
      .onConflictDoUpdate({ target: probeCounter.name, set: { n: sql`${probeCounter.n} + 1` } }).returning().run();
    await t('upsert_returning_1', upsert);
    await t('upsert_returning_2', upsert);
    await t('typeof_db_transaction', async () => typeof db.transaction);
    await t('raw_begin_commit', async () => { await db.run('BEGIN'); await db.run('COMMIT'); return 'ok'; });
    await t('raw_rollback_effect', async () => {
      await db.run("INSERT OR REPLACE INTO probe_counter (name, n) VALUES ('rb', 1)");
      await db.run('BEGIN');
      await db.run("UPDATE probe_counter SET n = 99 WHERE name = 'rb'");
      await db.run('ROLLBACK');
      return db.get(sql`SELECT n FROM probe_counter WHERE name = 'rb'`);
    });
    for (const p of ['page_size', 'page_count', 'max_page_count', 'journal_mode']) {
      await t('pragma_' + p, () => db.get(sql.raw('PRAGMA ' + p)));
    }
    for (const kb of [100, 1024, 5120]) {
      await t('big_value_' + kb + 'KB', async () => {
        await db.insert(probeLog).values({ name: 'big' + kb, data: 'y'.repeat(kb * 1024), ts: Date.now() }).run();
        return 'ok';
      });
    }
    await t('cleanup', () => db.run("DELETE FROM probe_log WHERE name LIKE 'big%' OR name = 'bulk'"));
    return out;
  },

  // Does rich_message / custom emoji work when the PLATFORM sends it? (2 DMs to the owner)
  async sl_rich(arg) {
    const id = /^\d{10,}$/.test(arg || '') ? arg : DEFAULT_EMOJI_ID;
    const chat_id = OWNER_ID;
    const em = `<tg-emoji emoji-id="${id}">✊</tg-emoji>`;
    const classic = await attempt(() => api.sendMessage({
      chat_id, parse_mode: 'HTML', text: `classic (platform) ${em} teks ${em}`,
    }));
    const rich = await attempt(() => api.sendRichMessage({
      chat_id, rich_message: { html: `<b>rich (platform)</b> ${em} teks ${em}` },
    }));
    return { emoji_id: id, classic, rich };
  },

  // Latency profile: Bot API round trips, DB reads/writes, outbound fetch.
  async sl_perf() {
    const out = {};
    const stat = (a) => ({
      n: a.length,
      avg_ms: Math.round(a.reduce((x, y) => x + y, 0) / a.length),
      min_ms: Math.min(...a),
      max_ms: Math.max(...a),
    });
    const seq = async (label, n, fn) => {
      const ms = [];
      for (let i = 0; i < n; i++) {
        const t0 = Date.now();
        try { await fn(); } catch (e) { out[label + '_error'] = String((e && e.description) || e); break; }
        ms.push(Date.now() - t0);
      }
      if (ms.length) out[label] = stat(ms);
    };
    await seq('api_getMe_seq', 10, () => api.getMe());
    const t0 = Date.now();
    await Promise.all(Array.from({ length: 10 }, () => api.getMe()));
    out.api_getMe_parallel10_total_ms = Date.now() - t0;
    await seq('db_select_seq', 10, () => db.select().from(probeCounter).all());
    await seq('db_insert_seq', 10, () => db.insert(probeLog).values({ name: 'perf', data: '', ts: Date.now() }).run());
    await seq('fetch_capabilities', 3, async () => {
      const r = await fetch('https://cloud.telegram.org/capabilities');
      await r.text();
      if (!r.ok) throw new Error('status ' + r.status);
    });
    await db.run("DELETE FROM probe_log WHERE name = 'perf'");
    return out;
  },

  async sl_log() {
    const rows = await db.select().from(probeLog).orderBy(desc(probeLog.id)).limit(40).all();
    return { rows: rows.reverse().map((r) => ({ id: r.id, name: r.name, data: r.data, ts: r.ts })) };
  },
};

export default async function (message, ctx) {
  const text = (message.text || '').trim();
  const fromId = message.from && message.from.id;

  if (fromId !== OWNER_ID) {
    if (message.chat && message.chat.type === 'private' && text.startsWith('/')) {
      await api.sendMessage({
        chat_id: message.chat.id,
        text: 'Bot beta sedang dipakai untuk uji coba platform baru. Coba lagi nanti.',
      });
    }
    return;
  }

  const parts = text.split(/\s+/);
  const name = parts[0].replace(/^\//, '').replace(/@.*$/, '');
  const fn = commands[name];
  if (!fn) return;

  const t0 = Date.now();
  let result;
  try {
    result = await fn(parts.slice(1).join(' '), message, ctx);
  } catch (e) {
    result = { error: String((e && e.stack) || e) };
  }
  result = Object.assign({}, result, { handler_ms: Date.now() - t0 });
  if (!message.quiet) await say(message.chat.id, name + ' ->\n' + JSON.stringify(result, null, 1));
  return result;
}
