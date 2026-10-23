// SPIKE (TEMPORARY) — shared helpers for the probe handlers.
import { db, api } from 'sdk';
import { probeLog } from '../schema.js';

export const OWNER_ID = 582589514;

export async function log(name, data) {
  try {
    await db.insert(probeLog).values({ name, data: JSON.stringify(data ?? null), ts: Date.now() }).run();
  } catch (e) {
    console.error('probe log failed: ' + String(e));
  }
}

export async function say(chat_id, text) {
  try {
    await api.sendMessage({ chat_id, text: String(text).slice(0, 4000) });
  } catch (e) {
    console.error('say failed: ' + String((e && e.description) || e));
  }
}

// Wall-clock pause. Reports which mechanism was available: setTimeout is
// undocumented, so the fallback busy-waits (burning CPU) and says so.
export async function pause(ms) {
  if (typeof setTimeout === 'function') {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return 'setTimeout';
  }
  const end = Date.now() + ms;
  while (Date.now() < end) { /* busy wait */ }
  return 'busy-wait';
}

// Runs fn and reports the Bot API verdict instead of throwing.
export async function attempt(fn) {
  const t0 = Date.now();
  try {
    const r = await fn();
    let parsed;
    if (r && typeof r === 'object') {
      const view = r.rich_message !== undefined ? r.rich_message
        : r.entities !== undefined ? r.entities
        : { message_id: r.message_id };
      parsed = JSON.stringify(view).slice(0, 400);
    } else {
      parsed = String(r);
    }
    return { ok: true, ms: Date.now() - t0, parsed };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, code: e && e.code, description: (e && e.description) || String(e) };
  }
}
