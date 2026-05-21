import type { Choice, Env, GameSession, TelegramMessage } from '../types';
import { editInlineMessage, sendMessage } from '../telegram';
import { hasFeature } from '../feature';
import {
  loadConfig,
  setUserConfig,
  setGlobalConfig,
  getUserConfigRaw,
  getGlobalConfigRaw,
  resetUserConfig,
  resetGlobalConfig,
} from '../config';
import { activateTier, loadDonatorTier, TIER_PERKS, tierBadge } from '../donator';
import { handleDonate, handleSuccessfulPayment } from './payment';
import { escHtml } from '../game';

const CHOICES: Choice[] = ['rock', 'paper', 'scissors'];
const CHOICE_EMOJI: Record<Choice, string> = { rock: '✊', paper: '✋', scissors: '✌️' };

function isOwner(msg: TelegramMessage, env: Env): boolean {
  return String(msg.from!.id) === env.BOT_OWNER_ID;
}

function reply(token: string, chatId: number, text: string) {
  return sendMessage(token, chatId, text);
}

export async function handleMessage(msg: TelegramMessage, env: Env): Promise<void> {
  if (!msg.from || msg.chat.type !== 'private') return;

  const token = env.BOT_TOKEN;
  const kv = env.GAME_SESSIONS;
  const owner = isOwner(msg, env);
  const canConfig = owner || hasFeature(env, 'beta_config');
  const canDonate = owner || hasFeature(env, 'donator');

  // Successful payment (no text field)
  if (msg.successful_payment) {
    await handleSuccessfulPayment(msg, env);
    return;
  }

  if (!msg.text) return;

  const parts = msg.text.trim().split(/\s+/);
  const cmd = parts[0].toLowerCase();

  // ── Available to all users ───────────────────────────────────────────
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
    await reply(token, msg.chat.id,
      cancelled > 0
        ? `✅ ${cancelled} game${cancelled > 1 ? 's' : ''} cancelled.`
        : '✅ No active hosted games found.'
    );
    return;
  }

  // ── Donate ──────────────────────────────────────────────────────────
  if (cmd === '/donate') {
    if (!canDonate) {
      await reply(token, msg.chat.id, '🔒 Donation system coming soon!');
      return;
    }
    await handleDonate(msg, env);
    return;
  }

  // ── Per-user config commands ─────────────────────────────────────────
  if (cmd === '/setemoji') {
    if (!canConfig) { await reply(token, msg.chat.id, welcomeText(env)); return; }
    if (parts[1]?.toLowerCase() === 'reveal' && parts.length >= 4) {
      const choice = parts[2].toLowerCase() as Choice;
      if (!CHOICES.includes(choice)) {
        await reply(token, msg.chat.id, '❌ Usage: /setemoji reveal [rock|paper|scissors] &lt;emoji_or_id&gt;');
        return;
      }
      const val = parts[3];
      await setUserConfig(kv, msg.from.id, { reveal: { [choice]: val } as Record<Choice, string> });
      await reply(token, msg.chat.id, `✅ Reveal emoji for <b>${choice}</b> set to: ${val}`);
    } else {
      await reply(token, msg.chat.id,
        '<b>/setemoji usage:</b>\n' +
        '/setemoji reveal [rock|paper|scissors] &lt;emoji_or_custom_id&gt;'
      );
    }
    return;
  }

  if (cmd === '/setsticker') {
    if (!canConfig) { await reply(token, msg.chat.id, welcomeText(env)); return; }
    if (parts.length >= 3) {
      const choice = parts[1].toLowerCase() as Choice;
      if (!CHOICES.includes(choice)) {
        await reply(token, msg.chat.id, '❌ Usage: /setsticker [rock|paper|scissors] &lt;file_id&gt;');
        return;
      }
      await setUserConfig(kv, msg.from.id, { sticker: { [choice]: parts[2] } });
      await reply(token, msg.chat.id, `✅ Popup sticker for <b>${choice}</b> set.`);
    } else {
      await reply(token, msg.chat.id, '❌ Usage: /setsticker [rock|paper|scissors] &lt;file_id&gt;');
    }
    return;
  }

  if (cmd === '/setthumb') {
    if (!canConfig) { await reply(token, msg.chat.id, welcomeText(env)); return; }
    if (parts.length >= 4) {
      const choice = parts[1].toLowerCase() as Choice;
      const type = parts[2].toLowerCase() as 'url' | 'gif' | 'sticker';
      const value = parts[3];
      if (!CHOICES.includes(choice) || !['url', 'gif', 'sticker'].includes(type)) {
        await reply(token, msg.chat.id, '❌ Usage: /setthumb [rock|paper|scissors] [url|gif|sticker] &lt;value&gt;');
        return;
      }
      await setUserConfig(kv, msg.from.id, { thumb: { [choice]: { type, value } } });
      await reply(token, msg.chat.id, `✅ Thumbnail for <b>${choice}</b> set (${type}).`);
    } else {
      await reply(token, msg.chat.id, '❌ Usage: /setthumb [rock|paper|scissors] [url|gif|sticker] &lt;value&gt;');
    }
    return;
  }

  if (cmd === '/delthumb') {
    if (!canConfig) { await reply(token, msg.chat.id, welcomeText(env)); return; }
    if (parts.length >= 2) {
      const choice = parts[1].toLowerCase() as Choice;
      if (!CHOICES.includes(choice)) {
        await reply(token, msg.chat.id, '❌ Usage: /delthumb [rock|paper|scissors]');
        return;
      }
      const raw = await getUserConfigRaw(kv, msg.from.id);
      if (raw?.thumb) {
        delete (raw.thumb as Record<string, unknown>)[choice];
        await kv.put(`config:user:${msg.from.id}`, JSON.stringify(raw));
      }
      await reply(token, msg.chat.id, `✅ Thumbnail for <b>${choice}</b> removed.`);
    } else {
      await reply(token, msg.chat.id, '❌ Usage: /delthumb [rock|paper|scissors]');
    }
    return;
  }

  if (cmd === '/myconfig') {
    if (!canConfig) { await reply(token, msg.chat.id, welcomeText(env)); return; }
    const [merged, raw] = await Promise.all([
      loadConfig(kv, msg.from.id, env),
      getUserConfigRaw(kv, msg.from.id),
    ]);
    const tier = await loadDonatorTier(kv, msg.from.id);
    let text = `⚙️ <b>Your config</b>${tierBadge(tier)}\n\n`;
    text += `<b>Reveal emoji:</b>\n`;
    for (const c of CHOICES) text += `  ${CHOICE_EMOJI[c]} ${c}: ${merged.reveal[c]}\n`;
    text += `\n<b>Popup sticker:</b>\n`;
    for (const c of CHOICES) {
      const v = merged.sticker[c];
      text += `  ${CHOICE_EMOJI[c]} ${c}: ${v ? v.slice(0, 20) + '…' : '(default)'}\n`;
    }
    text += `\n<b>Thumbnail:</b>\n`;
    for (const c of CHOICES) {
      const v = merged.thumb[c];
      text += `  ${CHOICE_EMOJI[c]} ${c}: ${v ? `${v.type} — ${v.value.slice(0, 20)}…` : '(none)'}\n`;
    }
    if (!raw || Object.keys(raw).length === 0) {
      text += '\n<i>No personal overrides — using global/default.</i>';
    }
    await reply(token, msg.chat.id, text);
    return;
  }

  if (cmd === '/reset') {
    if (!canConfig) { await reply(token, msg.chat.id, welcomeText(env)); return; }
    await resetUserConfig(kv, msg.from.id);
    await reply(token, msg.chat.id, '✅ Config reset to global/default.');
    return;
  }

  // ── Owner-only commands ──────────────────────────────────────────────
  if (!owner) {
    await reply(token, msg.chat.id, welcomeText(env));
    return;
  }

  if (cmd === '/setglobal') {
    const sub = parts[1]?.toLowerCase();
    if (sub === 'emoji' && parts[2]?.toLowerCase() === 'reveal' && parts.length >= 5) {
      const choice = parts[3].toLowerCase() as Choice;
      if (!CHOICES.includes(choice)) { await reply(token, msg.chat.id, '❌ Invalid choice.'); return; }
      await setGlobalConfig(kv, { reveal: { [choice]: parts[4] } as Record<Choice, string> });
      await reply(token, msg.chat.id, `✅ Global reveal emoji for <b>${choice}</b> set.`);
    } else if (sub === 'sticker' && parts.length >= 4) {
      const choice = parts[2].toLowerCase() as Choice;
      if (!CHOICES.includes(choice)) { await reply(token, msg.chat.id, '❌ Invalid choice.'); return; }
      await setGlobalConfig(kv, { sticker: { [choice]: parts[3] } });
      await reply(token, msg.chat.id, `✅ Global sticker for <b>${choice}</b> set.`);
    } else if (sub === 'thumb' && parts.length >= 5) {
      const choice = parts[2].toLowerCase() as Choice;
      const type = parts[3].toLowerCase() as 'url' | 'gif' | 'sticker';
      if (!CHOICES.includes(choice) || !['url', 'gif', 'sticker'].includes(type)) {
        await reply(token, msg.chat.id, '❌ Invalid choice or type.');
        return;
      }
      await setGlobalConfig(kv, { thumb: { [choice]: { type, value: parts[4] } } });
      await reply(token, msg.chat.id, `✅ Global thumb for <b>${choice}</b> set (${type}).`);
    } else {
      await reply(token, msg.chat.id,
        '<b>/setglobal usage:</b>\n' +
        '/setglobal emoji reveal [rock|paper|scissors] &lt;val&gt;\n' +
        '/setglobal sticker [rock|paper|scissors] &lt;file_id&gt;\n' +
        '/setglobal thumb [rock|paper|scissors] [url|gif|sticker] &lt;value&gt;'
      );
    }
    return;
  }

  if (cmd === '/globalconfig') {
    const global = await getGlobalConfigRaw(kv);
    if (!global || Object.keys(global).length === 0) {
      await reply(token, msg.chat.id, '📋 No global config set. Using env var defaults.');
    } else {
      await reply(token, msg.chat.id, `📋 <b>Global config:</b>\n<pre>${escHtml(JSON.stringify(global, null, 2))}</pre>`);
    }
    return;
  }

  if (cmd === '/resetglobal') {
    await resetGlobalConfig(kv);
    await reply(token, msg.chat.id, '✅ Global config reset.');
    return;
  }

  if (cmd === '/betaadd' && parts.length >= 2) {
    const targetId = parseInt(parts[1]);
    if (isNaN(targetId)) { await reply(token, msg.chat.id, '❌ Invalid user ID.'); return; }
    const list = await kv.get<number[]>('beta:approved', 'json') ?? [];
    if (!list.includes(targetId)) {
      list.push(targetId);
      await kv.put('beta:approved', JSON.stringify(list));
    }
    await reply(token, msg.chat.id, `✅ ${targetId} added to beta list.`);
    return;
  }

  if (cmd === '/betaremove' && parts.length >= 2) {
    const targetId = parseInt(parts[1]);
    if (isNaN(targetId)) { await reply(token, msg.chat.id, '❌ Invalid user ID.'); return; }
    const list = (await kv.get<number[]>('beta:approved', 'json') ?? []).filter(id => id !== targetId);
    await kv.put('beta:approved', JSON.stringify(list));
    await reply(token, msg.chat.id, `✅ ${targetId} removed from beta list.`);
    return;
  }

  if (cmd === '/betalist') {
    const list = await kv.get<number[]>('beta:approved', 'json') ?? [];
    await reply(token, msg.chat.id,
      list.length === 0
        ? '📋 Beta approved list is empty.'
        : `📋 <b>Beta approved (${list.length}):</b>\n${list.join(', ')}`
    );
    return;
  }

  if (cmd === '/setprice' && parts.length >= 4) {
    const tier = parts[1].toLowerCase();
    const method = parts[2].toLowerCase();
    const amount = parseInt(parts[3]);
    if (!['basic', 'premium'].includes(tier) || !['stars', 'stripe'].includes(method) || isNaN(amount)) {
      await reply(token, msg.chat.id, '❌ Usage: /setprice [basic|premium] [stars|stripe] &lt;amount&gt;');
      return;
    }
    await kv.put(`config:price:${tier}:${method}`, String(amount));
    await reply(token, msg.chat.id, `✅ Price for ${tier} ${method} set to ${amount}.`);
    return;
  }

  if (cmd === '/prices') {
    const [bs, bp, ps, pp] = await Promise.all([
      kv.get('config:price:basic:stars'),
      kv.get('config:price:basic:stripe'),
      kv.get('config:price:premium:stars'),
      kv.get('config:price:premium:stripe'),
    ]);
    await reply(token, msg.chat.id,
      `💰 <b>Current prices:</b>\n` +
      `🥉 Basic: ${bs ?? 50} ⭐ · $${((parseInt(bp ?? '500')) / 100).toFixed(2)} Stripe\n` +
      `🥇 Premium: ${ps ?? 200} ⭐ · $${((parseInt(pp ?? '2000')) / 100).toFixed(2)} Stripe`
    );
    return;
  }

  if (cmd === '/adddonator' && parts.length >= 3) {
    const targetId = parseInt(parts[1]);
    const tier = parts[2].toLowerCase() as 'basic' | 'premium';
    if (isNaN(targetId) || !['basic', 'premium'].includes(tier)) {
      await reply(token, msg.chat.id, '❌ Usage: /adddonator &lt;userId&gt; [basic|premium]');
      return;
    }
    await activateTier(kv, targetId, tier, 'stars');
    await reply(token, msg.chat.id, `✅ <b>${TIER_PERKS[tier].label}</b> activated for ${targetId} (30 days).`);
    return;
  }

  if (cmd === '/removedonator' && parts.length >= 2) {
    const targetId = parseInt(parts[1]);
    if (isNaN(targetId)) { await reply(token, msg.chat.id, '❌ Invalid user ID.'); return; }
    await kv.delete(`donator:${targetId}`);
    await reply(token, msg.chat.id, `✅ Donator record removed for ${targetId}.`);
    return;
  }

  await reply(token, msg.chat.id,
    `<b>Owner Commands:</b>\n` +
    `/setglobal emoji|sticker|thumb ...\n` +
    `/globalconfig · /resetglobal\n` +
    `/betaadd &lt;id&gt; · /betaremove &lt;id&gt; · /betalist\n` +
    `/setprice [basic|premium] [stars|stripe] &lt;amount&gt; · /prices\n` +
    `/adddonator &lt;id&gt; [basic|premium] · /removedonator &lt;id&gt;\n\n` +
    `<b>User Commands (with beta_config flag):</b>\n` +
    `/setemoji reveal [rock|paper|scissors] &lt;emoji&gt;\n` +
    `/setsticker [rock|paper|scissors] &lt;file_id&gt;\n` +
    `/setthumb [rock|paper|scissors] [url|gif|sticker] &lt;value&gt;\n` +
    `/delthumb [rock|paper|scissors] · /myconfig · /reset\n` +
    `/donate\n\n` +
    `<b>All Users:</b>\n` +
    `/clearhost`
  );
}

function welcomeText(env: Env): string {
  return (
    `👋 Use <code>@${env.BOT_USERNAME}</code> inline to play Rock Paper Scissors!\n\n` +
    `<b>Commands:</b>\n` +
    `/clearhost — Cancel all games you're currently hosting\n\n` +
    `Inline: <code>@${env.BOT_USERNAME} STATS</code> to check your stats.`
  );
}
