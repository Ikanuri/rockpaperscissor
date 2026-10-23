// SPIKE (TEMPORARY) — edits the chosen inline message exactly like the game does.
import { api } from 'sdk';
import { OWNER_ID, log, attempt } from '../lib/probe.js';

const EMOJI_ID = '5231084692660300175';

export default async function (r) {
  if (!r.from || r.from.id !== OWNER_ID || !r.inline_message_id) return;
  const t0 = Date.now();
  const em = `<tg-emoji emoji-id="${EMOJI_ID}">✊</tg-emoji>`;
  const markup = { inline_keyboard: [[{ text: '🔘 tap', callback_data: 'sl:tap' }]] };
  const target = { inline_message_id: r.inline_message_id };
  let res;
  if (r.result_id === 'sl_classic') {
    res = await attempt(() => api.editMessageText({
      ...target, parse_mode: 'HTML', reply_markup: markup, text: `<b>classic</b> ${em} teks ${em}`,
    }));
  } else if (r.result_id === 'sl_rich') {
    res = await attempt(() => api.editMessageText({
      ...target, rich_message: { html: `<b>rich</b> ${em} teks ${em}` },
    }));
  } else if (r.result_id === 'sl_rich_btn') {
    res = await attempt(() => api.editMessageText({
      ...target,
      rich_message: { html: `<b>rich+tombol</b> ${em}<tg-button-row><tg-button type="callback_data" data="sl:tap">🔘 tombol rich</tg-button></tg-button-row>` },
    }));
  } else {
    return;
  }
  await log('chosen_inline_result', { result_id: r.result_id, ms: Date.now() - t0, res });
}
