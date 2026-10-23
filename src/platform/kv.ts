// A KVNamespace-shaped store on the platform's SQLite database. Same keys and JSON values as the
// Cloudflare KV namespace (so data copies over 1:1), with TTL as a column and a version column
// that gives real compare-and-swap, which Cloudflare KV never had.
import { db } from 'sdk';
import { sql } from 'sdk/db';

interface PutOpts { expirationTtl?: number; expiration?: number }

function expiryOf(opts?: PutOpts): number | null {
  if (opts?.expirationTtl) return Date.now() + opts.expirationTtl * 1000;
  if (opts?.expiration) return opts.expiration * 1000;
  return null;
}

export class SqlKV {
  async get(key: string, type?: 'text' | 'json'): Promise<any> {
    const now = Date.now();
    const row = await db.get(
      sql`SELECT value FROM kv WHERE "key" = ${key} AND (expires_at_ms IS NULL OR expires_at_ms > ${now})`
    );
    if (!row) return null;
    return type === 'json' ? JSON.parse(row.value) : row.value;
  }

  async put(key: string, value: string, opts?: PutOpts): Promise<void> {
    const exp = expiryOf(opts);
    await db.run(sql`INSERT INTO kv ("key", value, expires_at_ms, version) VALUES (${key}, ${value}, ${exp}, 1)
      ON CONFLICT("key") DO UPDATE SET value = excluded.value, expires_at_ms = excluded.expires_at_ms, version = kv.version + 1`);
  }

  async delete(key: string): Promise<void> {
    await db.run(sql`DELETE FROM kv WHERE "key" = ${key}`);
  }

  // Atomic read-modify-write on a JSON document. `mutate` gets the current value (or null) and
  // returns the new value, or undefined to leave it untouched. Retries on version conflicts.
  async cas<T = any>(
    key: string,
    mutate: (current: T | null) => T | null | undefined,
    opts?: PutOpts
  ): Promise<{ value: T | null; changed: boolean }> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const now = Date.now();
      const row = await db.get(
        sql`SELECT value, version FROM kv WHERE "key" = ${key} AND (expires_at_ms IS NULL OR expires_at_ms > ${now})`
      );
      const current: T | null = row ? JSON.parse(row.value) : null;
      const next = mutate(current);
      if (next === undefined) return { value: current, changed: false };
      const payload = JSON.stringify(next);
      const exp = expiryOf(opts);
      if (row) {
        const r = await db.run(
          sql`UPDATE kv SET value = ${payload}, expires_at_ms = ${exp}, version = version + 1 WHERE "key" = ${key} AND version = ${row.version}`
        );
        if (r.rowsAffected > 0) return { value: next, changed: true };
      } else {
        // Absent (or expired): insert, or take over an expired row — but never overwrite a live one.
        const r = await db.run(
          sql`INSERT INTO kv ("key", value, expires_at_ms, version) VALUES (${key}, ${payload}, ${exp}, 1)
            ON CONFLICT("key") DO UPDATE SET value = excluded.value, expires_at_ms = excluded.expires_at_ms, version = kv.version + 1
            WHERE kv.expires_at_ms IS NOT NULL AND kv.expires_at_ms <= ${now}`
        );
        if (r.rowsAffected > 0) return { value: next, changed: true };
      }
    }
    throw new Error(`kv.cas: too much contention on ${key}`);
  }

  // Expired rows are filtered on read; this reclaims their space.
  async sweep(): Promise<number> {
    const r = await db.run(sql`DELETE FROM kv WHERE expires_at_ms IS NOT NULL AND expires_at_ms <= ${Date.now()}`);
    return r.rowsAffected ?? 0;
  }
}
