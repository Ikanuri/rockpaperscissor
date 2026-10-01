import type { Env, LeaderboardEntry, TelegramUpdate } from './types';
import { handleInlineQuery, handleChosenInlineResult } from './handlers/inline';
import { handleCallbackQuery } from './handlers/callback';
import { handleMessage } from './handlers/message';
import { handlePreCheckout, handleStripeWebhook } from './handlers/payment';
import { hasFeature } from './feature';
import { enableErrorDebug, reportError, sendMessage } from './telegram';
import { dbg, enableDebug, handleDebugRequest } from './debug'; // DEBUG SEMENTARA
import { getDayIndex, getReleaseMs, escHtml } from './game';

async function handleDailyChallenge(env: Env): Promise<void> {
  const chatIdStr = await env.GAME_SESSIONS.get('config:daily_challenge_chat');
  if (!chatIdStr) return;
  const chatId = parseInt(chatIdStr);
  if (isNaN(chatId)) return;

  const yesterdayIdx = getDayIndex(await getReleaseMs(env.GAME_SESSIONS)) - 1;
  const yesterdayBoard = yesterdayIdx >= 0
    ? await env.GAME_SESSIONS.get<LeaderboardEntry[]>(`daily:${yesterdayIdx}:leaderboard`, 'json')
    : null;

  let text = `🎮 <b>Daily RPS Challenge!</b>\nSiapa yang bisa menang paling banyak hari ini?\n\n`;
  if (yesterdayBoard && yesterdayBoard.length > 0) {
    const champ = yesterdayBoard[0];
    const champInfo = await env.GAME_SESSIONS.get<{ name: string }>(`user:info:${champ.userId}`, 'json');
    const champName = champInfo?.name ?? (champ.name.startsWith('@') ? champ.name.slice(1) : champ.name);
    text += `👑 Juara kemarin: <b>${escHtml(champName)}</b> (${champ.wins}W / ${champ.total} game)\n\n`;
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

    // DEBUG SEMENTARA: endpoint baca log, dijaga DEBUG_SECRET (salah/kosong -> 404)
    if (request.method === 'GET' && url.pathname.startsWith('/debug/')) {
      return handleDebugRequest(request, env);
    }

    if (request.method !== 'POST') return new Response('OK');

    if (env.WEBHOOK_SECRET) {
      const incoming = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
      if (incoming !== env.WEBHOOK_SECRET) return new Response('Unauthorized', { status: 401 });
    }

    if (hasFeature(env, 'debug_errors')) enableErrorDebug(env.BOT_OWNER_ID);
    enableDebug(env); // DEBUG SEMENTARA

    try {
      const update = await request.json<TelegramUpdate>();

      // DEBUG SEMENTARA: ringkasan update masuk (tanpa isi chat biasa)
      await dbg('in', {
        kind: update.inline_query ? 'inline_query' : update.chosen_inline_result ? 'chosen_inline_result'
          : update.callback_query ? 'callback_query' : update.message ? 'message' : 'other',
        from: (update.inline_query ?? update.chosen_inline_result ?? update.callback_query ?? update.message)?.from?.id,
        query: update.inline_query?.query ?? update.chosen_inline_result?.query,
        result_id: update.chosen_inline_result?.result_id,
        has_inline_message_id: !!(update.chosen_inline_result?.inline_message_id ?? update.callback_query?.inline_message_id),
        data: update.callback_query?.data,
        command: update.message?.text?.startsWith('/') ? update.message.text.slice(0, 60) : undefined,
      });

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
      await reportError(env.BOT_TOKEN, 'Webhook error', err instanceof Error ? (err.stack ?? err.message) : String(err));
    }

    // Always return 200 — Telegram retries on non-200
    return new Response('OK');
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleDailyChallenge(env));
  },
};
