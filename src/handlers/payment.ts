import type { CallbackQuery, Env, PreCheckoutQuery, TelegramMessage } from '../types';
import { answerCallbackQuery, answerPreCheckoutQuery, sendInvoice, sendMessage } from '../telegram';
import { activateTier, loadDonatorTier, TIER_PERKS } from '../donator';
import { createCheckoutSession } from '../stripe';

async function getPrices(kv: KVNamespace) {
  const [bs, bstr, ps, pstr] = await Promise.all([
    kv.get('config:price:basic:stars'),
    kv.get('config:price:basic:stripe'),
    kv.get('config:price:premium:stars'),
    kv.get('config:price:premium:stripe'),
  ]);
  return {
    basic: { stars: parseInt(bs ?? '50'), stripe: parseInt(bstr ?? '500') },
    premium: { stars: parseInt(ps ?? '200'), stripe: parseInt(pstr ?? '2000') },
  };
}

export async function handleDonate(msg: TelegramMessage, env: Env): Promise<void> {
  if (!msg.from) return;

  const kv = env.GAME_SESSIONS;
  const prices = await getPrices(kv);
  const currentTier = await loadDonatorTier(kv, msg.from.id);

  const tierLine = currentTier !== 'free'
    ? `\n<i>Your current tier: <b>${currentTier}</b></i>\n`
    : '';

  const text =
    `💎 <b>JankensBot Donator</b>${tierLine}\n\n` +
    `🥉 <b>Basic</b> — ${prices.basic.stars} ⭐ or $${(prices.basic.stripe / 100).toFixed(2)}\n` +
    `  ${TIER_PERKS.basic}\n\n` +
    `🥇 <b>Premium</b> — ${prices.premium.stars} ⭐ or $${(prices.premium.stripe / 100).toFixed(2)}\n` +
    `  ${TIER_PERKS.premium}`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: `🥉 Basic · ${prices.basic.stars} ⭐`, callback_data: 'donate:basic:stars' },
        ...(env.STRIPE_SECRET_KEY
          ? [{ text: `🥉 Basic · $${(prices.basic.stripe / 100).toFixed(0)} 💳`, callback_data: 'donate:basic:stripe' }]
          : []),
      ],
      [
        { text: `🥇 Premium · ${prices.premium.stars} ⭐`, callback_data: 'donate:premium:stars' },
        ...(env.STRIPE_SECRET_KEY
          ? [{ text: `🥇 Premium · $${(prices.premium.stripe / 100).toFixed(0)} 💳`, callback_data: 'donate:premium:stripe' }]
          : []),
      ],
    ],
  };

  await sendMessage(env.BOT_TOKEN, msg.chat.id, text, keyboard);
}

export async function handleDonateCallback(
  query: CallbackQuery,
  env: Env
): Promise<void> {
  const token = env.BOT_TOKEN;
  const parts = (query.data ?? '').split(':');
  const tier = parts[1] as 'basic' | 'premium';
  const method = parts[2] as 'stars' | 'stripe';

  if (!['basic', 'premium'].includes(tier)) {
    await answerCallbackQuery(token, query.id);
    return;
  }

  const chatId = query.message?.chat.id ?? query.from.id;
  const prices = await getPrices(env.GAME_SESSIONS);
  const amount = prices[tier][method === 'stars' ? 'stars' : 'stripe'];

  if (method === 'stars') {
    await answerCallbackQuery(token, query.id);
    await sendInvoice(
      token,
      chatId,
      `JankensBot ${tier.charAt(0).toUpperCase() + tier.slice(1)} Tier`,
      TIER_PERKS[tier],
      `donate:${tier}:${query.from.id}`,
      'XTR',
      [{ label: `${tier.charAt(0).toUpperCase() + tier.slice(1)} Tier`, amount }]
    );
  } else if (method === 'stripe' && env.STRIPE_SECRET_KEY) {
    await answerCallbackQuery(token, query.id, '⏳ Generating payment link...');
    const url = await createCheckoutSession(env, query.from.id, tier);
    if (url) {
      await sendMessage(token, chatId, `💳 <a href="${url}">Click here to pay via card</a>\n\nLink expires in 24 hours.`);
    } else {
      await sendMessage(token, chatId, '❌ Card payment unavailable. Try Stars instead.');
    }
  } else {
    await answerCallbackQuery(token, query.id, '❌ Payment method unavailable.', true);
  }
}

export async function handlePreCheckout(
  query: PreCheckoutQuery,
  env: Env
): Promise<void> {
  await answerPreCheckoutQuery(env.BOT_TOKEN, query.id, true);
}

export async function handleSuccessfulPayment(
  msg: TelegramMessage,
  env: Env
): Promise<void> {
  if (!msg.successful_payment || !msg.from) return;

  const parts = msg.successful_payment.invoice_payload.split(':');
  if (parts[0] !== 'donate' || parts.length < 3) return;

  const tier = parts[1] as 'basic' | 'premium';
  const userId = parseInt(parts[2]);

  if (!['basic', 'premium'].includes(tier) || !userId) return;

  await activateTier(env.GAME_SESSIONS, userId, tier, 'stars');
  await sendMessage(
    env.BOT_TOKEN,
    msg.chat.id,
    `✅ <b>Thank you!</b> Your <b>${tier}</b> tier is now active for 30 days.\n\n${TIER_PERKS[tier]}`
  );
}

export async function handleStripeWebhook(
  request: Request,
  env: Env
): Promise<Response> {
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) {
    return new Response('Not configured', { status: 400 });
  }

  const body = await request.text();
  const signature = request.headers.get('Stripe-Signature') ?? '';

  const { verifyStripeWebhook } = await import('../stripe');
  const event = await verifyStripeWebhook(body, signature, env.STRIPE_WEBHOOK_SECRET);
  if (!event) return new Response('Invalid signature', { status: 400 });

  if (event.type === 'checkout.session.completed') {
    const session = (event as { data: { object: { metadata?: { user_id?: string; tier?: string } } } }).data.object;
    const userId = parseInt(session.metadata?.user_id ?? '0');
    const tier = session.metadata?.tier as 'basic' | 'premium' | undefined;

    if (userId && (tier === 'basic' || tier === 'premium')) {
      await activateTier(env.GAME_SESSIONS, userId, tier, 'stripe');
      await sendMessage(
        env.BOT_TOKEN,
        userId,
        `✅ Payment confirmed! Your <b>${tier}</b> tier is now active for 30 days.\n\n${TIER_PERKS[tier]}`
      );
    }
  }

  return new Response('OK');
}
