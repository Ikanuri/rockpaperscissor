import type { Choice, Env, TelegramMessage } from '../types';
import { sendMessage } from '../telegram';

const CHOICES: Choice[] = ['rock', 'paper', 'scissors'];

export async function handleMessage(msg: TelegramMessage, env: Env): Promise<void> {
  if (!msg.from || !msg.text || msg.chat.type !== 'private') return;

  const token = env.BOT_TOKEN;
  const kv = env.GAME_SESSIONS;

  if (String(msg.from.id) !== env.BOT_OWNER_ID) {
    await sendMessage(token, msg.chat.id,
      `👋 Use <code>@${env.BOT_USERNAME}</code> inline to play Rock Paper Scissors!\n\n` +
      `Type <code>@${env.BOT_USERNAME} STATS</code> to check your stats.`
    );
    return;
  }

  const parts = msg.text.trim().split(/\s+/);
  const cmd = parts[0].toLowerCase();

  if (cmd === '/setthumb' && parts.length >= 3) {
    const choice = parts[1].toLowerCase() as Choice;
    if (!CHOICES.includes(choice)) {
      await sendMessage(token, msg.chat.id, '❌ Usage: /setthumb [rock|paper|scissors] <url>');
      return;
    }
    await kv.put(`config:thumb:${choice}`, parts[2]);
    await sendMessage(token, msg.chat.id, `✅ Thumbnail for <b>${choice}</b> set.`);
  } else if (cmd === '/delthumb' && parts.length >= 2) {
    const choice = parts[1].toLowerCase();
    if (!CHOICES.includes(choice as Choice)) {
      await sendMessage(token, msg.chat.id, '❌ Invalid choice.');
      return;
    }
    await kv.delete(`config:thumb:${choice}`);
    await sendMessage(token, msg.chat.id, `✅ Thumbnail for <b>${choice}</b> removed.`);
  } else if (cmd === '/config') {
    const [r, p, s] = await Promise.all(CHOICES.map(c => kv.get(`config:thumb:${c}`)));
    await sendMessage(token, msg.chat.id,
      `<b>Thumbnails:</b>\nrock: ${r ?? 'none'}\npaper: ${p ?? 'none'}\nscissors: ${s ?? 'none'}`
    );
  } else {
    await sendMessage(token, msg.chat.id,
      `<b>Owner Commands:</b>\n` +
      `/setthumb [rock|paper|scissors] &lt;url&gt;\n` +
      `/delthumb [rock|paper|scissors]\n` +
      `/config`
    );
  }
}
