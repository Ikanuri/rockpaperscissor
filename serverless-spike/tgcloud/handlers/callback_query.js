// Buttons: cancel (host only, only while waiting) and the private "my pick" popup.
import { api, db } from 'sdk';
import { eq, and } from 'sdk/db';
import { games } from '../schema.js';
import { EMOJI } from '../lib/game.js';
import { editInline } from '../lib/tg.js';

export default async function (cq) {
  const parts = (cq.data || '').split(':');
  const action = parts[0];
  const id = parts[1];

  if (action === 'cancel') {
    const rows = await db.update(games).set({ status: 'cancelled' })
      .where(and(eq(games.id, id), eq(games.status, 'waiting'), eq(games.hostId, cq.from.id)))
      .returning().run();
    if (rows.length) {
      await api.answerCallbackQuery({ callback_query_id: cq.id, text: 'Game dibatalkan.' });
      if (cq.inline_message_id) await editInline(cq.inline_message_id, '❌ Game dibatalkan.');
    } else {
      await api.answerCallbackQuery({ callback_query_id: cq.id, text: 'Tidak bisa dibatalkan.', show_alert: true });
    }
    return;
  }

  if (action === 'mypick') {
    const g = await db.select().from(games).where(eq(games.id, id)).get();
    let text = '❌ Kamu bukan peserta game ini.';
    if (g && g.hostId === cq.from.id) text = `🔒 Pilihanmu: ${EMOJI[g.hostChoice]}`;
    else if (g && g.oppId === cq.from.id) text = `🔒 Pilihanmu: ${EMOJI[g.oppChoice]}`;
    await api.answerCallbackQuery({ callback_query_id: cq.id, text });
    return;
  }

  await api.answerCallbackQuery({ callback_query_id: cq.id });
}
