import type { Choice, Env, GameSession, PendingConfig, TelegramMessage, UserStats } from '../types';
import { editInlineMessage, sendMessage } from '../telegram';
import { hasFeature, isBetaUser } from '../feature';
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
import { escHtml, fmtEmoji, getWeekKey } from '../game';

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
  const betaUser = await isBetaUser(kv, msg.from.id, env.BOT_OWNER_ID);
  const canConfig = owner || betaUser || hasFeature(env, 'beta_config');
  const canDonate = owner || betaUser || hasFeature(env, 'donator');

  // Successful payment (no text field)
  if (msg.successful_payment) {
    await handleSuccessfulPayment(msg, env);
    return;
  }

  // ── Pending config state (handles sticker/animation/emoji messages) ──
  const pending = await kv.get<PendingConfig>(`pending:config:${msg.from.id}`, 'json');
  if (pending) {
    const stickerActions: PendingConfig['action'][] = ['setsticker', 'setglobal_sticker', 'setthumb_sticker', 'setglobal_thumb_sticker'];
    const gifActions: PendingConfig['action'][] = ['setthumb_gif', 'setglobal_thumb_gif'];
    const emojiActions: PendingConfig['action'][] = ['setemoji_reveal', 'setglobal_emoji_reveal'];

    if (msg.sticker) {
      if (stickerActions.includes(pending.action)) {
        await kv.delete(`pending:config:${msg.from.id}`);
        const fileId = msg.sticker.file_id;
        if (pending.action === 'setsticker') {
          await setUserConfig(kv, msg.from.id, { sticker: { [pending.choice]: fileId } });
          await reply(token, msg.chat.id, `✅ Popup sticker untuk ${CHOICE_EMOJI[pending.choice]} <b>${pending.choice}</b> tersimpan.`);
        } else if (pending.action === 'setglobal_sticker') {
          await setGlobalConfig(kv, { sticker: { [pending.choice]: fileId } });
          await reply(token, msg.chat.id, `✅ Global sticker untuk ${CHOICE_EMOJI[pending.choice]} <b>${pending.choice}</b> tersimpan.`);
        } else if (pending.action === 'setthumb_sticker') {
          await setUserConfig(kv, msg.from.id, { thumb: { [pending.choice]: { type: 'sticker', value: fileId } } });
          await reply(token, msg.chat.id, `✅ Thumbnail sticker untuk ${CHOICE_EMOJI[pending.choice]} <b>${pending.choice}</b> tersimpan.`);
        } else if (pending.action === 'setglobal_thumb_sticker') {
          await setGlobalConfig(kv, { thumb: { [pending.choice]: { type: 'sticker', value: fileId } } });
          await reply(token, msg.chat.id, `✅ Global thumbnail sticker untuk ${CHOICE_EMOJI[pending.choice]} <b>${pending.choice}</b> tersimpan.`);
        }
        return;
      }
      if (emojiActions.includes(pending.action)) {
        if (msg.sticker.type === 'custom_emoji' && msg.sticker.custom_emoji_id) {
          await kv.delete(`pending:config:${msg.from.id}`);
          const val = msg.sticker.custom_emoji_id;
          try {
            if (pending.action === 'setemoji_reveal') {
              await setUserConfig(kv, msg.from.id, { reveal: { [pending.choice]: val } as Record<Choice, string> });
            } else {
              await setGlobalConfig(kv, { reveal: { [pending.choice]: val } as Record<Choice, string> });
            }
            await reply(token, msg.chat.id, `✅ Reveal emoji (animasi) untuk ${CHOICE_EMOJI[pending.choice]} <b>${pending.choice}</b> tersimpan.`);
          } catch (e) {
            await reply(token, msg.chat.id, `❌ Gagal simpan: ${String(e)}`);
          }
        } else {
          await reply(token, msg.chat.id,
            `⚠️ Ini stiker biasa, bukan custom emoji.\n` +
            `Kirim custom emoji dari emoji picker, atau /setsticker ${pending.choice} untuk set popup stiker.`
          );
        }
        return;
      }
    }

    if (msg.animation && gifActions.includes(pending.action)) {
      await kv.delete(`pending:config:${msg.from.id}`);
      const fileId = msg.animation.file_id;
      if (pending.action === 'setthumb_gif') {
        await setUserConfig(kv, msg.from.id, { thumb: { [pending.choice]: { type: 'gif', value: fileId } } });
        await reply(token, msg.chat.id, `✅ Thumbnail GIF untuk ${CHOICE_EMOJI[pending.choice]} <b>${pending.choice}</b> tersimpan.`);
      } else {
        await setGlobalConfig(kv, { thumb: { [pending.choice]: { type: 'gif', value: fileId } } });
        await reply(token, msg.chat.id, `✅ Global thumbnail GIF untuk ${CHOICE_EMOJI[pending.choice]} <b>${pending.choice}</b> tersimpan.`);
      }
      return;
    }

    if (msg.text && emojiActions.includes(pending.action) && !msg.text.trimStart().startsWith('/')) {
      await kv.delete(`pending:config:${msg.from.id}`);
      const customEmoji = msg.entities?.find(e => e.type === 'custom_emoji');
      const val = customEmoji?.custom_emoji_id ?? msg.text.trim();
      try {
        const fallbackChar = msg.text?.trim() ?? '?';
        if (pending.action === 'setemoji_reveal') {
          await setUserConfig(kv, msg.from.id, { reveal: { [pending.choice]: val } as Record<Choice, string> });
          await reply(token, msg.chat.id, `✅ Reveal emoji untuk ${CHOICE_EMOJI[pending.choice]} <b>${pending.choice}</b> diset ke: ${fmtEmoji(val, fallbackChar)}`);
        } else {
          await setGlobalConfig(kv, { reveal: { [pending.choice]: val } as Record<Choice, string> });
          await reply(token, msg.chat.id, `✅ Global reveal emoji untuk ${CHOICE_EMOJI[pending.choice]} <b>${pending.choice}</b> diset ke: ${fmtEmoji(val, fallbackChar)}`);
        }
      } catch (e) {
        await reply(token, msg.chat.id, `❌ Gagal simpan: ${String(e)}`);
      }
      return;
    }

    // Message type tidak cocok dengan pending yang diharapkan — kasih feedback
    if (!msg.text) {
      const expected = stickerActions.includes(pending.action) ? 'stiker'
        : gifActions.includes(pending.action) ? 'GIF'
        : 'emoji';
      await reply(token, msg.chat.id, `⚠️ Kirim ${expected} ya, bukan tipe file lain. Atau /cancel untuk batal.`);
      return;
    }
  }

  if (!msg.text) return;

  const parts = msg.text.trim().split(/\s+/);
  const cmd = parts[0].toLowerCase();

  // ── Available to all users ───────────────────────────────────────────
  if (cmd === '/cancel') {
    const had = await kv.get(`pending:config:${msg.from.id}`);
    await kv.delete(`pending:config:${msg.from.id}`);
    await reply(token, msg.chat.id, had ? '❌ Dibatalkan.' : '❌ Tidak ada yang perlu dibatalkan.');
    return;
  }

  if (cmd === '/syncstats') {
    const weekKey = getWeekKey();
    const lifetime = await kv.get<UserStats>(`stats:${msg.from.id}`, 'json');
    if (!lifetime) {
      await sendMessage(token, msg.chat.id, '📊 No stats found. Play some games first!');
      return;
    }
    await kv.put(
      `stats:${msg.from.id}:week:${weekKey}`,
      JSON.stringify({ wins: lifetime.wins, losses: lifetime.losses, draws: lifetime.draws, total: lifetime.total }),
      { expirationTtl: 7 * 24 * 3600 }
    );
    await sendMessage(token, msg.chat.id,
      `✅ Weekly stats synced!\n🏆 ${lifetime.wins}W · 😔 ${lifetime.losses}L · 🤝 ${lifetime.draws}D`
    );
    return;
  }
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
    // Accept both: /setemoji rock  AND  /setemoji reveal rock
    const rawChoice = parts[1]?.toLowerCase() === 'reveal' ? parts[2]?.toLowerCase() : parts[1]?.toLowerCase();
    const rawValue  = parts[1]?.toLowerCase() === 'reveal' ? parts[3] : parts[2];
    const choice = rawChoice as Choice;
    if (!choice || !CHOICES.includes(choice)) {
      await reply(token, msg.chat.id,
        '<b>/setemoji usage:</b>\n' +
        '/setemoji [rock|paper|scissors] — lalu kirim emoji\n' +
        '/setemoji reveal [rock|paper|scissors] — sama saja'
      );
      return;
    }
    if (rawValue) {
      // Kalau emoji custom ditulis inline dalam command, ambil custom_emoji_id dari entities
      const inlineCE = msg.entities?.find(e => e.type === 'custom_emoji');
      const val = inlineCE?.custom_emoji_id ?? rawValue;
      await setUserConfig(kv, msg.from.id, { reveal: { [choice]: val } as Record<Choice, string> });
      await reply(token, msg.chat.id, `✅ Reveal emoji untuk ${CHOICE_EMOJI[choice]} <b>${choice}</b> diset ke: ${fmtEmoji(val, rawValue)}`);
      return;
    }
    await kv.put(`pending:config:${msg.from.id}`, JSON.stringify({ action: 'setemoji_reveal', choice }), { expirationTtl: 300 });
    await reply(token, msg.chat.id,
      `📌 Sekarang kirim emoji untuk ${CHOICE_EMOJI[choice]} <b>${choice}</b>.\n` +
      `Bisa emoji biasa atau custom emoji animasi.\n<i>Batas waktu 5 menit · /cancel untuk batal.</i>`
    );
    return;
  }

  if (cmd === '/setsticker') {
    if (!canConfig) { await reply(token, msg.chat.id, welcomeText(env)); return; }
    const choice = parts[1]?.toLowerCase() as Choice;
    if (!choice || !CHOICES.includes(choice)) {
      await reply(token, msg.chat.id, '❌ Usage: /setsticker [rock|paper|scissors]');
      return;
    }
    if (parts[2]) {
      await setUserConfig(kv, msg.from.id, { sticker: { [choice]: parts[2] } });
      await reply(token, msg.chat.id, `✅ Popup sticker untuk ${CHOICE_EMOJI[choice]} <b>${choice}</b> tersimpan.`);
      return;
    }
    await kv.put(`pending:config:${msg.from.id}`, JSON.stringify({ action: 'setsticker', choice }), { expirationTtl: 300 });
    await reply(token, msg.chat.id,
      `📌 Sekarang kirim stiker untuk popup ${CHOICE_EMOJI[choice]} <b>${choice}</b>.\n` +
      `<i>Batas waktu 5 menit · /cancel untuk batal.</i>`
    );
    return;
  }

  if (cmd === '/setthumb') {
    if (!canConfig) { await reply(token, msg.chat.id, welcomeText(env)); return; }
    const choice = parts[1]?.toLowerCase() as Choice;
    const type = parts[2]?.toLowerCase() as 'url' | 'gif' | 'sticker';
    if (!choice || !CHOICES.includes(choice) || !type || !['url', 'gif', 'sticker'].includes(type)) {
      await reply(token, msg.chat.id, '❌ Usage: /setthumb [rock|paper|scissors] [url|gif|sticker]');
      return;
    }
    if (type === 'url') {
      if (!parts[3]) {
        await reply(token, msg.chat.id, '❌ Usage: /setthumb rock url &lt;url&gt;');
        return;
      }
      await setUserConfig(kv, msg.from.id, { thumb: { [choice]: { type: 'url', value: parts[3] } } });
      await reply(token, msg.chat.id, `✅ Thumbnail URL untuk ${CHOICE_EMOJI[choice]} <b>${choice}</b> tersimpan.`);
      return;
    }
    if (parts[3]) {
      await setUserConfig(kv, msg.from.id, { thumb: { [choice]: { type, value: parts[3] } } });
      await reply(token, msg.chat.id, `✅ Thumbnail untuk ${CHOICE_EMOJI[choice]} <b>${choice}</b> tersimpan (${type}).`);
      return;
    }
    const action = type === 'gif' ? 'setthumb_gif' : 'setthumb_sticker';
    const prompt = type === 'gif' ? 'kirim GIF' : 'kirim stiker';
    await kv.put(`pending:config:${msg.from.id}`, JSON.stringify({ action, choice }), { expirationTtl: 300 });
    await reply(token, msg.chat.id,
      `📌 Sekarang ${prompt} untuk thumbnail ${CHOICE_EMOJI[choice]} <b>${choice}</b>.\n` +
      `<i>Batas waktu 5 menit · /cancel untuk batal.</i>`
    );
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
    if (sub === 'emoji' && parts[2]?.toLowerCase() === 'reveal' && parts.length >= 4) {
      const choice = parts[3].toLowerCase() as Choice;
      if (!CHOICES.includes(choice)) { await reply(token, msg.chat.id, '❌ Invalid choice.'); return; }
      if (parts[4]) {
        await setGlobalConfig(kv, { reveal: { [choice]: parts[4] } as Record<Choice, string> });
        await reply(token, msg.chat.id, `✅ Global reveal emoji untuk ${CHOICE_EMOJI[choice]} <b>${choice}</b> diset.`);
        return;
      }
      await kv.put(`pending:config:${msg.from.id}`, JSON.stringify({ action: 'setglobal_emoji_reveal', choice }), { expirationTtl: 300 });
      await reply(token, msg.chat.id,
        `📌 Sekarang kirim emoji untuk global reveal ${CHOICE_EMOJI[choice]} <b>${choice}</b>.\n` +
        `<i>Batas waktu 5 menit · /cancel untuk batal.</i>`
      );
    } else if (sub === 'sticker' && parts.length >= 3) {
      const choice = parts[2].toLowerCase() as Choice;
      if (!CHOICES.includes(choice)) { await reply(token, msg.chat.id, '❌ Invalid choice.'); return; }
      if (parts[3]) {
        await setGlobalConfig(kv, { sticker: { [choice]: parts[3] } });
        await reply(token, msg.chat.id, `✅ Global sticker untuk ${CHOICE_EMOJI[choice]} <b>${choice}</b> tersimpan.`);
        return;
      }
      await kv.put(`pending:config:${msg.from.id}`, JSON.stringify({ action: 'setglobal_sticker', choice }), { expirationTtl: 300 });
      await reply(token, msg.chat.id,
        `📌 Sekarang kirim stiker untuk global popup ${CHOICE_EMOJI[choice]} <b>${choice}</b>.\n` +
        `<i>Batas waktu 5 menit · /cancel untuk batal.</i>`
      );
    } else if (sub === 'thumb' && parts.length >= 4) {
      const choice = parts[2].toLowerCase() as Choice;
      const type = parts[3].toLowerCase() as 'url' | 'gif' | 'sticker';
      if (!CHOICES.includes(choice) || !['url', 'gif', 'sticker'].includes(type)) {
        await reply(token, msg.chat.id, '❌ Invalid choice or type.');
        return;
      }
      if (type === 'url') {
        if (!parts[4]) { await reply(token, msg.chat.id, '❌ Usage: /setglobal thumb rock url &lt;url&gt;'); return; }
        await setGlobalConfig(kv, { thumb: { [choice]: { type: 'url', value: parts[4] } } });
        await reply(token, msg.chat.id, `✅ Global thumbnail URL untuk ${CHOICE_EMOJI[choice]} <b>${choice}</b> tersimpan.`);
        return;
      }
      if (parts[4]) {
        await setGlobalConfig(kv, { thumb: { [choice]: { type, value: parts[4] } } });
        await reply(token, msg.chat.id, `✅ Global thumbnail untuk ${CHOICE_EMOJI[choice]} <b>${choice}</b> tersimpan (${type}).`);
        return;
      }
      const action = type === 'gif' ? 'setglobal_thumb_gif' : 'setglobal_thumb_sticker';
      const prompt = type === 'gif' ? 'kirim GIF' : 'kirim stiker';
      await kv.put(`pending:config:${msg.from.id}`, JSON.stringify({ action, choice }), { expirationTtl: 300 });
      await reply(token, msg.chat.id,
        `📌 Sekarang ${prompt} untuk global thumbnail ${CHOICE_EMOJI[choice]} <b>${choice}</b>.\n` +
        `<i>Batas waktu 5 menit · /cancel untuk batal.</i>`
      );
    } else {
      await reply(token, msg.chat.id,
        '<b>/setglobal usage:</b>\n' +
        '/setglobal emoji reveal [rock|paper|scissors]\n' +
        '/setglobal sticker [rock|paper|scissors]\n' +
        '/setglobal thumb [rock|paper|scissors] [url|gif|sticker]'
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
    `/setemoji reveal [rock|paper|scissors] — lalu kirim emoji\n` +
    `/setsticker [rock|paper|scissors] — lalu kirim stiker\n` +
    `/setthumb [rock|paper|scissors] [url|gif|sticker] — lalu kirim media\n` +
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
