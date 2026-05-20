import type { Env, TelegramUpdate } from './types';
import { handleInlineQuery, handleChosenInlineResult } from './handlers/inline';
import { handleCallbackQuery } from './handlers/callback';
import { handleMessage } from './handlers/message';
import { handlePreCheckout, handleSuccessfulPayment, handleStripeWebhook } from './handlers/payment';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== 'POST') return new Response('OK');

    const url = new URL(request.url);

    // Stripe webhook endpoint
    if (url.pathname === '/stripe-webhook') {
      return handleStripeWebhook(request, env);
    }

    try {
      const update = await request.json<TelegramUpdate>();

      if (update.inline_query) {
        await handleInlineQuery(update.inline_query, env);
      } else if (update.chosen_inline_result) {
        await handleChosenInlineResult(update.chosen_inline_result, env, ctx);
      } else if (update.callback_query) {
        await handleCallbackQuery(update.callback_query, env, ctx);
      } else if (update.pre_checkout_query) {
        await handlePreCheckout(update.pre_checkout_query, env);
      } else if (update.message) {
        if (update.message.successful_payment) {
          await handleSuccessfulPayment(update.message, env);
        } else {
          await handleMessage(update.message, env);
        }
      }
    } catch (err) {
      console.error('Webhook error:', err);
    }

    // Always return 200 — Telegram retries on non-200
    return new Response('OK');
  },
};
