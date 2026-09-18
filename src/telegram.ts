import type { InlineKeyboardMarkup, InlineResult } from './types';

const API = 'https://api.telegram.org/bot';

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
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
    if (res.status === 429) {
      const data = await res.json<{ parameters?: { retry_after?: number } }>();
      const wait = Math.min((data.parameters?.retry_after ?? 5) * 1000, maxRetryWait);
      if (wait <= 0) return;
      await sleep(wait);
      continue;
    }
    if (!res.ok) console.error(`[tg:${method}]`, await res.text());
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

interface RichMessageButton {
  text: string;
  style?: 'primary' | 'success' | 'danger';
  callback_data?: string;
  url?: string;
  switch_inline_query_current_chat?: string;
}

type RichText = string | RichText[] | { type: 'custom_emoji'; custom_emoji_id: string; alternative_text: string };

type RichBlock =
  | { type: 'paragraph'; text: RichText }
  | { type: 'expandable_blockquote'; text: RichText }
  | { type: 'buttons'; buttons: RichMessageButton[] };

// escHtml() only ever escapes &, <, > — reverse exactly that (nothing more) for the plain-text
// portions once real tags have been pulled out below.
function unescapeBasicHtml(s: string): string {
  return s.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
}

// The ONLY inline tag this codebase emits into rich-eligible text is
// fmtEmoji()'s <tg-emoji emoji-id="ID">FALLBACK</tg-emoji> (game.ts). Anything else in a text
// segment is literal, escHtml()-escaped content.
const TG_EMOJI_RE = /<tg-emoji emoji-id="(\d+)">(.*?)<\/tg-emoji>/g;

function parseInlineRichText(segment: string): RichText {
  const parts: RichText[] = [];
  let lastIndex = 0;
  for (const m of segment.matchAll(TG_EMOJI_RE)) {
    if (m.index! > lastIndex) parts.push(unescapeBasicHtml(segment.slice(lastIndex, m.index)));
    parts.push({ type: 'custom_emoji', custom_emoji_id: m[1], alternative_text: unescapeBasicHtml(m[2]) });
    lastIndex = m.index! + m[0].length;
  }
  if (lastIndex < segment.length) parts.push(unescapeBasicHtml(segment.slice(lastIndex)));
  if (parts.length === 0) return '';
  return parts.length === 1 ? parts[0] : parts;
}

// The only BLOCK-level tag this codebase emits is historyBlock()'s
// <blockquote expandable>...multi-line...</blockquote> (game.ts). Everything outside of it is
// plain paragraphs, one per '\n'-separated line (blank lines become empty paragraphs, preserving
// the original spacing).
const BLOCKQUOTE_RE = /<blockquote expandable>([\s\S]*?)<\/blockquote>/g;

function htmlToBlocks(html: string): RichBlock[] {
  const blocks: RichBlock[] = [];
  let lastIndex = 0;
  for (const m of html.matchAll(BLOCKQUOTE_RE)) {
    if (m.index! > lastIndex) {
      for (const line of html.slice(lastIndex, m.index).split('\n')) {
        blocks.push({ type: 'paragraph', text: parseInlineRichText(line) });
      }
    }
    blocks.push({ type: 'expandable_blockquote', text: parseInlineRichText(m[1]) });
    lastIndex = m.index! + m[0].length;
  }
  if (lastIndex < html.length) {
    for (const line of html.slice(lastIndex).split('\n')) {
      blocks.push({ type: 'paragraph', text: parseInlineRichText(line) });
    }
  }
  return blocks;
}

// InlineKeyboardButton fields map 1:1 onto RichMessageButton (confirmed against the Bot API
// spec) — callback_data still fires a normal callback_query, so handleCallbackQuery needs no
// changes. One InputRichBlockButtons block == one button row.
function keyboardToButtonBlocks(kb: InlineKeyboardMarkup): RichBlock[] {
  return kb.inline_keyboard.map(row => ({
    type: 'buttons',
    buttons: row.map(btn => ({
      text: btn.text,
      ...(btn.style && { style: btn.style }),
      ...(btn.callback_data && { callback_data: btn.callback_data }),
      ...(btn.url && { url: btn.url }),
      ...(btn.switch_inline_query_current_chat !== undefined && { switch_inline_query_current_chat: btn.switch_inline_query_current_chat }),
    })),
  }));
}

// Bot API 10.1+ rich message experiment on inline messages. Text and buttons both render through
// InputRichMessage.blocks: text as paragraphs/expandable-blockquotes (see htmlToBlocks — scoped
// exactly to the two tags this codebase actually emits into rich-eligible text, <tg-emoji> and
// <blockquote expandable>, since RichText plain-string leaves are never HTML-parsed and a
// general-purpose HTML→RichText converter isn't a safe bet to keep in sync with arbitrary future
// markup), buttons as InputRichBlockButtons (RichMessageButton fields map 1:1 onto
// InlineKeyboardButton, callback_data still fires a normal callback_query). Falls back to plain
// editInlineMessage (identical html + the original InlineKeyboardMarkup) if the API rejects
// rich_message for any reason, so an imperfect guess at formatting nuances never breaks the
// message or its buttons.
export async function editInlineMessageRich(
  token: string,
  inlineMessageId: string,
  html: string,
  replyMarkup?: InlineKeyboardMarkup
): Promise<void> {
  // DEBUG marker (beta only) — proves visually whether rich_message actually rendered vs
  // silently falling back. Remove once confirmed working.
  const marked = `✨ RICH\n${html}`;
  const blocks = [...htmlToBlocks(marked), ...(replyMarkup ? keyboardToButtonBlocks(replyMarkup) : [])];
  try {
    const res = await fetch(`${API}${token}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inline_message_id: inlineMessageId,
        rich_message: { blocks },
      }),
    });
    const data = await res.json<{ ok: boolean; description?: string }>();
    if (res.ok && data.ok) return;
    console.error('[tg:editInlineMessageRich] rejected, falling back to plain text/buttons:', JSON.stringify(data));
  } catch (e) {
    console.error('[tg:editInlineMessageRich] error, falling back to plain text/buttons:', e);
  }
  await editInlineMessage(token, inlineMessageId, html, replyMarkup);
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
