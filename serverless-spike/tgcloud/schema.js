// SPIKE (TEMPORARY) — Telegram Serverless feasibility probes. Never merged to beta/main.
import { table, integer, text } from 'sdk/db';

export const probeLog = table('probe_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  data: text('data'),
  ts: integer('ts_ms').notNull(),
});

export const probeCounter = table('probe_counter', {
  name: text('name').primaryKey(),
  n: integer('n').notNull().default(0),
});
