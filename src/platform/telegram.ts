import type { InlineKeyboardMarkup, InlineResult } from '../types';
import { api } from 'sdk';
import { waitMs } from './runtime';

// Platform copy of src/telegram.ts: identical wrappers and rich/classic rules, but every Bot API
// call goes through the platform's `api` (no bot token, no fetch). Keep the two files in step.
type TgResult = { ok: boolean; result?: any; description?: string; code?: number; parameters?: any };

async function tgRaw(method: string, body: Record<string, unknown>): Promise<TgResult> {
  try {
    const result = await (api as any)[method](body);
    return { ok: true, result };
  } catch (e: any) {
    return { ok: false, description: e?.description ?? String(e), code: e?.code, parameters: e?.parameters };
  }
}

async function call(
  _token: string,
  method: string,
  body: Record<string, unknown>,
  maxRetryWait = 10_000
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await tgRaw(method, body);
    if (r.ok) return;
    if (r.code === 429) {
      const wait = Math.min((r.parameters?.retry_after ?? 5) * 1000, maxRetryWait);
      if (wait <= 0) return;
      await waitMs(wait);
      continue;
    }
    console.error(`[tg:${method}]`, r.code, r.description);
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
// Inline messages that contain <tg-emoji> (donator custom emoji) skip rich and go straight to
// classic parse_mode: 'HTML'. Root cause confirmed by the owner's /emojitest (inline variants I1-I4
// vs I5, plus a real game result sent both inline and as a direct DM): in an INLINE message,
// rich_message renders a custom emoji as its plain fallback glyph only — even with nothing else in
// the message — while classic HTML shows and animates the real emoji. This matches the Bot API
// docs: custom emoji entities are only allowed in messages the bot sends directly to
// private/group/supergroup chats, and inline messages aren't in that list. Rich messages sent
// directly to a DM or a group were verified to show AND animate the real emoji (all encodings),
// so non-inline targets stay rich.
async function richRequest(
  token: string,
  method: string,
  target: Record<string, unknown>,
  html: string,
  replyMarkup: InlineKeyboardMarkup | undefined,
  fallback: (classicHtml: string) => Promise<void>
): Promise<void> {
  if (html.includes('<tg-emoji') && 'inline_message_id' in target) {
    await fallback(stripHrForClassic(html));
    return;
  }
  const fullHtml = html + (replyMarkup ? keyboardToButtonHtml(replyMarkup) : '');
  const r = await tgRaw(method, { ...target, rich_message: { html: fullHtml } });
  if (r.ok) return;
  console.error(`[tg:${method}Rich] rejected, falling back to plain text/buttons:`, r.code, r.description);
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
  _token: string,
  chatId: number,
  receiverUserId: number,
  text: string,
  replyMarkup?: InlineKeyboardMarkup
): Promise<number | null> {
  const r = await tgRaw('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    ephemeral_message_parameters: { receiver_user_id: receiverUserId },
    ...(replyMarkup && { reply_markup: replyMarkup }),
  });
  if (!r.ok) {
    console.error('[tg:sendEphemeralMessage]', r.code, r.description);
    return null;
  }
  return r.result?.ephemeral_message_id ?? null;
}

export async function editEphemeralMessageText(
  _token: string,
  chatId: number,
  ephemeralMessageId: number,
  text: string,
  replyMarkup?: InlineKeyboardMarkup
): Promise<boolean> {
  const r = await tgRaw('editEphemeralMessageText', {
    chat_id: chatId,
    ephemeral_message_id: ephemeralMessageId,
    text,
    parse_mode: 'HTML',
    ...(replyMarkup && { reply_markup: replyMarkup }),
  });
  if (!r.ok) console.error('[tg:editEphemeralMessageText]', r.code, r.description);
  return r.ok;
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
  _token: string,
  chatId: number
): Promise<{ first_name?: string; username?: string } | null> {
  const r = await tgRaw('getChat', { chat_id: chatId });
  return r.ok ? (r.result ?? null) : null;
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
  _token: string,
  chatId: number,
  emoji = '🎲'
): Promise<number> {
  const r = await tgRaw('sendDice', { chat_id: chatId, emoji });
  if (!r.ok) {
    console.error('[tg:sendDice]', r.code, r.description);
    return 0;
  }
  return r.result?.dice?.value ?? 0;
}

export async function sendMessageForId(
  _token: string,
  chatId: number,
  text: string,
  replyMarkup?: InlineKeyboardMarkup
): Promise<number | null> {
  const r = await tgRaw('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    ...(replyMarkup && { reply_markup: replyMarkup }),
  });
  if (!r.ok) {
    console.error('[tg:sendMessageForId]', r.code, r.description);
    return null;
  }
  return r.result?.message_id ?? null;
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
  _token: string,
  chatId: number,
  userId: number
): Promise<{ status: string } | null> {
  const r = await tgRaw('getChatMember', { chat_id: chatId, user_id: userId });
  return r.ok ? (r.result ?? null) : null;
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

// Raw Bot API call that returns the full verdict instead of swallowing it (owner-only /emojitest).
export async function callRaw(
  _token: string,
  method: string,
  body: Record<string, unknown>
): Promise<{ ok: boolean; description?: string; result?: Record<string, unknown> }> {
  const r = await tgRaw(method, body);
  return { ok: r.ok, description: r.description, result: r.result };
}
