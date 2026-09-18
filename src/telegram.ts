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

// Bot API 10.1+ rich message experiment: renders via InputRichMessage.html (same HTML string
// we already build for parse_mode: 'HTML') on top of an inline message. reply_markup stays a
// separate, unchanged parameter (confirmed in the API spec), so existing callback buttons are
// unaffected. Falls back to plain editInlineMessage if the API rejects rich_message for any
// reason, so an imperfect guess at formatting nuances never breaks the result display.
export async function editInlineMessageRich(
  token: string,
  inlineMessageId: string,
  html: string,
  replyMarkup?: InlineKeyboardMarkup
): Promise<void> {
  // DEBUG marker (beta only) — proves visually whether rich_message actually rendered vs
  // silently falling back. Remove once confirmed working.
  const markedHtml = `✨<i>rich</i>\n${html}`;
  try {
    const res = await fetch(`${API}${token}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inline_message_id: inlineMessageId,
        rich_message: { html: markedHtml },
        ...(replyMarkup && { reply_markup: replyMarkup }),
      }),
    });
    const data = await res.json<{ ok: boolean; description?: string }>();
    if (res.ok && data.ok) return;
    console.error('[tg:editInlineMessageRich] rejected, falling back to plain text:', JSON.stringify(data));
  } catch (e) {
    console.error('[tg:editInlineMessageRich] error, falling back to plain text:', e);
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
