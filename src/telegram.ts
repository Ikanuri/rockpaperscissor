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

export function setMyCommands(
  token: string,
  commands: Array<{ command: string; description: string }>,
  scope: Record<string, unknown>
): Promise<void> {
  return call(token, 'setMyCommands', { commands, scope });
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
