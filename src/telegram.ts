import type { InlineKeyboardMarkup, InlineResult } from './types';

import { dbg, debugOn } from './debug'; // DEBUG SEMENTARA

const API = 'https://api.telegram.org/bot';

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// Temporary diagnostics (feature flag `debug_errors`, enabled on beta only): every Bot API
// failure and webhook exception is also DM'd to the owner as plain text, so the real error is
// visible in chat without `wrangler tail`. Deduped per message for 30s and capped per isolate so
// a retry loop can't flood the owner. Off (debugOwnerId === null) unless enableErrorDebug() ran.
let debugOwnerId: number | null = null;
let debugSent = 0;
const debugSeen = new Map<string, number>();

export function enableErrorDebug(ownerId: string): void {
  const n = parseInt(ownerId);
  debugOwnerId = isNaN(n) ? null : n;
}

export async function reportError(token: string, where: string, detail: string): Promise<void> {
  if (debugOwnerId === null || debugSent >= 40 || detail.includes('message is not modified')) return;
  const key = `${where}|${detail.slice(0, 80)}`;
  const now = Date.now();
  if (now - (debugSeen.get(key) ?? 0) < 30_000) return;
  debugSeen.set(key, now);
  debugSent++;
  try {
    await fetch(`${API}${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: debugOwnerId, text: `🐞 ${where}\n${detail.slice(0, 900)}` }),
    });
  } catch { /* diagnostics must never break the request */ }
}

async function call(
  token: string,
  method: string,
  body: Record<string, unknown>,
  maxRetryWait = 10_000
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${API}${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (debugOn()) { // DEBUG SEMENTARA: rekam setiap panggilan keluar + respons Telegram
      const b = body as Record<string, unknown>;
      await dbg('tg', {
        kind: 'classic', method, status: res.status,
        target: b.inline_message_id ? `inline…${String(b.inline_message_id).slice(-6)}` : `chat ${b.chat_id}`,
        parse_mode: b.parse_mode, has_markup: !!b.reply_markup,
        text: typeof b.text === 'string' ? b.text.slice(0, 500) : undefined,
        response: (await res.clone().text()).slice(0, 600),
      });
    }
    if (res.status === 429) {
      const data = await res.json<{ parameters?: { retry_after?: number } }>();
      const wait = Math.min((data.parameters?.retry_after ?? 5) * 1000, maxRetryWait);
      if (wait <= 0) return;
      await sleep(wait);
      continue;
    }
    if (!res.ok) {
      const errText = await res.text();
      console.error(`[tg:${method}]`, errText);
      await reportError(token, `tg:${method}`, errText);
    }
    return;
  }
}

export function answerInlineQuery(
  token: string,
  queryId: string,
  results: InlineResult[]
): Promise<void> {
  return call(token, 'answerInlineQuery', {
    inline_query_id: queryId,
    results,
    cache_time: 0,
  });
}

export function answerCallbackQuery(
  token: string,
  callbackId: string,
  text?: string,
  showAlert = false
): Promise<void> {
  return call(token, 'answerCallbackQuery', {
    callback_query_id: callbackId,
    ...(text && { text }),
    show_alert: showAlert,
  });
}

export function editInlineMessage(
  token: string,
  inlineMessageId: string,
  text: string,
  replyMarkup?: InlineKeyboardMarkup,
  maxRetryWait?: number
): Promise<void> {
  return call(token, 'editMessageText', {
    inline_message_id: inlineMessageId,
    text,
    parse_mode: 'HTML',
    ...(replyMarkup && { reply_markup: replyMarkup }),
  }, maxRetryWait);
}

// Rich messages accept exactly one of blocks/html/markdown (InputRichMessage). Earlier versions
// of this file hand-built a `blocks` tree from our HTML strings with a bespoke parser — that
// parser was the source of a real bug (unknown tags rendering literally, e.g. `<tg-emoji ...>`
// showing raw) and duplicated logic Telegram's own API already provides: the `html` field accepts
// the exact same classic-HTML-mode tag set our strings are already written in (confirmed against
// Bot API 10.1-10.3's "Rich HTML style" docs), including <hr/> natively. So we just pass our HTML
// straight through, and render buttons as inline <tg-button-row>/<tg-button> tags appended to it
// instead of a separate structured buttons block.
function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escButtonText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// InlineKeyboardButton fields map 1:1 onto <tg-button> attributes (confirmed against the Bot API
// spec's RichMessageButton) — callback_data still fires a normal callback_query, so
// handleCallbackQuery needs no changes.
function keyboardToButtonHtml(kb: InlineKeyboardMarkup): string {
  return kb.inline_keyboard.map(row => {
    const buttons = row.map(btn => {
      const attrs = [btn.style && `style="${escAttr(btn.style)}"`];
      if (btn.callback_data) attrs.push(`type="callback_data" data="${escAttr(btn.callback_data)}"`);
      else if (btn.url) attrs.push(`type="url" url="${escAttr(btn.url)}"`);
      else if (btn.switch_inline_query_current_chat !== undefined) {
        attrs.push(`type="switch_inline_query_current_chat" query="${escAttr(btn.switch_inline_query_current_chat)}"`);
      }
      return `<tg-button ${attrs.filter(Boolean).join(' ')}>${escButtonText(btn.text)}</tg-button>`;
    }).join('');
    return `<tg-button-row>${buttons}</tg-button-row>`;
  }).join('');
}

// Bot API 10.1+ rich message rendering on inline messages, used bot-wide for every game mode.
// Text renders via InputRichMessage.html (Telegram parses the same classic-HTML-mode tags our
// strings already use), buttons via <tg-button-row>/<tg-button> tags appended to that html. Falls
// back to plain editInlineMessage (identical html + the original InlineKeyboardMarkup) if the API
// rejects rich_message for any reason, so an imperfect guess at formatting nuances never breaks
// the message or its buttons.
export async function editInlineMessageRich(
  token: string,
  inlineMessageId: string,
  html: string,
  replyMarkup?: InlineKeyboardMarkup
): Promise<void> {
  await richRequest(token, 'editMessageText', { inline_message_id: inlineMessageId }, html, replyMarkup,
    classicHtml => editInlineMessage(token, inlineMessageId, classicHtml, replyMarkup));
}

// <hr> (InputRichBlockDivider) isn't a tag classic parse_mode: 'HTML' understands — Telegram
// rejects the whole message if it's present there. Needed whenever we fall back to the classic
// path, since a message can combine a footer's <hr> with content that forces the classic route.
function stripHrForClassic(html: string): string {
  return html.replace(/<hr\s*\/?>/g, '\n──────────');
}

// Shared by every rich-message variant: builds the html+buttons payload, posts it, and falls back
// to the caller's plain (non-rich) equivalent if the API rejects it for any reason.
//
// Any html containing <tg-emoji> (donator custom emoji) skips rich and goes straight to classic
// parse_mode: 'HTML'. Root cause confirmed by the owner's /emojitest (inline variants I1-I4 vs I5):
// in an INLINE message, rich_message renders a custom emoji as its plain fallback glyph only —
// even with nothing else in the message — while classic HTML shows and animates the real emoji.
// This matches the Bot API docs: custom emoji entities are only allowed in messages the bot sends
// directly to private/group/supergroup chats (with an owner-Premium account), and inline messages
// aren't in that list. (A rich message sent directly to a DM did animate, so rich itself is fine
// there; groups are untested, so chat messages stay classic too until someone verifies them.)
async function richRequest(
  token: string,
  method: string,
  target: Record<string, unknown>,
  html: string,
  replyMarkup: InlineKeyboardMarkup | undefined,
  fallback: (classicHtml: string) => Promise<void>
): Promise<void> {
  if (html.includes('<tg-emoji')) {
    await dbg('tg', { kind: 'rich-skipped-tg-emoji', method, html: html.slice(0, 500) }); // DEBUG SEMENTARA
    await fallback(stripHrForClassic(html));
    return;
  }
  const fullHtml = html + (replyMarkup ? keyboardToButtonHtml(replyMarkup) : '');
  try {
    const res = await fetch(`${API}${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...target, rich_message: { html: fullHtml } }),
    });
    const data = await res.json<{ ok: boolean; description?: string }>();
    await dbg('tg', { kind: 'rich-attempt', method, status: res.status, html: fullHtml.slice(0, 500), response: JSON.stringify(data).slice(0, 600) }); // DEBUG SEMENTARA
    if (res.ok && data.ok) return;
    console.error(`[tg:${method}Rich] rejected, falling back to plain text/buttons:`, JSON.stringify(data));
    await reportError(token, `tg:${method}Rich rejected → classic fallback`, JSON.stringify(data));
  } catch (e) {
    console.error(`[tg:${method}Rich] error, falling back to plain text/buttons:`, e);
    await reportError(token, `tg:${method}Rich threw → classic fallback`, String(e));
  }
  await fallback(stripHrForClassic(html));
}

// Same rich-message rendering as editInlineMessageRich, but for a regular chat message
// (chat_id + message_id) instead of an inline message — used by /guide navigation, which edits
// a normal message the bot sent in a DM/group, not an inline result.
export async function editMessageRich(
  token: string,
  chatId: number,
  messageId: number,
  html: string,
  replyMarkup?: InlineKeyboardMarkup
): Promise<void> {
  await richRequest(token, 'editMessageText', { chat_id: chatId, message_id: messageId }, html, replyMarkup,
    classicHtml => editMessage(token, chatId, messageId, classicHtml, replyMarkup));
}

// Sends a brand-new rich message (Bot API 10.3's sendRichMessage) instead of editing an existing
// one — used for the first-time display of content like /credits or /guide's main menu, where
// there's no prior message to edit yet.
export async function sendMessageRich(
  token: string,
  chatId: number,
  html: string,
  replyMarkup?: InlineKeyboardMarkup
): Promise<void> {
  await richRequest(token, 'sendRichMessage', { chat_id: chatId }, html, replyMarkup,
    classicHtml => sendMessage(token, chatId, classicHtml, replyMarkup));
}

export function sendMessage(
  token: string,
  chatId: number,
  text: string,
  replyMarkup?: InlineKeyboardMarkup
): Promise<void> {
  return call(token, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    ...(replyMarkup && { reply_markup: replyMarkup }),
  });
}

// Bot API 10.2+ ephemeral messages: visible only to receiverUserId within the group chat.
export async function sendEphemeralMessage(
  token: string,
  chatId: number,
  receiverUserId: number,
  text: string,
  replyMarkup?: InlineKeyboardMarkup
): Promise<number | null> {
  try {
    const res = await fetch(`${API}${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        ephemeral_message_parameters: { receiver_user_id: receiverUserId },
        ...(replyMarkup && { reply_markup: replyMarkup }),
      }),
    });
    if (!res.ok) {
      console.error('[tg:sendEphemeralMessage]', await res.text());
      return null;
    }
    const data = await res.json<{ ok: boolean; result?: { ephemeral_message_id?: number } }>();
    if (!data.ok) {
      console.error('[tg:sendEphemeralMessage] ok=false', JSON.stringify(data));
      return null;
    }
    return data.result?.ephemeral_message_id ?? null;
  } catch (e) {
    console.error('[tg:sendEphemeralMessage] error', e);
    return null;
  }
}

export async function editEphemeralMessageText(
  token: string,
  chatId: number,
  ephemeralMessageId: number,
  text: string,
  replyMarkup?: InlineKeyboardMarkup
): Promise<boolean> {
  try {
    const res = await fetch(`${API}${token}/editEphemeralMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        ephemeral_message_id: ephemeralMessageId,
        text,
        parse_mode: 'HTML',
        ...(replyMarkup && { reply_markup: replyMarkup }),
      }),
    });
    if (!res.ok) {
      console.error('[tg:editEphemeralMessageText]', await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error('[tg:editEphemeralMessageText] error', e);
    return false;
  }
}

export function answerPreCheckoutQuery(
  token: string,
  preCheckoutQueryId: string,
  ok: boolean,
  errorMessage?: string
): Promise<void> {
  return call(token, 'answerPreCheckoutQuery', {
    pre_checkout_query_id: preCheckoutQueryId,
    ok,
    ...(errorMessage && { error_message: errorMessage }),
  });
}

export async function getChatInfo(
  token: string,
  chatId: number
): Promise<{ first_name?: string; username?: string } | null> {
  try {
    const res = await fetch(`${API}${token}/getChat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId }),
    });
    if (!res.ok) return null;
    const data = await res.json<{ ok: boolean; result?: { first_name?: string; username?: string } }>();
    return data.ok ? (data.result ?? null) : null;
  } catch {
    return null;
  }
}

export function setMyCommands(
  token: string,
  commands: Array<{ command: string; description: string }>,
  scope: Record<string, unknown>,
  language_code?: string
): Promise<void> {
  return call(token, 'setMyCommands', { commands, scope, ...(language_code ? { language_code } : {}) });
}

export function sendInvoice(
  token: string,
  chatId: number,
  title: string,
  description: string,
  payload: string,
  currency: string,
  prices: Array<{ label: string; amount: number }>
): Promise<void> {
  return call(token, 'sendInvoice', {
    chat_id: chatId,
    title,
    description,
    payload,
    provider_token: '',
    currency,
    prices,
  });
}

export function sendChatAction(
  token: string,
  chatId: number,
  action: string
): Promise<void> {
  return call(token, 'sendChatAction', { chat_id: chatId, action });
}

export function sendPoll(
  token: string,
  chatId: number,
  question: string,
  options: string[],
  isAnonymous = true
): Promise<void> {
  return call(token, 'sendPoll', {
    chat_id: chatId,
    question,
    options,
    is_anonymous: isAnonymous,
  });
}

export async function sendDice(
  token: string,
  chatId: number,
  emoji = '🎲'
): Promise<number> {
  const res = await fetch(`${API}${token}/sendDice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, emoji }),
  });
  if (!res.ok) {
    console.error('[tg:sendDice]', await res.text());
    return 0;
  }
  const data = await res.json<{ result?: { dice?: { value?: number } } }>();
  return data.result?.dice?.value ?? 0;
}

export async function sendMessageForId(
  token: string,
  chatId: number,
  text: string,
  replyMarkup?: InlineKeyboardMarkup
): Promise<number | null> {
  try {
    const res = await fetch(`${API}${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        ...(replyMarkup && { reply_markup: replyMarkup }),
      }),
    });
    if (!res.ok) {
      console.error('[tg:sendMessageForId]', await res.text());
      return null;
    }
    const data = await res.json<{ ok: boolean; result?: { message_id: number } }>();
    if (!data.ok) {
      console.error('[tg:sendMessageForId] ok=false', JSON.stringify(data));
      return null;
    }
    return data.result?.message_id ?? null;
  } catch {
    return null;
  }
}

export function editMessage(
  token: string,
  chatId: number,
  messageId: number,
  text: string,
  replyMarkup?: InlineKeyboardMarkup
): Promise<void> {
  return call(token, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    ...(replyMarkup && { reply_markup: replyMarkup }),
  });
}

export async function getChatMember(
  token: string,
  chatId: number,
  userId: number
): Promise<{ status: string } | null> {
  try {
    const res = await fetch(`${API}${token}/getChatMember`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, user_id: userId }),
    });
    if (!res.ok) return null;
    const data = await res.json<{ ok: boolean; result?: { status: string } }>();
    return data.ok ? (data.result ?? null) : null;
  } catch {
    return null;
  }
}

export function pinChatMessage(
  token: string,
  chatId: number,
  messageId: number
): Promise<void> {
  return call(token, 'pinChatMessage', {
    chat_id: chatId,
    message_id: messageId,
    disable_notification: true,
  });
}

export function unpinChatMessage(
  token: string,
  chatId: number,
  messageId: number
): Promise<void> {
  return call(token, 'unpinChatMessage', { chat_id: chatId, message_id: messageId });
}

// Raw Bot API call that returns Telegram's full JSON response instead of swallowing it —
// used by the owner-only /emojitest diagnostic so the actual API verdict (and how Telegram
// parsed a rich message) can be read back, not just eyeballed.
export async function callRaw(
  token: string,
  method: string,
  body: Record<string, unknown>
): Promise<{ ok: boolean; description?: string; result?: Record<string, unknown> }> {
  try {
    const res = await fetch(`${API}${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch (e) {
    return { ok: false, description: String(e) };
  }
}
