// Per-isolate runtime for the Telegram Serverless target: env constants, the SQL-backed KV, a
// ctx.waitUntil shim, and a setTimeout polyfill. Measured platform facts this works around: no
// timers, no work after the handler returns, and Date.now() only advances across I/O.
import { db } from 'sdk';
import { sql } from 'sdk/db';
import platformEnv from 'platform-env';
import { SqlKV } from './kv';
import type { Env } from '../types';

export const kv = new SqlKV();

export const env = {
  ...platformEnv,
  BOT_TOKEN: 'platform',
  GAME_SESSIONS: kv as unknown as KVNamespace,
} as unknown as Env;

// Wait by chaining cheap DB round trips (3000 ms ≈ 1830 queries, no CPU-timer trouble).
export async function waitMs(ms: number): Promise<number> {
  const t0 = Date.now();
  let i = 0;
  while (Date.now() - t0 < ms && i < 200000) {
    await db.get(sql`SELECT 1 AS x`);
    i++;
  }
  return i;
}

// The game code sleeps with `new Promise(r => setTimeout(r, ms))` and always awaits it, which keeps
// the handler alive for the duration — so a fire-and-forget polyfill is enough.
const g = globalThis as any;
if (typeof g.setTimeout !== 'function') {
  g.setTimeout = (fn: () => void, ms = 0) => {
    void waitMs(ms).then(fn);
    return 0;
  };
}

// ctx.waitUntil work is dropped once a handler returns on this platform, so collect it and await it.
function makeCtx() {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil(p: Promise<unknown>) {
      pending.push(Promise.resolve(p).catch(e => console.error('waitUntil task failed:', e)));
    },
    passThroughOnException() {},
  } as unknown as ExecutionContext;
  const drain = async () => {
    for (let i = 0; i < pending.length; i++) await pending[i];
  };
  return { ctx, drain };
}

// Runs a handler body with a fresh ctx, never throws (a thrown error would make Telegram redeliver),
// and awaits every waitUntil task before returning.
export async function run<T>(fn: (ctx: ExecutionContext) => Promise<T>): Promise<T | undefined> {
  const { ctx, drain } = makeCtx();
  try {
    return await fn(ctx);
  } catch (e) {
    console.error('handler error:', e);
    return undefined;
  } finally {
    try { await drain(); } catch (e) { console.error('drain error:', e); }
    if (Math.random() < 0.02) {
      try { await kv.sweep(); } catch (e) { console.error('sweep error:', e); }
    }
  }
}
