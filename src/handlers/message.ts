import type { Choice, Env, GameSession, TelegramMessage } from '../types';
import { editInlineMessage, sendMessage } from '../telegram';

const CHOICES: Choice[] = ['rock', 'paper', 'scissors'];

export async function handleMessage(msg: TelegramMessage, env: Env): Promise<void> {
  if (!msg.from || !msg.text || msg.chat.type !== 'private') return;

  const token = env.BOT_TOKEN;
  const kv = env.GAME_SESSIONS;
  const parts = msg.text.trim().split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const isOwner = String(msg.from.id) === env.BOT_OWNER_ID;

  // ── Available to all users ──────────────────────────────────────────
  if (cmd === '/clearhost') {
    const listKey = `hostgames:${msg.from.id}`;
    const gameIds = await kv.get<string[]>(listKey, 'json') ?? [];
    let cancelled = 0;
    for (const gameId of gameIds) {
      const session = await kv.get<GameSession>(`game:${gameId}`, 'json');
      if (session && session.status === 'waiting' && session.hostUserId === msg.from.id) {
        await Promise.all([
          kv.delete(`game:${gameId}`),
          editInlineMessage(token, session.hostInlineMessageId, '❌ Game cancelled.'),
        ]);
        cancelled++;
      }
    }
    await Promise.all([
      kv.delete(listKey),
      kv.put(`ratelimit:${msg.from.id}`, '0', { expirationTtl: 600 }),
    ]);
    await sendMessage(token, msg.chat.id,
      cancelled > 0
        ? `✅ ${cancelled} game${cancelled > 1 ? 's' : ''} cancelled.`
        : '✅ No active hosted games found.'
    );
    return;
  }

  // ── Owner-only commands ──────────────────────────────────────────────
  if (!isOwner) {
    await sendMessage(token, msg.chat.id,
      `👋 Use <code>@${env.BOT_USERNAME}</code> inline to play!\n\n` +
      `<b>Commands:</b>\n` +
      `/clearhost — Cancel all games you're currently hosting\n\n` +
      `Inline: <code>@${env.BOT_USERNAME} STATS</code> to check your stats.`
    );
    return;
  }

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
      `/config\n\n` +
      `<b>All Users:</b>\n` +
      `/clearhost`
    );
  }
}
