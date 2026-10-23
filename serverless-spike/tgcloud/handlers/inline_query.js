// Inline queries: "@bot" starts a game, "@bot <CODE>" joins one.
import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import { games } from '../schema.js';
import { CHOICES, LABEL } from '../lib/game.js';

const PLACEHOLDER = { inline_keyboard: [[{ text: '⏳', callback_data: 'loading' }]] };

function choiceResults(initText) {
  const items = CHOICES.map((c) => ({
    type: 'article', id: c, title: LABEL[c], input_message_content: { message_text: initText }, reply_markup: PLACEHOLDER,
  }));
  items.unshift({
    type: 'article', id: 'random', title: '🎲 Random', description: 'Let fate decide',
    input_message_content: { message_text: initText }, reply_markup: PLACEHOLDER,
  });
  return items;
}

export default async function (q) {
  const text = (q.query || '').trim().toUpperCase();
  let results = null;
  if (text === '') {
    results = choiceResults('🎮 Game');
  } else if (/^[A-Z0-9]{6}$/.test(text)) {
    const g = await db.select().from(games).where(eq(games.id, text)).get();
    if (g && g.status === 'waiting' && g.hostId !== q.from.id) {
      results = choiceResults(`⚔️ Join ${g.hostName}`);
    } else {
      results = [{
        type: 'article', id: 'unavailable', title: 'Game tidak tersedia',
        description: 'Sudah dimulai, dibatalkan, atau milikmu sendiri',
        input_message_content: { message_text: 'Game tidak tersedia.' },
      }];
    }
  }
  if (!results) return;
  await api.answerInlineQuery({ inline_query_id: q.id, results, cache_time: 0 });
}
