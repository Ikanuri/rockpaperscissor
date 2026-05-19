import type { InlineKeyboardMarkup, InlineQueryResultArticle } from './types';

const API = 'https://api.telegram.org/bot';

async function call(
  token: string,
  method: string,
  body: Record<string, unknown>
): Promise<void> {
  const res = await fetch(`${API}${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`[tg:${method}]`, await res.text());
  }
}

export function answerInlineQuery(
  token: string,
  queryId: string,
  results: InlineQueryResultArticle[]
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
  replyMarkup?: InlineKeyboardMarkup
): Promise<void> {
  return call(token, 'editMessageText', {
    inline_message_id: inlineMessageId,
    text,
    parse_mode: 'Markdown',
    ...(replyMarkup && { reply_markup: replyMarkup }),
  });
}
