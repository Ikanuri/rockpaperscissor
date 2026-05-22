import type { Env, TelegramUpdate } from './types';
import { handleInlineQuery, handleChosenInlineResult } from './handlers/inline';
import { handleCallbackQuery } from './handlers/callback';
import { handleMessage } from './handlers/message';
import { handlePreCheckout, handleStripeWebhook } from './handlers/payment';
import { hasFeature } from './feature';
import { sendMessage } from './telegram';

async function handleDailyChallenge(env: Env): Promise<void> {
  const chatIdStr = await env.GAME_SESSIONS.get('config:daily_challenge_chat');
  if (!chatIdStr) return;
  const chatId = parseInt(chatIdStr);
  if (isNaN(chatId)) return;
  await sendMessage(env.BOT_TOKEN, chatId,
    `🎮 <b>Daily RPS Challenge!</b>\n` +
    `Siapa yang bisa menang paling banyak hari ini?\n\n` +
    `Ketik <code>@${env.BOT_USERNAME}</code> untuk mulai! ✊✋✌️`
  );
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/stripe-webhook') {
      return handleStripeWebhook(request, env);
    }

    if (request.method !== 'POST') return new Response('OK');

    try {
      const update = await request.json<TelegramUpdate>();

      if (update.inline_query) {
        await handleInlineQuery(update.inline_query, env);
      } else if (update.chosen_inline_result) {
        await handleChosenInlineResult(update.chosen_inline_result, env, ctx);
      } else if (update.callback_query) {
        await handleCallbackQuery(update.callback_query, env, ctx);
      } else if (update.pre_checkout_query && hasFeature(env, 'donator')) {
        await handlePreCheckout(update.pre_checkout_query, env);
      } else if (update.message) {
        await handleMessage(update.message, env);
      }
    } catch (err) {
      console.error('Webhook error:', err);
    }

    // Always return 200 — Telegram retries on non-200
    return new Response('OK');
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleDailyChallenge(env));
  },
};
