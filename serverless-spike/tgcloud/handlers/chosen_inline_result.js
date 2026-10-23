// The chosen result carries the inline_message_id we edit from now on.
import { CHOICES, randomChoice, startGame, joinGame } from '../lib/game.js';

export default async function (r) {
  if (!r.inline_message_id) return;
  const choice = r.result_id === 'random' ? randomChoice() : r.result_id;
  if (!CHOICES.includes(choice)) return;
  const q = (r.query || '').trim().toUpperCase();
  if (q === '') await startGame(r.from, choice, r.inline_message_id);
  else if (/^[A-Z0-9]{6}$/.test(q)) await joinGame(r.from, q, choice, r.inline_message_id);
}
