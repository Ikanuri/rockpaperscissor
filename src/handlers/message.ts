import type { Choice, Env, GameSession, LeaderboardEntry, LmsSession, PendingConfig, TeamDiceWaitState, TeamSession, TelegramMessage, TournamentSession, UserStats } from '../types';
import { editInlineMessage, getChatInfo, sendChatAction, sendDice, sendMessage, sendMessageForId, sendPoll, setMyCommands } from '../telegram';
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
import { EMOJI, escHtml, fmtEmoji, generateId, getLang, resolveTeamDiceWait, tournamentSignupKeyboard, tournamentSignupText } from '../game';

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

export async function handleMessage(msg: TelegramMessage, env: Env, ctx: ExecutionContext): Promise<void> {
  const chatType = msg.chat.type;
  if (chatType === 'group' || chatType === 'supergroup') {
    await handleGroupMessage(msg, env, ctx);
    return;
  }
  if (!msg.from || chatType !== 'private') return;

  const token = env.BOT_TOKEN;
  const kv = env.GAME_SESSIONS;
  const owner = isOwner(msg, env);
  const [betaUser, tier, lang] = await Promise.all([
    isBetaUser(kv, msg.from.id, env.BOT_OWNER_ID),
    loadDonatorTier(kv, msg.from.id),
    getLang(kv, msg.from.id),
  ]);
  const canConfig = owner || betaUser || tier !== 'free';
  const canDonate = owner || betaUser || hasFeature(env, 'donator');

  // Cache user info setiap DM — dipakai untuk tampilan donatorlist dll.
  kv.put(`user:info:${msg.from.id}`, JSON.stringify({
    name: msg.from.first_name,
    username: msg.from.username ?? null,
  }));
  if (msg.from.username) {
    kv.put(`user:by_username:${msg.from.username.toLowerCase()}`, String(msg.from.id));
  }

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
        const isPopupAction = pending.action === 'setsticker' || pending.action === 'setglobal_sticker';
        if (isPopupAction && msg.sticker.is_video) {
          await reply(token, msg.chat.id,
            `⚠️ Stiker video tidak bisa dipakai di popup inline (batasan API Telegram).\n` +
            `Kirim stiker diam (webp) atau animasi, lalu coba lagi.`
          );
          return;
        }
        await kv.delete(`pending:config:${msg.from.id}`);
        const fileId = msg.sticker.file_id;
        if (pending.action === 'setsticker') {
          await setUserConfig(kv, msg.from.id, { sticker: { [pending.choice]: fileId } });
          await reply(token, msg.chat.id, `✅ Popup stiker untuk ${CHOICE_EMOJI[pending.choice]} <b>${pending.choice}</b> tersimpan.\n<i>Di popup inline, stiker muncul tanpa label teks — gunakan stiker yang mudah dikenali.</i>`);
        } else if (pending.action === 'setglobal_sticker') {
          await setGlobalConfig(kv, { sticker: { [pending.choice]: fileId } });
          await reply(token, msg.chat.id, `✅ Global stiker untuk ${CHOICE_EMOJI[pending.choice]} <b>${pending.choice}</b> tersimpan.\n<i>Di popup inline, stiker muncul tanpa label teks — gunakan stiker yang mudah dikenali.</i>`);
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
    await sendMessage(token, msg.chat.id,
      `ℹ️ /syncstats tidak lagi diperlukan.\nStats periode (hari/minggu/bulan) diupdate otomatis setiap game selesai.`
    );
    return;
  }
  if (cmd === '/clearhost') {
    const listKey = `hostgames:${msg.from.id}`;
    const gameIds = await kv.get<string[]>(listKey, 'json') ?? [];
    let cancelled = 0;
    for (const gameId of gameIds) {
      if (gameId.startsWith('L')) {
        const s = await kv.get<LmsSession>(`lms:${gameId}`, 'json');
        if (s && s.hostUserId === msg.from.id && s.status !== 'done') {
          await Promise.all([
            kv.delete(`lms:${gameId}`),
            ...s.players.map(p => editInlineMessage(token, p.inlineMessageId, '❌ LMS game dibatalkan.')),
          ]);
          cancelled++;
        }
      } else if (gameId.startsWith('T')) {
        const s = await kv.get<TeamSession>(`team:${gameId}`, 'json');
        if (s && s.hostUserId === msg.from.id && s.status !== 'playing') {
          await Promise.all([
            kv.delete(`team:${gameId}`),
            ...[...s.teamA, ...s.teamB].map(p => editInlineMessage(token, p.inlineMessageId, '❌ Team game dibatalkan.')),
          ]);
          cancelled++;
        }
      } else {
        const s = await kv.get<GameSession>(`game:${gameId}`, 'json');
        if (s && s.hostUserId === msg.from.id && s.status !== 'done') {
          const ops: Promise<void>[] = [
            kv.delete(`game:${gameId}`),
            editInlineMessage(token, s.hostInlineMessageId, '❌ Game dibatalkan.'),
          ];
          if (s.opponentInlineMessageId) ops.push(editInlineMessage(token, s.opponentInlineMessageId, '❌ Game dibatalkan.'));
          await Promise.all(ops);
          cancelled++;
        }
      }
    }
    await Promise.all([
      kv.delete(listKey),
      kv.put(`ratelimit:${msg.from.id}`, '0', { expirationTtl: 600 }),
    ]);
    await reply(token, msg.chat.id,
      cancelled > 0
        ? `✅ ${cancelled} game${cancelled > 1 ? 's' : ''} dibatalkan.`
        : '✅ Tidak ada game aktif.'
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
    if (!canConfig) { await reply(token, msg.chat.id, welcomeText(env, lang)); return; }
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
    if (!canConfig) { await reply(token, msg.chat.id, welcomeText(env, lang)); return; }
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
    if (!canConfig) { await reply(token, msg.chat.id, welcomeText(env, lang)); return; }
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
    if (!canConfig) { await reply(token, msg.chat.id, welcomeText(env, lang)); return; }
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
    if (!canConfig) { await reply(token, msg.chat.id, welcomeText(env, lang)); return; }
    await resetUserConfig(kv, msg.from.id);
    await reply(token, msg.chat.id, '✅ Config reset to global/default.');
    return;
  }

  if (cmd === '/setlang') {
    const kb = { inline_keyboard: [[
      { text: '🇮🇩 Bahasa Indonesia', callback_data: 'setlang:id' },
      { text: '🇬🇧 English', callback_data: 'setlang:en' },
    ]] };
    await sendMessage(token, msg.chat.id,
      lang === 'en' ? '🌐 Choose your language:' : '🌐 Pilih bahasa kamu:', kb);
    return;
  }

  if (cmd === '/guide') {
    const { text, kb } = guideMainMenu(lang, env.BOT_USERNAME);
    await sendMessage(token, msg.chat.id, text, kb);
    return;
  }

  if (cmd === '/credits') {
    await reply(token, msg.chat.id,
      `🎮 <b>GubakeBot</b> — v2.0.0\n\n` +
      `Bot ini ada karena kalian.\n\n` +
      `🧪 <b>Beta testers</b>\n` +
      `Yang rela main waktu semuanya masih setengah jadi.\n` +
      `Bug report kalian yang bikin ini layak dimainkan.\n\n` +
      `🏆 <b>Para pemain</b>\n` +
      `Yang terus balik main meski kadang bot-nya error duluan.\n\n` +
      `❤️ <b>Kamu yang baca ini</b>\n` +
      `Sampai sini aja sudah cukup.\n\n` +
      `— @ikanuri`
    );
    return;
  }

  // ── Owner-only commands ──────────────────────────────────────────────
  if (!owner) {
    await reply(token, msg.chat.id, welcomeText(env, lang));
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

  if (cmd === '/resetuser' && parts.length >= 2) {
    if (!owner) { await reply(token, msg.chat.id, '❌ Owner only.'); return; }
    const targetId = parseInt(parts[1]);
    if (isNaN(targetId)) { await reply(token, msg.chat.id, '❌ Invalid user ID.'); return; }
    await resetUserConfig(kv, targetId);
    await reply(token, msg.chat.id, `✅ Config user ${targetId} dihapus.`);
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
    const adIdList = await kv.get<number[]>('donators:ids', 'json') ?? [];
    if (!adIdList.includes(targetId)) {
      await kv.put('donators:ids', JSON.stringify([...adIdList, targetId]));
    }
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

    // Teks expiry untuk notif user — UTC selalu, tambah tanggal WIB jika >= 1 hari
    const userExpiryStr = durationMs < 86_400_000
      ? `${expiryUtc.toISOString().slice(0, 16).replace('T', ' ')} UTC`
      : `${expiryUtc.toISOString().slice(0, 10)} (UTC)`;

    // Notifikasi ke tiap user
    const expiryDateOnly = userExpiryStr;
    const userNotifText =
      `🎉 <b>Tier kamu diaktifkan!</b>\n\n` +
      `Tier: <b>${TIER_PERKS[activeTier].label}</b>\n` +
      `Berlaku: <b>${expiryDateOnly}</b>\n\n` +
      `<b>Yang bisa kamu lakukan sekarang:</b>\n` +
      TIER_PERKS[activeTier].features.map(f => `• ${f}`).join('\n') + '\n\n' +
      `Ketik /setemoji, /setsticker, atau /setthumb di sini untuk mulai kustomisasi.`;

    const notifResults = await Promise.all(
      userIds.map(uid =>
        sendMessage(token, uid, userNotifText)
          .then(() => ({ uid, ok: true }))
          .catch(() => ({ uid, ok: false }))
      )
    );

    const userLines = (await Promise.all(
      userIds.map(async uid => {
        const sent = notifResults.find(r => r.uid === uid)?.ok;
        const notifIcon = sent ? '✉️' : '⚠️';
        return `  ${notifIcon} ${await resolveUserDisplay(kv, token, uid)}`;
      })
    )).join('\n');

    const hasUnnotified = notifResults.some(r => !r.ok);
    await reply(token, msg.chat.id,
      `✅ <b>${TIER_PERKS[activeTier].label}</b> activated · ${durationLabel}\n` +
      `⏰ Until: ${expiryStr}\n\n` +
      userLines +
      (hasUnnotified ? '\n\n<i>⚠️ = belum pernah DM bot, tidak bisa dinotifikasi.</i>' : '')
    );
    return;
  }

  if (cmd === '/setupcommands') {
    const userCommands = [
      { command: 'clearhost', description: 'Batalkan game yang sedang kamu host' },
      { command: 'setlang', description: 'Ganti bahasa bot' },
      { command: 'credits', description: 'Tentang bot ini' },
      { command: 'guide', description: 'Panduan mode game' },
    ];
    const userCommandsEn = [
      { command: 'clearhost', description: 'Cancel your hosted games' },
      { command: 'setlang', description: 'Change bot language' },
      { command: 'credits', description: 'About this bot' },
      { command: 'guide', description: 'Game mode guide' },
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
      setMyCommands(token, userCommandsEn, { type: 'default' }, 'en'),
      setMyCommands(token, ownerCommands, { type: 'chat', chat_id: ownerId }),
    ]);
    const idTemplate = userCommands.map(c => `${c.command} - ${c.description}`).join('\n');
    const enTemplate = userCommandsEn.map(c => `${c.command} - ${c.description}`).join('\n');
    await reply(token, msg.chat.id,
      `✅ Commands registered.\n` +
      `👤 Default (all users): ${userCommands.length} commands\n` +
      `👑 Owner (chat ${ownerId}): ${ownerCommands.length} commands\n\n` +
      `<b>BotFather template (🇮🇩):</b>\n<pre>${idTemplate}</pre>\n\n` +
      `<b>BotFather template (🇬🇧):</b>\n<pre>${enTemplate}</pre>`
    );
    return;
  }

  if (cmd === '/setdailychat') {
    const chatIdArg = parts[1];
    if (!chatIdArg) {
      await reply(token, msg.chat.id, '❌ Usage: /setdailychat &lt;chatId&gt;');
      return;
    }
    const chatIdNum = parseInt(chatIdArg);
    if (isNaN(chatIdNum)) {
      await reply(token, msg.chat.id, '❌ Invalid chat ID.');
      return;
    }
    await kv.put('config:daily_challenge_chat', String(chatIdNum));
    await reply(token, msg.chat.id, `✅ Daily challenge chat set to <code>${chatIdNum}</code>.`);
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
      `/credits — Tentang bot ini\n` +
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
    `<b>💎 Donator / Beta User:</b>\n` +
    `/setemoji reveal [rock|paper|scissors] — lalu kirim emoji\n` +
    `/setsticker [rock|paper|scissors] — lalu kirim stiker\n` +
    `/setthumb [rock|paper|scissors] [url|gif|sticker] — lalu kirim media\n` +
    `/delthumb [rock|paper|scissors] · /myconfig · /reset\n` +
    `/donate\n\n` +
    `<b>All Users:</b>\n` +
    `/clearhost`
  );
}

async function handleGroupMessage(msg: TelegramMessage, env: Env, ctx: ExecutionContext): Promise<void> {
  const token = env.BOT_TOKEN;
  const kv = env.GAME_SESSIONS;
  const chatId = msg.chat.id;
  const botName = env.BOT_USERNAME.toLowerCase();

  // Bot added to group — persist settings; send welcome if group_mode enabled
  if (msg.new_chat_members?.some(m => m.username?.toLowerCase() === botName)) {
    await kv.put(`group:settings:${chatId}`, JSON.stringify({ chatId, joinedAt: Date.now() }));
    if (hasFeature(env, 'group_mode')) {
      await sendMessage(token, chatId,
        `👋 Halo semua! Ketik <code>@${env.BOT_USERNAME}</code> di chat untuk main Rock Paper Scissors! 🎮\n\n` +
        `/leaderboard — Papan skor global\n` +
        `/groupstats — Statistik khusus grup ini\n` +
        `/announce — Umumkan game berikutmu di grup ini\n\n` +
        `<i>Ketik /start untuk info lebih lanjut.</i>`
      );
    }
    return;
  }

  // Bot removed from group — clean up settings
  if (msg.left_chat_member?.username?.toLowerCase() === botName) {
    await kv.delete(`group:settings:${chatId}`);
    return;
  }

  // New human members joined
  if (msg.new_chat_members) {
    if (hasFeature(env, 'group_mode')) {
      const humans = msg.new_chat_members.filter(m => !m.is_bot);
      if (humans.length > 0) {
        const mentions = humans.map(m => m.username ? `@${m.username}` : escHtml(m.first_name)).join(', ');
        await sendMessage(token, chatId,
          `👋 Selamat datang ${mentions}! Ketik @${env.BOT_USERNAME} untuk main RPS 🎮`
        );
      }
    }
    return;
  }

  // Team tiebreaker dice — works regardless of group_mode feature
  if (msg.dice && msg.from) {
    const state = await kv.get<TeamDiceWaitState>(`chat:dice_wait:${chatId}`, 'json');
    if (state) {
      const userId = msg.from.id;
      const roll = msg.dice.value;
      let updated = { ...state, rollsA: state.rollsA ?? [], rollsB: state.rollsB ?? [] };
      let changed = false;

      if (state.tieA && !state.resolvedA) {
        const p = state.tieA.find(tp => tp.userId === userId);
        if (p && !updated.rollsA.some(r => r.userId === userId)) {
          updated = { ...updated, rollsA: [...updated.rollsA, { userId, roll }] };
          changed = true;
          if (updated.rollsA.length === state.tieA.length) {
            const maxRoll = Math.max(...updated.rollsA.map(r => r.roll));
            const topRollers = updated.rollsA.filter(r => r.roll === maxRoll);
            const winner = topRollers[Math.floor(Math.random() * topRollers.length)];
            const winnerPlayer = state.tieA.find(tp => tp.userId === winner.userId)!;
            const rollStr = updated.rollsA.map(r => {
              const rp = state.tieA!.find(tp => tp.userId === r.userId)!;
              return `${escHtml(rp.name)} ${EMOJI[rp.choice]} 🎲${r.roll}`;
            }).join(', ');
            updated = { ...updated, resolvedA: {
              choice: winnerPlayer.choice,
              notes: [`${rollStr} → Tim A pilih ${EMOJI[winnerPlayer.choice]}${topRollers.length > 1 ? ' (dadu seri → acak)' : ''}`],
            }};
          }
        }
      }

      if (state.tieB && !state.resolvedB) {
        const p = state.tieB.find(tp => tp.userId === userId);
        if (p && !updated.rollsB.some(r => r.userId === userId)) {
          updated = { ...updated, rollsB: [...updated.rollsB, { userId, roll }] };
          changed = true;
          if (updated.rollsB.length === state.tieB.length) {
            const maxRoll = Math.max(...updated.rollsB.map(r => r.roll));
            const topRollers = updated.rollsB.filter(r => r.roll === maxRoll);
            const winner = topRollers[Math.floor(Math.random() * topRollers.length)];
            const winnerPlayer = state.tieB.find(tp => tp.userId === winner.userId)!;
            const rollStr = updated.rollsB.map(r => {
              const rp = state.tieB!.find(tp => tp.userId === r.userId)!;
              return `${escHtml(rp.name)} ${EMOJI[rp.choice]} 🎲${r.roll}`;
            }).join(', ');
            updated = { ...updated, resolvedB: {
              choice: winnerPlayer.choice,
              notes: [`${rollStr} → Tim B pilih ${EMOJI[winnerPlayer.choice]}${topRollers.length > 1 ? ' (dadu seri → acak)' : ''}`],
            }};
          }
        }
      }

      if (changed) {
        const aOk = !updated.tieA || updated.resolvedA !== null;
        const bOk = !updated.tieB || updated.resolvedB !== null;
        if (aOk && bOk && updated.resolvedA && updated.resolvedB) {
          ctx.waitUntil(resolveTeamDiceWait(token, kv, updated, env, ctx));
        } else {
          await kv.put(`chat:dice_wait:${chatId}`, JSON.stringify(updated), { expirationTtl: 300 });
        }
      }
    }
    return;
  }

  // Commands — only when group_mode is enabled
  if (!hasFeature(env, 'group_mode')) return;
  if (!msg.from || !msg.text) return;

  // Strip @BotName suffix: /leaderboard@gubakebetabot → /leaderboard
  const rawCmd = msg.text.trim().split(/\s+/)[0].toLowerCase();
  const cmd = rawCmd.replace(/@\w+$/, '');

  if (cmd === '/leaderboard') {
    await sendChatAction(token, chatId, 'typing');
    const board = (await kv.get<LeaderboardEntry[]>('leaderboard', 'json')) ?? [];
    if (board.length === 0) {
      await sendMessage(token, chatId, '📊 Leaderboard masih kosong. Mulai game dulu!');
      return;
    }
    const lines = board.slice(0, 20).map((e, i) =>
      `${i + 1}. ${escHtml(e.name)} — ${e.wins}W / ${e.total - e.wins}L`
    );
    await sendMessage(token, chatId,
      `🏆 <b>Top ${board.length} Players</b>\n━━━━━━━━━━━━━━\n${lines.join('\n')}`
    );
    return;
  }

  if (cmd === '/start' || cmd === '/help') {
    const b = env.BOT_USERNAME;
    await sendMessage(token, chatId,
      `🎮 <b>Rock Paper Scissors</b>\n\n` +
      `Ketik <code>@${b}</code> di chat ini untuk mulai game!\n\n` +
      `<b>Mode:</b> Single · BO3 · BO5 · BO7 · RANKED · LMS · Team · vs Bot\n\n` +
      `/guide — Panduan lengkap semua mode\n` +
      `/leaderboard — Papan skor global\n` +
      `/groupstats — Statistik grup ini`
    );
    return;
  }

  if (cmd === '/guide') {
    const langGrp = msg.from ? await getLang(kv, msg.from.id) : 'id';
    const { text, kb } = guideMainMenu(langGrp, env.BOT_USERNAME);
    await sendMessage(token, chatId, text, kb);
    return;
  }

  if (cmd === '/credits') {
    await sendMessage(token, chatId,
      `🎮 <b>GubakeBot</b> — v2.0.0\n\n` +
      `Bot ini ada karena kalian.\n\n` +
      `🧪 <b>Beta testers</b>\n` +
      `Yang rela main waktu semuanya masih setengah jadi.\n` +
      `Bug report kalian yang bikin ini layak dimainkan.\n\n` +
      `🏆 <b>Para pemain</b>\n` +
      `Yang terus balik main meski kadang bot-nya error duluan.\n\n` +
      `❤️ <b>Kamu yang baca ini</b>\n` +
      `Sampai sini aja sudah cukup.\n\n` +
      `— @ikanuri`
    );
    return;
  }

  if (cmd === '/setlang' && msg.from) {
    const langGrp = await getLang(kv, msg.from.id);
    const kb = { inline_keyboard: [[
      { text: '🇮🇩 Bahasa Indonesia', callback_data: 'setlang:id' },
      { text: '🇬🇧 English', callback_data: 'setlang:en' },
    ]] };
    await sendMessage(token, chatId,
      langGrp === 'en' ? '🌐 Choose your language:' : '🌐 Pilih bahasa kamu:', kb);
    return;
  }

  if (cmd === '/announce') {
    await kv.put(`group:announce:${msg.from.id}`, String(chatId), { expirationTtl: 300 });
    await sendMessage(token, chatId,
      `✅ Siap ${escHtml(msg.from.first_name)}! Game inline berikutnya yang kamu buat akan diumumkan di sini.\n` +
      `<i>Berlaku 5 menit atau sampai satu game dibuat.</i>`
    );
    return;
  }

  if (cmd === '/groupstats') {
    await sendChatAction(token, chatId, 'typing');
    const board = (await kv.get<LeaderboardEntry[]>(`group:score:${chatId}`, 'json')) ?? [];
    if (board.length === 0) {
      await sendMessage(token, chatId,
        `📊 Belum ada statistik untuk grup ini.\nGunakan /announce lalu main game inline untuk mulai mencatat!`
      );
      return;
    }
    const lines = board.slice(0, 10).map((e, i) =>
      `${i + 1}. ${escHtml(e.name)} — ${e.wins}W / ${e.total - e.wins}L (${e.total} game)`
    );
    await sendMessage(token, chatId,
      `🏟️ <b>Statistik Grup</b>\n━━━━━━━━━━━━━━\n${lines.join('\n')}`
    );
    return;
  }

  if (cmd === '/poll') {
    await sendPoll(token, chatId,
      '🎮 Mau main apa malam ini?',
      ['1v1 Classic', 'Best of 3', 'Best of 5', 'Last Man Standing'],
      false
    );
    return;
  }

  if (cmd === '/dice') {
    const parts = msg.text.trim().split(/\s+/);
    const validEmojis = ['🎲', '🎯', '🏀', '⚽', '🎳', '🎰'];
    const emoji = validEmojis.includes(parts[1] ?? '') ? parts[1] : '🎲';
    await sendDice(token, chatId, emoji);
    return;
  }

  if (cmd === '/stats') {
    const s = (await kv.get<UserStats>(`stats:${msg.from.id}`, 'json')) ?? { wins: 0, losses: 0, draws: 0, total: 0 };
    const streak = s.currentStreak ?? 0;
    const weekWins = s.weekWins ?? 0;
    const weekLosses = s.weekLosses ?? 0;
    const weekDraws = s.weekDraws ?? 0;
    let statsText = `📊 <b>${escHtml(msg.from.first_name)}</b>: ` +
      `🏆 ${s.wins}W · 😔 ${s.losses}L · 🤝 ${s.draws}D · 📈 ${s.total} total`;
    if (streak >= 2) statsText += `\n🔥 Streak: ${streak}x beruntun`;
    if (weekWins + weekLosses + weekDraws > 0) {
      statsText += `\n📅 Minggu ini: ${weekWins}W · ${weekLosses}L · ${weekDraws}D`;
    }
    await sendMessage(token, chatId, statsText);
    return;
  }

  // /team NvN [BO3] — register group for team mode, then go inline
  if (cmd === '/team') {
    await kv.put(`team_chat:${msg.from.id}`, String(chatId), { expirationTtl: 300 });
    const args = msg.text.trim().split(/\s+/).slice(1).join(' ').toUpperCase() || '2V2';
    await sendMessage(token, chatId,
      `✅ <b>${escHtml(msg.from.first_name)}</b> siap buat team game di grup ini!\n` +
      `Ketik <code>@${env.BOT_USERNAME} TEAM ${args}</code> sekarang (berlaku 5 menit).`
    );
    return;
  }

  // /tournament [4|8] — create tournament signup in group
  if (cmd === '/tournament') {
    const parts = msg.text.trim().split(/\s+/);
    const maxPlayers = parts[1] ? Math.min(8, Math.max(2, parseInt(parts[1]) || 4)) : 4;
    // Ensure even number for bracket pairing
    const slots = maxPlayers % 2 !== 0 ? maxPlayers + 1 : maxPlayers;
    const tournamentId = generateId();
    const tournament: TournamentSession = {
      tournamentId,
      chatId,
      hostUserId: msg.from.id,
      players: [{ userId: msg.from.id, name: msg.from.first_name }],
      maxPlayers: slots,
      status: 'joining',
      currentRound: 0,
      rounds: [],
      winner: null,
      signupMessageId: null,
      createdAt: Date.now(),
    };
    const kb = tournamentSignupKeyboard(tournamentId);
    const msgId = await sendMessageForId(token, chatId, tournamentSignupText(tournament), kb);
    const withMsgId: TournamentSession = { ...tournament, signupMessageId: msgId };
    await kv.put(`tournament:${tournamentId}`, JSON.stringify(withMsgId), { expirationTtl: 3600 });
    return;
  }
}

function welcomeText(env: Env, lang: 'id' | 'en'): string {
  const b = env.BOT_USERNAME;
  if (lang === 'en') {
    return (
      `👋 Type <code>@${b}</code> in any chat to start playing!\n\n` +
      `<b>🎮 Game modes:</b>\n` +
      `<code>@${b}</code> — 1v1 classic\n` +
      `<code>@${b} BO3</code> / <code>BO5</code> / <code>BO7</code> — best of series\n` +
      `<code>@${b} RANKED</code> — affects ELO rating\n` +
      `<code>@${b} LMS</code> — Last Man Standing (3–8 players)\n` +
      `<code>@${b} TEAM 2v2</code> — team vs team\n` +
      `<code>@${b} @username</code> — private challenge\n` +
      `<code>@${b} BOT</code> — play vs AI\n\n` +
      `<b>📊 Stats & info:</b>\n` +
      `<code>@${b} STATS</code> — your full stats & streaks\n` +
      `<code>@${b} LAST</code> — last game recap\n` +
      `<code>@${b} VS @username</code> — head-to-head stats\n` +
      `<code>@${b} TOP</code> — global leaderboard\n\n` +
      `<b>Commands:</b>\n` +
      `/guide — Full walkthrough for each mode\n` +
      `/clearhost — Cancel all your active hosted games\n` +
      `/setlang — Change language`
    );
  }
  return (
    `👋 Ketuk <code>@${b}</code> di chat mana saja untuk mulai main!\n\n` +
    `<b>🎮 Mode game:</b>\n` +
    `<code>@${b}</code> — 1v1 biasa\n` +
    `<code>@${b} BO3</code> / <code>BO5</code> / <code>BO7</code> — best of series\n` +
    `<code>@${b} RANKED</code> — pengaruhi ELO rating\n` +
    `<code>@${b} LMS</code> — Last Man Standing (3–8 pemain)\n` +
    `<code>@${b} TEAM 2v2</code> — tim vs tim\n` +
    `<code>@${b} @username</code> — private challenge\n` +
    `<code>@${b} BOT</code> — lawan AI\n\n` +
    `<b>📊 Statistik & info:</b>\n` +
    `<code>@${b} STATS</code> — stats lengkap & streak kamu\n` +
    `<code>@${b} LAST</code> — rekap game terakhir\n` +
    `<code>@${b} VS @username</code> — head-to-head vs seseorang\n` +
    `<code>@${b} TOP</code> — leaderboard global\n\n` +
    `<b>Commands:</b>\n` +
    `/guide — Panduan lengkap semua mode game\n` +
    `/clearhost — Batalkan semua game yang sedang kamu host\n` +
    `/setlang — Ganti bahasa`
  );
}

export function guideMainMenu(lang: 'id' | 'en', _botUsername: string): { text: string; kb: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } } {
  const text = lang === 'en'
    ? `🎮 <b>Game Mode Guide</b>\n\nChoose a mode to see its walkthrough:`
    : `🎮 <b>Panduan Mode Game</b>\n\nPilih mode untuk melihat cara mainnya:`;
  const kb = {
    inline_keyboard: [
      [
        { text: '✊ 1v1', callback_data: 'guide:1v1' },
        { text: '🏆 BO3/5/7', callback_data: 'guide:bo' },
        { text: '🏅 Ranked', callback_data: 'guide:ranked' },
      ],
      [
        { text: '⚔️ Last Man Standing', callback_data: 'guide:lms' },
        { text: '🤝 Team Mode', callback_data: 'guide:team' },
      ],
      [
        { text: '🤖 vs Bot', callback_data: 'guide:bot' },
        { text: '🌐 Open Challenge', callback_data: 'guide:open' },
      ],
    ],
  };
  return { text, kb };
}

export function guideContent(mode: string, lang: 'id' | 'en', bot: string): string {
  const b = bot;
  if (lang === 'en') {
    switch (mode) {
      case '1v1': return `✊ <b>1v1 — Classic Duel</b>\n\nTwo players, one round. Winner takes the game.\n\n<b>How to play:</b>\n1. Type <code>@${b}</code> in any chat\n2. Pick your weapon (✊ ✋ ✌️ or 🎲 random)\n3. Game message sent with a Join button\n4. Opponent taps Join → picks weapon → results shown\n\n<b>Examples:</b>\n<pre>@${b}           → open 1v1\n@${b} @budi     → private challenge\n@${b} ABCD12   → join by game code</pre>\n\n💡 Tap <b>Rematch</b> after the game to play again instantly.`;
      case 'bo': return `🏆 <b>BO3 / BO5 / BO7 — Best of Series</b>\n\nFirst to reach the win target wins overall.\n\n<b>Win targets:</b>\n<pre>BO3 → first to 2 wins\nBO5 → first to 3 wins\nBO7 → first to 4 wins</pre>\n\n<b>How to play:</b>\n1. Type <code>@${b} BO3</code> (or BO5/BO7)\n2. Pick weapon → wait for opponent to join\n3. Each round, both pick a new weapon\n4. Game ends when one player hits the target\n\n<b>Examples:</b>\n<pre>@${b} BO3\n@${b} BO5 @budi     → private BO5\n@${b} RANKED BO3    → ranked BO3</pre>`;
      case 'ranked': return `🏅 <b>Ranked — Competitive Mode</b>\n\nGame results affect your <b>ELO rating</b>. Starting rating: <b>1000</b>.\n\n<b>How ELO works:</b>\n• Beat a higher-rated player → gain more ELO\n• Lose to a lower-rated player → lose more ELO\n• Draw → slight change\n\n<b>How to play:</b>\n1. Type <code>@${b} RANKED</code>\n2. Play like a normal game\n\n<b>Examples:</b>\n<pre>@${b} RANKED\n@${b} RANKED BO3\n@${b} RANKED @budi</pre>\n\n💡 Casual games don't affect ELO at all.`;
      case 'lms': return `⚔️ <b>Last Man Standing — Multiplayer</b>\n\n3–8 players. Losers eliminated each round. Last one standing wins.\n\n<b>Round logic:</b>\n<pre>2 weapon types → losers eliminated\n1 or 3 types   → Chaos! Everyone plays again</pre>\n\n<b>How to play:</b>\n1. Type <code>@${b} LMS</code> (default 4) or <code>@${b} LMS 6</code>\n2. Pick weapon → game message posted with Join button\n3. Others tap Join → pick weapon → their message sent\n4. Starts automatically when all slots filled\n5. After each round → tap ▶️ for the next round\n\n<b>Examples:</b>\n<pre>@${b} LMS      → 4-player LMS\n@${b} LMS 6    → 6-player LMS\n@${b} LMS 8    → 8-player LMS</pre>\n\n💡 Host can Force Start with ≥2 players without waiting for full slots.`;
      case 'team': return `🤝 <b>Team Mode — Team vs Team</b>\n\nTwo teams face off. Official pick = majority vote of team members.\n\n<b>Prerequisite:</b> Bot must be added as a group member.\n\n<b>How to play:</b>\n1. In the group, type <code>/team 2v2</code> (supports 1v1/2v2/3v3/4v4)\n   Bot saves this group for 5 minutes\n2. Type <code>@${b} TEAM 2v2</code> → pick weapon\n3. Others join via buttons in the message:\n   • 🤝 Team A → your team (host's side)\n   • ⚔️ Team B → opposing team\n\n<b>If there's a tie within a team (50/50):</b>\n<pre>Bot sends 🎲 dice in the group\nHighest roll → that player's pick is used</pre>\n\n<b>Examples:</b>\n<pre>/team 2v2\n@${b} TEAM 2v2\n@${b} TEAM 2v2 BO3</pre>\n\n💡 If both teams pick the same weapon → Chaos round, everyone picks again.`;
      case 'bot': return `🤖 <b>vs Bot — Play vs AI</b>\n\nInstant game, no waiting. The bot picks randomly.\n\n<b>How to play:</b>\n1. Type <code>@${b} BOT</code>\n2. Pick your weapon\n3. Result appears immediately with a Play Again button\n\n<b>Examples:</b>\n<pre>@${b} BOT\n@${b} BOT BO3</pre>\n\n💡 vs Bot games count toward stats (W/L/D) but don't affect ELO.`;
      case 'open': return `🌐 <b>Open Challenge — Open to Anyone</b>\n\nCreate a game anyone can join. Great for busy groups.\n\n<b>Creating a challenge:</b>\n1. Type <code>@${b} OPEN</code>\n2. Pick weapon → message posted\n3. Anyone who opens OPEN within 9 minutes can join\n\n<b>Joining someone else's challenge:</b>\n1. Type <code>@${b} OPEN</code>\n2. Available challenges appear in the popup\n3. Tap "Join [name]" → pick weapon → game starts\n\n<b>Examples:</b>\n<pre>@${b} OPEN\n@${b} OPEN BO3</pre>\n\n💡 Up to 5 open challenges available at once. Each expires after 9 minutes.`;
      default: return '❓ Unknown mode.';
    }
  }
  switch (mode) {
    case '1v1': return `✊ <b>1v1 — Duel Klasik</b>\n\nDua pemain, satu ronde. Siapa yang menang, menang game.\n\n<b>Cara main:</b>\n1. Ketik <code>@${b}</code> di kolom pesan\n2. Pilih senjata dari popup (✊ ✋ ✌️ atau 🎲 acak)\n3. Pesan game terkirim dengan tombol Join\n4. Lawan tekan Join → pilih senjata → hasil keluar\n\n<b>Contoh:</b>\n<pre>@${b}           → 1v1 terbuka\n@${b} @budi     → private, hanya Budi bisa join\n@${b} ABCD12   → join game dengan kode tertentu</pre>\n\n💡 Tekan <b>Rematch</b> setelah game untuk main lagi instan tanpa kode baru.`;
    case 'bo': return `🏆 <b>BO3 / BO5 / BO7 — Best of Series</b>\n\nSiapa yang pertama capai target kemenangan, menang keseluruhan.\n\n<b>Target kemenangan:</b>\n<pre>BO3 → menang 2 ronde\nBO5 → menang 3 ronde\nBO7 → menang 4 ronde</pre>\n\n<b>Cara main:</b>\n1. Ketik <code>@${b} BO3</code> (atau BO5/BO7)\n2. Pilih senjata → tunggu lawan join\n3. Setiap ronde, keduanya pilih senjata baru\n4. Game selesai saat salah satu capai target\n\n<b>Contoh:</b>\n<pre>@${b} BO3\n@${b} BO5 @budi     → private BO5\n@${b} RANKED BO3    → BO3 + pengaruhi ELO</pre>`;
    case 'ranked': return `🏅 <b>Ranked — Mode Kompetitif</b>\n\nHasil game berpengaruh pada <b>ELO rating</b> kamu. Rating awal: <b>1000</b>.\n\n<b>Cara kerja ELO:</b>\n• Menang vs rating tinggi → ELO naik banyak\n• Kalah vs rating rendah → ELO turun banyak\n• Draw → perubahan kecil\n\n<b>Cara main:</b>\n1. Ketik <code>@${b} RANKED</code>\n2. Lanjut seperti game biasa\n\n<b>Contoh:</b>\n<pre>@${b} RANKED\n@${b} RANKED BO3\n@${b} RANKED @budi</pre>\n\n💡 Game biasa (non-ranked) tidak mengubah ELO sama sekali.`;
    case 'lms': return `⚔️ <b>Last Man Standing — Multiplayer</b>\n\n3–8 pemain dalam satu sesi. Yang kalah dieliminasi tiap ronde. Terakhir tersisa = pemenang.\n\n<b>Logika eliminasi:</b>\n<pre>2 jenis senjata muncul → yang kalah eliminasi\n1 atau 3 jenis muncul  → Chaos! Semua main ulang</pre>\n\n<b>Cara main:</b>\n1. Ketik <code>@${b} LMS</code> (default 4) atau <code>@${b} LMS 6</code>\n2. Pilih senjata → pesan terkirim dengan tombol Join\n3. Pemain lain tekan Join → pilih senjata → pesan mereka terkirim\n4. Mulai otomatis saat semua slot penuh\n5. Setelah tiap ronde → tekan ▶️ untuk ronde berikutnya\n\n<b>Contoh:</b>\n<pre>@${b} LMS      → LMS 4 pemain\n@${b} LMS 6    → LMS 6 pemain\n@${b} LMS 8    → LMS 8 pemain</pre>\n\n💡 Host bisa Force Start dengan ≥2 pemain tanpa menunggu slot penuh.`;
    case 'team': return `🤝 <b>Team Mode — Tim vs Tim</b>\n\nDua tim berhadapan. Pilihan resmi tim = suara mayoritas anggota.\n\n<b>Prasyarat:</b> Bot harus di-add sebagai member di grup.\n\n<b>Cara main:</b>\n1. Di grup, ketik <code>/team 2v2</code> (1v1/2v2/3v3/4v4)\n   Bot menyimpan grup ini selama 5 menit\n2. Ketik <code>@${b} TEAM 2v2</code> → pilih senjata\n3. Anggota bergabung via tombol di pesan:\n   • 🤝 Tim A → tim kamu (tim host)\n   • ⚔️ Tim B → tim lawan\n\n<b>Jika seri dalam tim (50/50):</b>\n<pre>Bot kirim 🎲 dadu di grup\nAngka tertinggi → pilihan tim tersebut</pre>\n\n<b>Contoh:</b>\n<pre>/team 2v2\n@${b} TEAM 2v2\n@${b} TEAM 2v2 BO3</pre>\n\n💡 Jika kedua tim pilih senjata sama → Chaos round, semua pilih ulang.`;
    case 'bot': return `🤖 <b>vs Bot — Lawan AI</b>\n\nMain instan tanpa menunggu lawan. Bot memilih senjata secara acak.\n\n<b>Cara main:</b>\n1. Ketik <code>@${b} BOT</code>\n2. Pilih senjatamu\n3. Hasil langsung keluar dengan tombol Main lagi\n\n<b>Contoh:</b>\n<pre>@${b} BOT\n@${b} BOT BO3</pre>\n\n💡 Game vs Bot mencatat stats (W/L/D) tapi tidak mempengaruhi ELO.`;
    case 'open': return `🌐 <b>Open Challenge — Tantangan Terbuka</b>\n\nBuat game yang bisa di-join siapa saja. Cocok untuk grup ramai.\n\n<b>Membuat tantangan:</b>\n1. Ketik <code>@${b} OPEN</code>\n2. Pilih senjata → pesan terkirim\n3. Siapa saja yang buka OPEN dalam 9 menit bisa join\n\n<b>Cara join tantangan orang lain:</b>\n1. Ketik <code>@${b} OPEN</code>\n2. Daftar challenge tersedia muncul di popup\n3. Pilih "Join [nama]" → pilih senjata → game dimulai\n\n<b>Contoh:</b>\n<pre>@${b} OPEN\n@${b} OPEN BO3</pre>\n\n💡 Maksimal 5 open challenge tersedia. Challenge expire setelah 9 menit.`;
    default: return '❓ Mode tidak diketahui.';
  }
}
