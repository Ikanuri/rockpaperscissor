// SPIKE (TEMPORARY) — owner-only inline results that mirror the game's delivery path.
import { api } from 'sdk';
import { OWNER_ID, log } from '../lib/probe.js';

export default async function (q) {
  if (!q.from || q.from.id !== OWNER_ID) return;
  const t0 = Date.now();
  const markup = { inline_keyboard: [[{ text: '🔘 tap', callback_data: 'sl:tap' }]] };
  const results = ['sl_classic', 'sl_rich', 'sl_rich_btn'].map((id) => ({
    type: 'article',
    id,
    title: id,
    description: 'platform inline spike',
    input_message_content: { message_text: '⏳ ' + id },
    reply_markup: markup,
  }));
  await api.answerInlineQuery({ inline_query_id: q.id, results, cache_time: 0 });
  await log('inline_query', { ms: Date.now() - t0, query: q.query });
}
