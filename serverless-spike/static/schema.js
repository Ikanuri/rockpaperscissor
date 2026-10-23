// Telegram Serverless schema for the ported bot: one KV-shaped table (same keys/JSON as the
// Cloudflare KV namespace, so data copies 1:1) with TTL as a column and a version for CAS.
import { table, text, integer, index } from 'sdk/db';

export const kv = table('kv', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at_ms'),
  version: integer('version').notNull().default(0),
}, (t) => ({
  expIdx: index('idx_kv_exp').on(t.expiresAt),
}));
