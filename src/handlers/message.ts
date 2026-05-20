import type { Choice, DonatorTier, Env, TelegramMessage } from '../types';
import { sendMessage } from '../telegram';
import { isBetaUser } from '../feature';
import { loadConfig, setGlobalConfig, setUserConfig, getGlobalConfigRaw, getUserConfigRaw } from '../config';
import { activateTier, loadDonatorTier } from '../donator';
import { handleDonate } from './payment';

const CHOICES: Choice[] = ['rock', 'paper', 'scissors'];

function isChoice(s: string): s is Choice {
  return CHOICES.includes(s as Choice);
}

const USER_HELP =
  '<b>JankensBot Commands</b>\n\n' +
  '<b>Game:</b>\n' +
  '  Type <code>@JankensBot</code> in any chat to start\n' +
  '  Type <code>@JankensBot BO3</code> for Best of 3\n' +
  '  Type <code>@JankensBot STATS</code> to share stats\n\n' +
  '<b>Config (beta):</b>\n' +
  '  /setemoji countdown [1|2|3] &lt;emoji_or_id&gt;\n' +
  '  /setemoji reveal [rock|paper|scissors] &lt;emoji_or_id&gt;\n' +
  '  /setsticker [rock|paper|scissors] &lt;file_id&gt;\n' +
  '  /setthumb [rock|paper|scissors] [url|gif|sticker] &lt;value&gt;\n' +
  '  /delthumb [rock|paper|scissors]\n' +
  '  /myconfig — view your active config\n' +
  '  /reset — reset your config to defaults\n\n' +
  '/donate — support the bot';

const OWNER_HELP =
  '\n<b>Owner commands:</b>\n' +
  '  /setglobal emoji countdown [1|2|3] &lt;val&gt;\n' +
  '  /setglobal emoji reveal [rock|paper|scissors] &lt;val&gt;\n' +
  '  /setglobal sticker [rock|paper|scissors] &lt;file_id&gt;\n' +
  '  /setglobal thumb [rock|paper|scissors] [url|gif|sticker] &lt;val&gt;\n' +
  '  /globalconfig — view global config\n' +
  '  /resetglobal — reset global config\n' +
  '  /betaadd &lt;userId&gt;\n' +
  '  /betaremove &lt;userId&gt;\n' +
  '  /betalist\n' +
  '  /setprice [basic|premium] [stars|stripe] &lt;amount&gt;\n' +
  '  /prices\n' +
  '  /adddonator &lt;userId&gt; [basic|premium]\n' +
  '  /removedonator &lt;userId&gt;';

export async function handleMessage(msg: TelegramMessage, env: Env): Promise<void> {
  if (!msg.from || !msg.text || msg.chat.type !== 'private') return;

  const userId = msg.from.id;
  const token = env.BOT_TOKEN;
  const kv = env.GAME_SESSIONS;
  const isOwner = String(userId) === env.BOT_OWNER_ID;

  const parts = msg.text.trim().split(/\s+/);
  const cmd = parts[0].toLowerCase();

  // ── Public commands ─────────────────────────────────────────────────────────
  if (cmd === '/start' || cmd === '/help') {
    await sendMessage(token, msg.chat.id, USER_HELP + (isOwner ? OWNER_HELP : ''));
    return;
  }

  if (cmd === '/donate') {
    const beta = await isBetaUser(kv, userId, env.BOT_OWNER_ID ?? '');
    if (!beta) {
      await sendMessage(token, msg.chat.id, '⚡ Donate feature coming soon! Stay tuned.');
      return;
    }
    await handleDonate(msg, env);
    return;
  }

  // ── Beta config commands (available to approved beta testers) ───────────────
  const CONFIG_CMDS = ['/setemoji', '/setsticker', '/setthumb', '/delthumb', '/myconfig', '/reset'];
  if (CONFIG_CMDS.includes(cmd)) {
    const beta = await isBetaUser(kv, userId, env.BOT_OWNER_ID ?? '');
    if (!beta) {
      await sendMessage(token, msg.chat.id, '⚡ Config commands are in beta. Stay tuned!');
      return;
    }
    await handleUserConfigCommand(cmd, parts, userId, msg.chat.id, env);
    return;
  }

  // ── Owner-only commands ──────────────────────────────────────────────────────
  if (!isOwner) {
    await sendMessage(token, msg.chat.id, `👋 Use <code>@${env.BOT_USERNAME}</code> inline to play Rock Paper Scissors!\n\n/help — see all commands`);
    return;
  }

  if (cmd === '/setglobal') {
    await handleSetGlobal(parts, msg.chat.id, env);
  } else if (cmd === '/globalconfig') {
    const raw = await getGlobalConfigRaw(kv);
    await sendMessage(token, msg.chat.id, `<b>Global config:</b>\n<code>${JSON.stringify(raw, null, 2)}</code>`);
  } else if (cmd === '/resetglobal') {
    await kv.delete('config:global');
    await sendMessage(token, msg.chat.id, '✅ Global config reset to defaults.');
  } else if (cmd === '/betaadd' && parts.length >= 2) {
    await handleBetaAdd(parts[1], msg.chat.id, env);
  } else if (cmd === '/betaremove' && parts.length >= 2) {
    await handleBetaRemove(parts[1], msg.chat.id, env);
  } else if (cmd === '/betalist') {
    const list = await kv.get<number[]>('beta:approved', 'json') ?? [];
    await sendMessage(token, msg.chat.id, list.length > 0
      ? `<b>Beta testers (${list.length}):</b>\n${list.map(id => `• <code>${id}</code>`).join('\n')}`
      : '📭 No approved beta testers yet.'
    );
  } else if (cmd === '/setprice' && parts.length >= 4) {
    await handleSetPrice(parts, msg.chat.id, env);
  } else if (cmd === '/prices') {
    const [bs, bstr, ps, pstr] = await Promise.all([
      kv.get('config:price:basic:stars'),
      kv.get('config:price:basic:stripe'),
      kv.get('config:price:premium:stars'),
      kv.get('config:price:premium:stripe'),
    ]);
    await sendMessage(token, msg.chat.id,
      `<b>Current prices:</b>\n` +
      `🥉 Basic — ${bs ?? '50'} ⭐ / ${bstr ?? '500'}¢ USD\n` +
      `🥇 Premium — ${ps ?? '200'} ⭐ / ${pstr ?? '2000'}¢ USD`
    );
  } else if (cmd === '/adddonator' && parts.length >= 2) {
    const targetId = parseInt(parts[1]);
    const tier = (parts[2] ?? 'basic') as Exclude<DonatorTier, 'free'>;
    if (!targetId || !['basic', 'premium'].includes(tier)) {
      await sendMessage(token, msg.chat.id, '❌ Usage: /adddonator <userId> [basic|premium]');
      return;
    }
    await activateTier(kv, targetId, tier, 'manual');
    await sendMessage(token, msg.chat.id, `✅ Activated <b>${tier}</b> tier for user <code>${targetId}</code>.`);
  } else if (cmd === '/removedonator' && parts.length >= 2) {
    await kv.delete(`donator:${parts[1]}`);
    await sendMessage(token, msg.chat.id, `✅ Donator tier removed for user <code>${parts[1]}</code>.`);
  } else {
    await sendMessage(token, msg.chat.id, USER_HELP + OWNER_HELP);
  }
}

// ── User config command handler ─────────────────────────────────────────────

async function handleUserConfigCommand(
  cmd: string,
  parts: string[],
  userId: number,
  chatId: number,
  env: Env
): Promise<void> {
  const token = env.BOT_TOKEN;
  const kv = env.GAME_SESSIONS;

  if (cmd === '/setemoji') {
    // /setemoji countdown [1|2|3] <val>
    // /setemoji reveal [rock|paper|scissors] <val>
    if (parts.length < 4) {
      await sendMessage(token, chatId, '❌ Usage: /setemoji [countdown|reveal] [key] [emoji_or_id]');
      return;
    }
    const state = parts[1].toLowerCase();
    const key = parts[2].toLowerCase();
    const val = parts[3];

    if (state === 'countdown' && ['1', '2', '3'].includes(key)) {
      await setUserConfig(kv, userId, { countdown: { [key]: val } });
      await sendMessage(token, chatId, `✅ Countdown <b>${key}</b> set to <code>${val}</code>`);
    } else if (state === 'reveal' && isChoice(key)) {
      await setUserConfig(kv, userId, { reveal: { [key]: val } });
      await sendMessage(token, chatId, `✅ Reveal emoji for <b>${key}</b> set to <code>${val}</code>`);
    } else {
      await sendMessage(token, chatId, '❌ Invalid. Try: /setemoji countdown 1 1️⃣  or  /setemoji reveal rock ✊');
    }

  } else if (cmd === '/setsticker') {
    // /setsticker [rock|paper|scissors] <file_id>
    if (parts.length < 3) {
      await sendMessage(token, chatId, '❌ Usage: /setsticker [rock|paper|scissors] <file_id>');
      return;
    }
    const choice = parts[1].toLowerCase();
    const fileId = parts[2];
    if (!isChoice(choice)) {
      await sendMessage(token, chatId, '❌ Invalid choice. Use: rock, paper, scissors');
      return;
    }
    await setUserConfig(kv, userId, { sticker: { [choice]: fileId } });
    await sendMessage(token, chatId, `✅ Popup sticker for <b>${choice}</b> set.`);

  } else if (cmd === '/setthumb') {
    // /setthumb [rock|paper|scissors] [url|gif|sticker] <value>
    if (parts.length < 4) {
      await sendMessage(token, chatId, '❌ Usage: /setthumb [rock|paper|scissors] [url|gif|sticker] <value>');
      return;
    }
    const choice = parts[1].toLowerCase();
    const type = parts[2].toLowerCase() as 'url' | 'gif' | 'sticker';
    const value = parts[3];
    if (!isChoice(choice) || !['url', 'gif', 'sticker'].includes(type)) {
      await sendMessage(token, chatId, '❌ Invalid. Example: /setthumb rock gif <file_id>');
      return;
    }
    await setUserConfig(kv, userId, { thumb: { [choice]: { type, value } } });
    await sendMessage(token, chatId, `✅ Thumbnail for <b>${choice}</b> set to ${type}: <code>${value}</code>`);

  } else if (cmd === '/delthumb') {
    if (parts.length < 2 || !isChoice(parts[1].toLowerCase())) {
      await sendMessage(token, chatId, '❌ Usage: /delthumb [rock|paper|scissors]');
      return;
    }
    await setUserConfig(kv, userId, { thumb: { [parts[1].toLowerCase()]: null } });
    await sendMessage(token, chatId, `✅ Thumbnail for <b>${parts[1]}</b> removed.`);

  } else if (cmd === '/myconfig') {
    const [raw, tier] = await Promise.all([
      getUserConfigRaw(kv, userId),
      loadDonatorTier(kv, userId),
    ]);
    const config = await loadConfig(kv, userId, env as Env);
    await sendMessage(token, chatId,
      `<b>Your config</b> (tier: <b>${tier}</b>)\n\n` +
      `<b>Countdown:</b> ${Object.entries(config.countdown).map(([k, v]) => `${k}→${v}`).join(', ')}\n` +
      `<b>Reveal:</b> ${CHOICES.map(c => `${c}→${config.reveal[c]}`).join(', ')}\n` +
      `<b>Sticker:</b> ${CHOICES.map(c => `${c}→${config.sticker[c] ?? 'none'}`).join(', ')}\n` +
      `<b>Thumb:</b> ${CHOICES.map(c => config.thumb[c] ? `${c}→${config.thumb[c]!.type}` : `${c}→none`).join(', ')}\n\n` +
      `<b>Overrides stored:</b>\n<code>${JSON.stringify(raw, null, 2)}</code>`
    );

  } else if (cmd === '/reset') {
    await kv.delete(`config:user:${userId}`);
    await sendMessage(token, chatId, '✅ Your config has been reset to defaults.');
  }
}

// ── Owner: /setglobal ─────────────────────────────────────────────────────────

async function handleSetGlobal(parts: string[], chatId: number, env: Env): Promise<void> {
  const token = env.BOT_TOKEN;
  const kv = env.GAME_SESSIONS;

  // /setglobal emoji countdown [1|2|3] <val>
  // /setglobal emoji reveal [rock|paper|scissors] <val>
  // /setglobal sticker [rock|paper|scissors] <file_id>
  // /setglobal thumb [rock|paper|scissors] [url|gif|sticker] <val>
  if (parts.length < 2) {
    await sendMessage(token, chatId, '❌ Usage: /setglobal [emoji|sticker|thumb] ...');
    return;
  }

  const sub = parts[1].toLowerCase();

  if (sub === 'emoji' && parts.length >= 5) {
    const state = parts[2].toLowerCase();
    const key = parts[3].toLowerCase();
    const val = parts[4];
    if (state === 'countdown' && ['1', '2', '3'].includes(key)) {
      await setGlobalConfig(kv, { countdown: { [key]: val } });
      await sendMessage(token, chatId, `✅ Global countdown <b>${key}</b> set to <code>${val}</code>`);
    } else if (state === 'reveal' && isChoice(key)) {
      await setGlobalConfig(kv, { reveal: { [key]: val } });
      await sendMessage(token, chatId, `✅ Global reveal <b>${key}</b> set to <code>${val}</code>`);
    } else {
      await sendMessage(token, chatId, '❌ Invalid emoji subcommand.');
    }
  } else if (sub === 'sticker' && parts.length >= 4) {
    const choice = parts[2].toLowerCase();
    const fileId = parts[3];
    if (!isChoice(choice)) { await sendMessage(token, chatId, '❌ Invalid choice.'); return; }
    await setGlobalConfig(kv, { sticker: { [choice]: fileId } });
    await sendMessage(token, chatId, `✅ Global sticker for <b>${choice}</b> set.`);
  } else if (sub === 'thumb' && parts.length >= 5) {
    const choice = parts[2].toLowerCase();
    const type = parts[3].toLowerCase() as 'url' | 'gif' | 'sticker';
    const value = parts[4];
    if (!isChoice(choice) || !['url', 'gif', 'sticker'].includes(type)) {
      await sendMessage(token, chatId, '❌ Invalid. Example: /setglobal thumb rock gif <file_id>');
      return;
    }
    await setGlobalConfig(kv, { thumb: { [choice]: { type, value } } });
    await sendMessage(token, chatId, `✅ Global thumbnail for <b>${choice}</b> set to ${type}.`);
  } else {
    await sendMessage(token, chatId, '❌ Usage: /setglobal [emoji|sticker|thumb] ...');
  }
}

// ── Owner: beta management ────────────────────────────────────────────────────

async function handleBetaAdd(userIdStr: string, chatId: number, env: Env): Promise<void> {
  const token = env.BOT_TOKEN;
  const kv = env.GAME_SESSIONS;
  const targetId = parseInt(userIdStr);

  if (!targetId) {
    await sendMessage(token, chatId, '❌ Invalid user ID.');
    return;
  }

  const list = await kv.get<number[]>('beta:approved', 'json') ?? [];
  if (!list.includes(targetId)) list.push(targetId);
  await kv.put('beta:approved', JSON.stringify(list));
  await sendMessage(token, chatId, `✅ User <code>${targetId}</code> added to beta.`);
}

async function handleBetaRemove(userIdStr: string, chatId: number, env: Env): Promise<void> {
  const token = env.BOT_TOKEN;
  const kv = env.GAME_SESSIONS;
  const targetId = parseInt(userIdStr);

  if (!targetId) {
    await sendMessage(token, chatId, '❌ Invalid user ID.');
    return;
  }

  const list = await kv.get<number[]>('beta:approved', 'json') ?? [];
  const updated = list.filter(id => id !== targetId);
  await kv.put('beta:approved', JSON.stringify(updated));
  await sendMessage(token, chatId, `✅ User <code>${targetId}</code> removed from beta.`);
}

// ── Owner: price management ───────────────────────────────────────────────────

async function handleSetPrice(parts: string[], chatId: number, env: Env): Promise<void> {
  const token = env.BOT_TOKEN;
  const kv = env.GAME_SESSIONS;

  // /setprice [basic|premium] [stars|stripe] <amount>
  const tier = parts[1].toLowerCase();
  const method = parts[2].toLowerCase();
  const amount = parseInt(parts[3]);

  if (!['basic', 'premium'].includes(tier) || !['stars', 'stripe'].includes(method) || isNaN(amount)) {
    await sendMessage(token, chatId, '❌ Usage: /setprice [basic|premium] [stars|stripe] <amount>');
    return;
  }

  await kv.put(`config:price:${tier}:${method}`, String(amount));
  const display = method === 'stripe' ? `${amount}¢ ($${(amount / 100).toFixed(2)})` : `${amount} ⭐`;
  await sendMessage(token, chatId, `✅ Price for <b>${tier}</b> via <b>${method}</b> set to <b>${display}</b>.`);
}
