import type { Env, LeaderboardEntry, TelegramUpdate } from './types';
import { handleInlineQuery, handleChosenInlineResult } from './handlers/inline';
import { handleCallbackQuery } from './handlers/callback';
import { handleMessage } from './handlers/message';
import { handlePreCheckout, handleStripeWebhook } from './handlers/payment';
import { hasFeature } from './feature';
import { sendMessage } from './telegram';
import { getDayIndex, escHtml } from './game';

async function handleDailyChallenge(env: Env): Promise<void> {
  const chatIdStr = await env.GAME_SESSIONS.get('config:daily_challenge_chat');
  if (!chatIdStr) return;
  const chatId = parseInt(chatIdStr);
  if (isNaN(chatId)) return;

  const yesterdayIdx = getDayIndex() - 1;
  const yesterdayBoard = yesterdayIdx >= 0
    ? await env.GAME_SESSIONS.get<LeaderboardEntry[]>(`daily:${yesterdayIdx}:leaderboard`, 'json')
    : null;

  let text = `🎮 <b>Daily RPS Challenge!</b>\nSiapa yang bisa menang paling banyak hari ini?\n\n`;
  if (yesterdayBoard && yesterdayBoard.length > 0) {
    const champ = yesterdayBoard[0];
    text += `👑 Juara kemarin: <b>${escHtml(champ.name)}</b> (${champ.wins}W / ${champ.total} game)\n\n`;
  }
  text += `Ketik <code>@${env.BOT_USERNAME}</code> untuk mulai! ✊✋✌️`;

  await sendMessage(env.BOT_TOKEN, chatId, text);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/stripe-webhook') {
      return handleStripeWebhook(request, env);
    }

    if (request.method !== 'POST') return new Response('OK');

    if (env.WEBHOOK_SECRET) {
      const incoming = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
      if (incoming !== env.WEBHOOK_SECRET) return new Response('Unauthorized', { status: 401 });
    }

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
        await handleMessage(update.message, env, ctx);
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
