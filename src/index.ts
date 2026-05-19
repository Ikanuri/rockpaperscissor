import type { Env, TelegramUpdate } from './types';
import { handleInlineQuery, handleChosenInlineResult } from './handlers/inline';
import { handleCallbackQuery } from './handlers/callback';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== 'POST') return new Response('OK');

    try {
      const update = await request.json<TelegramUpdate>();

      if (update.inline_query) {
        await handleInlineQuery(update.inline_query, env);
      } else if (update.chosen_inline_result) {
        await handleChosenInlineResult(update.chosen_inline_result, env, ctx);
      } else if (update.callback_query) {
        await handleCallbackQuery(update.callback_query, env, ctx);
      }
    } catch (err) {
      console.error('Webhook error:', err);
    }

    // Always return 200 — Telegram retries on non-200
    return new Response('OK');
  },
};
