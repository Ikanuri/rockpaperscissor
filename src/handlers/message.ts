import type { TelegramMessage, Env } from '../types';
import { sendMessage } from '../telegram';

type Choice = 'rock' | 'paper' | 'scissors';
const CHOICES: Choice[] = ['rock', 'paper', 'scissors'];

export async function handleMessage(msg: TelegramMessage, env: Env): Promise<void> {
  if (!env.BOT_OWNER_ID) return;
  if (!msg.from || !msg.text) return;
  if (msg.chat.type !== 'private') return;
  if (String(msg.from.id) !== env.BOT_OWNER_ID) return;

  const parts = msg.text.trim().split(/\s+/);
  const cmd = parts[0].toLowerCase();

  if (cmd === '/setthumb' && parts.length >= 3) {
    const choice = parts[1].toLowerCase() as Choice;
    const url = parts[2];
    if (!CHOICES.includes(choice)) {
      await sendMessage(env.BOT_TOKEN, msg.chat.id, '❌ Invalid choice. Use: rock, paper, scissors');
      return;
    }
    await env.GAME_SESSIONS.put(`config:thumb:${choice}`, url);
    await sendMessage(env.BOT_TOKEN, msg.chat.id, `✅ Thumbnail set for <b>${choice}</b>:\n<code>${url}</code>`);

  } else if (cmd === '/delthumb' && parts.length >= 2) {
    const choice = parts[1].toLowerCase() as Choice;
    if (!CHOICES.includes(choice)) {
      await sendMessage(env.BOT_TOKEN, msg.chat.id, '❌ Invalid choice. Use: rock, paper, scissors');
      return;
    }
    await env.GAME_SESSIONS.delete(`config:thumb:${choice}`);
    await sendMessage(env.BOT_TOKEN, msg.chat.id, `✅ Thumbnail removed for <b>${choice}</b>.`);

  } else if (cmd === '/config') {
    const [rock, paper, scissors] = await Promise.all(
      CHOICES.map(c => env.GAME_SESSIONS.get(`config:thumb:${c}`))
    );
    await sendMessage(env.BOT_TOKEN, msg.chat.id,
      `<b>Article thumbnail config:</b>\n` +
      `✊ rock: ${rock ? `<code>${rock}</code>` : 'none'}\n` +
      `✋ paper: ${paper ? `<code>${paper}</code>` : 'none'}\n` +
      `✌️ scissors: ${scissors ? `<code>${scissors}</code>` : 'none'}`
    );

  } else {
    await sendMessage(env.BOT_TOKEN, msg.chat.id,
      '<b>Owner commands:</b>\n' +
      '/setthumb [rock|paper|scissors] [url] — set article thumbnail\n' +
      '/delthumb [rock|paper|scissors] — remove thumbnail\n' +
      '/config — show current thumbnails'
    );
  }
}
