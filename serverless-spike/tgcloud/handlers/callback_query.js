// SPIKE (TEMPORARY) — button taps; measures the handler round trip.
import { api } from 'sdk';
import { log } from '../lib/probe.js';

export default async function (cq) {
  const t0 = Date.now();
  if (cq.data === 'sl:tap') {
    await api.answerCallbackQuery({ callback_query_id: cq.id, text: 'platform ok ' + new Date().toISOString().slice(11, 19) });
    await log('callback_query', { ms: Date.now() - t0, data: cq.data, from: cq.from && cq.from.id });
    return;
  }
  await api.answerCallbackQuery({ callback_query_id: cq.id });
}
