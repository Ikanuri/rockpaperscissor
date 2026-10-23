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

// ── Game slice (1v1) ──────────────────────────────────────────────────────────
export const games = table('games', {
  id: text('id').primaryKey(),
  hostId: integer('host_id').notNull(),
  hostName: text('host_name').notNull(),
  hostChoice: text('host_choice').notNull(),
  hostMsg: text('host_msg').notNull(),
  oppId: integer('opp_id'),
  oppName: text('opp_name'),
  oppChoice: text('opp_choice'),
  oppMsg: text('opp_msg'),
  status: text('status').notNull(),
  createdAt: integer('created_at_ms').notNull(),
});

export const stats = table('stats', {
  userId: integer('user_id').primaryKey(),
  name: text('name').notNull(),
  wins: integer('wins').notNull().default(0),
  losses: integer('losses').notNull().default(0),
  draws: integer('draws').notNull().default(0),
  total: integer('total').notNull().default(0),
});

export const userEmoji = table('user_emoji', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
