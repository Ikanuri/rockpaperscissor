// Owner-only maintenance commands for the platform target (data migration rehearsal and checks).
// Run through `tgcloud run handlers/message '{ quiet: true, from: {id: OWNER}, text: "/sl_..." }'`.
import { db } from 'sdk';
import { sql } from 'sdk/db';
import type { Env } from '../types';
import { kv } from './runtime';

type Entry = [string, string, number | null]; // key, value, expires_at_ms

async function importEntries(entries: Entry[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < entries.length; i += 100) {
    const batch = entries.slice(i, i + 100);
    const params: Record<string, string | number | null> = {};
    const values = batch.map((e, j) => {
      params[`:k${j}`] = e[0];
      params[`:v${j}`] = e[1];
      params[`:e${j}`] = e[2];
      return `(:k${j}, :v${j}, :e${j}, 1)`;
    });
    await db.run(`INSERT OR REPLACE INTO kv ("key", value, expires_at_ms, version) VALUES ${values.join(',')}`, params);
    n += batch.length;
  }
  return n;
}

// Key family = text before the first ':' (or the whole key). Must match the export-side rule.
async function stats() {
  const now = Date.now();
  const families = await db.all(sql`
    SELECT CASE WHEN instr("key", ':') > 0 THEN substr("key", 1, instr("key", ':') - 1) ELSE "key" END AS fam,
           COUNT(*) AS n, SUM(length(CAST(value AS BLOB))) AS bytes
    FROM kv WHERE expires_at_ms IS NULL OR expires_at_ms > ${now}
    GROUP BY fam ORDER BY fam`);
  const total = await db.get(sql`
    SELECT COUNT(*) AS n, COALESCE(SUM(length(CAST(value AS BLOB))), 0) AS bytes FROM kv
    WHERE expires_at_ms IS NULL OR expires_at_ms > ${now}`);
  return { total, families };
}

export async function adminCommand(message: any, env: Env): Promise<unknown> {
  const text = String(message?.text ?? '').trim();
  if (!text.startsWith('/sl_')) return undefined;
  if (String(message?.from?.id) !== env.BOT_OWNER_ID) return undefined;
  const [cmd, ...rest] = text.split(/\s+/);
  const arg = rest.join(' ');

  switch (cmd) {
    case '/sl_ping':
      return { ok: true, bot: env.BOT_USERNAME, flags: env.FEATURE_FLAGS, kv: (await stats()).total };
    case '/sl_kvstats':
      return stats();
    case '/sl_import': {
      const entries = Array.isArray(message.entries) ? (message.entries as Entry[]) : [];
      const imported = await importEntries(entries);
      return { imported };
    }
    case '/sl_kvget': {
      const v = await kv.get(arg);
      return { key: arg, found: v !== null, value: v === null ? null : v.slice(0, 3000) };
    }
    case '/sl_kvwipe': {
      if (arg !== 'CONFIRM') return { error: 'pakai: /sl_kvwipe CONFIRM' };
      const r = await db.run(sql`DELETE FROM kv`);
      return { deleted: r.rowsAffected };
    }
    case '/sl_sweep':
      return { swept: await kv.sweep() };
    default:
      return undefined;
  }
}
