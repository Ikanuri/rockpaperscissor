import type { Choice, Env, GameSession, PendingConfig, TelegramMessage, UserStats } from '../types';
import { editInlineMessage, getChatInfo, sendMessage, setMyCommands } from '../telegram';
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
import { activateTier, loadDonatorTier, parseDuration, TIER_PERKS, tierBadge } from '../donator';
import { handleDonate, handleSuccessfulPayment } from './payment';
import { escHtml, fmtEmoji, getWeekKey } from '../game';

const CHOICES: Choice[] = ['rock', 'paper', 'scissors'];
const CHOICE_EMOJI: Record<Choice, string> = { rock: '✊', paper: '✋', scissors: '✌️' };

async function resolveUserDisplay(
  kv: KVNamespace,
  token: string,
  uid: number
): Promise<string> {
  let info = await kv.get<{ name: string; username: string | null }>(`user:info:${uid}`, 'json');
  if (!info) {
    const chat = await getChatInfo(token, uid);
    if (chat?.first_name) {
      info = { name: chat.first_name, username: chat.username ?? null };
      kv.put(`user:info:${uid}`, JSON.stringify(info));
    }
  }
  if (!info) return `<code>${uid}</code>`;
  return `${escHtml(info.name)}${info.username ? ` @${info.username}` : ''} (<code>${uid}</code>)`;
}

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
  const tier = await loadDonatorTier(kv, msg.from.id);
  const canConfig = owner || betaUser || tier !== 'free' || hasFeature(env, 'beta_config');
  const canDonate = owner || betaUser || hasFeature(env, 'donator');

  // Cache user info setiap DM — dipakai untuk tampilan donatorlist dll.
  kv.put(`user:info:${msg.from.id}`, JSON.stringify({
    name: msg.from.first_name,
    username: msg.from.username ?? null,
  }));

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
      const customEmoji = msg.entities?.find(e => e.type === 'custom_emoji');
      const val = customEmoji?.custom_emoji_id ?? msg.text.trim();
      const isAnimated = /^\d{10,}$/.test(val);
      if (isAnimated && tier !== 'premium' && !owner && !betaUser) {
        await reply(token, msg.chat.id,
          `🔒 Animated emoji butuh <b>Premium</b> tier.\n` +
          `/donate untuk upgrade.`
        );
        return;
      }
      await kv.delete(`pending:config:${msg.from.id}`);
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
    if (!canConfig) { await reply(token, msg.chat.id, '🔒 Fitur ini butuh <b>Basic</b> tier.\n/donate untuk upgrade.'); return; }
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
      const inlineCE = msg.entities?.find(e => e.type === 'custom_emoji');
      const val = inlineCE?.custom_emoji_id ?? rawValue;
      const isAnimated = /^\d{10,}$/.test(val);
      if (isAnimated && tier !== 'premium' && !owner && !betaUser) {
        await reply(token, msg.chat.id, `🔒 Animated emoji butuh <b>Premium</b> tier.\n/donate untuk upgrade.`);
        return;
      }
      await setUserConfig(kv, msg.from.id, { reveal: { [choice]: val } as Record<Choice, string> });
      await reply(token, msg.chat.id, `✅ Reveal emoji untuk ${CHOICE_EMOJI[choice]} <b>${choice}</b> diset ke: ${fmtEmoji(val, rawValue)}`);
      return;
    }
    const tierHint = (tier === 'basic' && !owner && !betaUser)
      ? `\nEmoji biasa saja — animated emoji butuh Premium.`
      : `\nBisa emoji biasa atau custom emoji animasi.`;
    await kv.put(`pending:config:${msg.from.id}`, JSON.stringify({ action: 'setemoji_reveal', choice }), { expirationTtl: 300 });
    await reply(token, msg.chat.id,
      `📌 Sekarang kirim emoji untuk ${CHOICE_EMOJI[choice]} <b>${choice}</b>.${tierHint}\n` +
      `<i>Batas waktu 5 menit · /cancel untuk batal.</i>`
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
    try {
      const list = await kv.get<number[]>('beta:approved', 'json') ?? [];
      const alreadyIn = list.includes(targetId);
      if (!alreadyIn) {
        list.push(targetId);
        await kv.put('beta:approved', JSON.stringify(list));
      }
      const note = alreadyIn ? ' (already in list)' : '';
      await reply(token, msg.chat.id,
        `✅ ${targetId} added to beta list${note}.\n` +
        `📋 Current list (${list.length}): ${list.join(', ') || '(empty)'}`
      );
    } catch (e) {
      await reply(token, msg.chat.id, `❌ Failed: ${String(e)}`);
    }
    return;
  }

  if (cmd === '/betaremove' && parts.length >= 2) {
    const targetId = parseInt(parts[1]);
    if (isNaN(targetId)) { await reply(token, msg.chat.id, '❌ Invalid user ID.'); return; }
    try {
      const list = (await kv.get<number[]>('beta:approved', 'json') ?? []).filter(id => id !== targetId);
      await kv.put('beta:approved', JSON.stringify(list));
      await reply(token, msg.chat.id,
        `✅ ${targetId} removed from beta list.\n` +
        `📋 Current list (${list.length}): ${list.join(', ') || '(empty)'}`
      );
    } catch (e) {
      await reply(token, msg.chat.id, `❌ Failed: ${String(e)}`);
    }
    return;
  }

  if (cmd === '/betalist') {
    try {
      const list = await kv.get<number[]>('beta:approved', 'json') ?? [];
      if (list.length === 0) {
        await reply(token, msg.chat.id, '📋 Beta approved list is empty.');
        return;
      }
      const lines = await Promise.all(
        list.map(async uid => `  🧪 ${await resolveUserDisplay(kv, token, uid)}`)
      );
      await reply(token, msg.chat.id,
        `📋 <b>Beta approved (${list.length}):</b>\n` + lines.join('\n')
      );
    } catch (e) {
      await reply(token, msg.chat.id, `❌ Failed to read list: ${String(e)}`);
    }
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
    const userIds = parts.slice(1).map(s => parseInt(s)).filter(n => !isNaN(n));
    if (userIds.length === 0) { await reply(token, msg.chat.id, '❌ Invalid user ID(s).'); return; }
    await Promise.all(userIds.map(uid => kv.delete(`donator:${uid}`)));
    const idList = (await kv.get<number[]>('donators:ids', 'json') ?? []).filter(id => !userIds.includes(id));
    await kv.put('donators:ids', JSON.stringify(idList));
    await reply(token, msg.chat.id, `✅ Donator record removed for ${userIds.length} user(s): ${userIds.join(', ')}`);
    return;
  }

  if (cmd === '/donatorlist') {
    const idList = await kv.get<number[]>('donators:ids', 'json') ?? [];
    if (idList.length === 0) {
      await reply(token, msg.chat.id, '📋 Belum ada donator.');
      return;
    }
    const records = await Promise.all(idList.map(uid => kv.get<{ tier: string; expiry: number; method: string }>(`donator:${uid}`, 'json')));
    const now = Date.now();
    const lines = await Promise.all(idList.map(async (uid, i) => {
      const rec = records[i];
      const display = await resolveUserDisplay(kv, token, uid);
      if (!rec || now > rec.expiry) return `  ❌ ${display} — expired`;
      const expiryWib = new Date(rec.expiry + 7 * 3600 * 1000);
      const expiryStr = expiryWib.toISOString().slice(0, 10);
      let badge: string;
      if (rec.tier === 'premium') {
        const userCfg = await getUserConfigRaw(kv, uid);
        const customId = userCfg?.reveal?.rock;
        badge = customId ? fmtEmoji(customId, '✊') : '(✊)';
      } else {
        badge = '(✊)';
      }
      return `  ${badge} ${display}\n     until ${expiryStr} WIB`;
    }));
    await reply(token, msg.chat.id,
      `📋 <b>Donator list (${idList.length}):</b>\n` + lines.join('\n')
    );
    return;
  }

  if (cmd === '/activatetier' && parts.length >= 3) {
    // Usage: /activatetier [basic|premium] [days] userId1 userId2 ...
    const tierArg = parts[1].toLowerCase();
    if (!['basic', 'premium'].includes(tierArg)) {
      await reply(token, msg.chat.id, '❌ Usage: /activatetier [basic|premium] [days] &lt;userId&gt; [userId2 ...]');
      return;
    }
    const activeTier = tierArg as 'basic' | 'premium';
    let durationMs = 30 * 24 * 3600 * 1000;
    let durationLabel = '30d';
    let idStart = 2;
    if (parts[2] && /^\d+[md]?$/i.test(parts[2])) {
      const parsed = parseDuration(parts[2]);
      if (parsed) { durationMs = parsed; durationLabel = parts[2]; idStart = 3; }
    }
    const userIds = parts.slice(idStart).map(s => parseInt(s)).filter(n => !isNaN(n));
    if (userIds.length === 0) {
      await reply(token, msg.chat.id, '❌ Tidak ada userId valid.\nUsage: /activatetier [basic|premium] [durasi: 30 / 60m / 7d] &lt;userId&gt; [userId2 ...]');
      return;
    }
    await Promise.all(userIds.map(uid => activateTier(kv, uid, activeTier, 'stars', durationMs)));

    // Maintain donators:ids list
    const idList = await kv.get<number[]>('donators:ids', 'json') ?? [];
    for (const uid of userIds) { if (!idList.includes(uid)) idList.push(uid); }
    await kv.put('donators:ids', JSON.stringify(idList));

    const expiryMs = Date.now() + durationMs;
    const expiryUtc = new Date(expiryMs);
    const expiryWib = new Date(expiryMs + 7 * 3600 * 1000);
    const expiryStr = durationMs < 3_600_000
      ? `${expiryUtc.toISOString().slice(0, 16).replace('T', ' ')} UTC · ${expiryWib.toISOString().slice(11, 16)} WIB`
      : `${expiryUtc.toISOString().slice(0, 10)} · ${expiryWib.toISOString().slice(0, 10)} WIB`;

    const userLines = (await Promise.all(
      userIds.map(async uid => `  • ${await resolveUserDisplay(kv, token, uid)}`)
    )).join('\n');

    await reply(token, msg.chat.id,
      `✅ <b>${TIER_PERKS[activeTier].label}</b> activated · ${durationLabel}\n` +
      `⏰ Until: ${expiryStr}\n\n` +
      userLines
    );
    return;
  }

  if (cmd === '/setupcommands') {
    const userCommands = [
      { command: 'setemoji', description: 'Set custom emoji untuk reveal (rock/paper/scissors)' },
      { command: 'setsticker', description: 'Set popup stiker untuk pilihan' },
      { command: 'setthumb', description: 'Set thumbnail artikel inline (url/gif/sticker)' },
      { command: 'delthumb', description: 'Hapus thumbnail untuk pilihan' },
      { command: 'myconfig', description: 'Lihat konfigurasi aktif kamu' },
      { command: 'reset', description: 'Reset config ke default/global' },
      { command: 'donate', description: 'Upgrade ke Basic atau Premium tier' },
      { command: 'cancel', description: 'Batalkan aksi pending (setemoji dll)' },
      { command: 'clearhost', description: 'Batalkan semua game yang sedang kamu host' },
    ];
    const ownerCommands = [
      ...userCommands,
      { command: 'setglobal', description: 'Set config global (emoji/sticker/thumb)' },
      { command: 'globalconfig', description: 'Lihat config global saat ini' },
      { command: 'resetglobal', description: 'Reset config global' },
      { command: 'betaadd', description: 'Tambah user ke beta allowlist' },
      { command: 'betaremove', description: 'Hapus user dari beta allowlist' },
      { command: 'betalist', description: 'Lihat beta allowlist' },
      { command: 'activatetier', description: 'Aktifkan tier donator manual (QRIS dll)' },
      { command: 'adddonator', description: 'Alias activatetier (legacy)' },
      { command: 'removedonator', description: 'Hapus record donator' },
      { command: 'setprice', description: 'Set harga tier (stars/stripe)' },
      { command: 'prices', description: 'Lihat harga tier saat ini' },
      { command: 'setupcommands', description: 'Register command list ke Telegram (owner only)' },
    ];
    const ownerId = parseInt(env.BOT_OWNER_ID);
    await Promise.all([
      setMyCommands(token, userCommands, { type: 'default' }),
      setMyCommands(token, ownerCommands, { type: 'chat', chat_id: ownerId }),
    ]);
    await reply(token, msg.chat.id,
      `✅ Commands registered.\n` +
      `👤 Default: ${userCommands.length} commands\n` +
      `👑 Owner (chat ${ownerId}): ${ownerCommands.length} commands`
    );
    return;
  }

  if (cmd === '/riverwas') {
    await reply(token, msg.chat.id,
      `📖 <b>Semua Command @${env.BOT_USERNAME}</b>\n` +
      `\n` +
      `<b>👤 Semua User</b>\n` +
      `/cancel — Batalkan aksi pending (setemoji dll)\n` +
      `/clearhost — Batalkan semua game yang sedang kamu host\n` +
      `/syncstats — Sinkronisasi stats mingguan\n` +
      `\n` +
      `<b>💎 Donator (Basic/Premium)</b>\n` +
      `/donate — Lihat pilihan upgrade tier\n` +
      `/setemoji [rock|paper|scissors] — Set emoji reveal (kirim emoji setelah command)\n` +
      `/setsticker [rock|paper|scissors] — Set popup stiker (kirim stiker setelah command)\n` +
      `/setthumb [rock|paper|scissors] [url|gif|sticker] — Set thumbnail inline\n` +
      `/delthumb [rock|paper|scissors] — Hapus thumbnail\n` +
      `/myconfig — Lihat konfigurasi aktifmu\n` +
      `/reset — Reset config ke global/default\n` +
      `\n` +
      `<b>🧪 Beta Tester</b>\n` +
      `Sama dengan Donator, akses lebih awal ke fitur baru sebelum rilis\n` +
      `\n` +
      `<b>👑 Owner Only</b>\n` +
      `/setglobal [emoji|sticker|thumb] ... — Set config global\n` +
      `/globalconfig — Lihat config global saat ini\n` +
      `/resetglobal — Reset config global\n` +
      `/betaadd &lt;userId&gt; — Tambah beta tester\n` +
      `/betaremove &lt;userId&gt; — Hapus beta tester\n` +
      `/betalist — Lihat daftar beta tester\n` +
      `/activatetier &lt;userId&gt; [basic|premium] — Aktifkan tier manual (QRIS dll)\n` +
      `/removedonator &lt;userId&gt; — Cabut tier donator\n` +
      `/setprice [basic|premium] [stars|stripe] &lt;amount&gt; — Set harga tier\n` +
      `/prices — Lihat harga tier saat ini\n` +
      `/setupcommands — Register command list ke Telegram per scope\n` +
      `/riverwas — Tampilkan daftar ini`
    );
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
