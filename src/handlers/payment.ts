import type { CallbackQuery, Env, PreCheckoutQuery, TelegramMessage } from '../types';
import { answerCallbackQuery, answerPreCheckoutQuery, sendInvoice, sendMessage } from '../telegram';
import { activateTier, loadDonatorTier, TIER_PERKS } from '../donator';
import { createCheckoutSession, verifyStripeWebhook } from '../stripe';

type Tier = 'basic' | 'premium';

const PRICE_DEFAULTS = {
  basic: { stars: 50, stripe: 500 },
  premium: { stars: 200, stripe: 2000 },
};

async function getPrices(kv: KVNamespace): Promise<typeof PRICE_DEFAULTS> {
  const [bs, bp, ps, pp] = await Promise.all([
    kv.get('config:price:basic:stars'),
    kv.get('config:price:basic:stripe'),
    kv.get('config:price:premium:stars'),
    kv.get('config:price:premium:stripe'),
  ]);
  return {
    basic: {
      stars: bs ? parseInt(bs) : PRICE_DEFAULTS.basic.stars,
      stripe: bp ? parseInt(bp) : PRICE_DEFAULTS.basic.stripe,
    },
    premium: {
      stars: ps ? parseInt(ps) : PRICE_DEFAULTS.premium.stars,
      stripe: pp ? parseInt(pp) : PRICE_DEFAULTS.premium.stripe,
    },
  };
}

export async function handleDonate(msg: TelegramMessage, env: Env): Promise<void> {
  const userId = msg.from!.id;
  const token = env.BOT_TOKEN;
  const kv = env.GAME_SESSIONS;
  const stripeEnabled = !!env.STRIPE_SECRET_KEY;

  const [prices, currentTier] = await Promise.all([
    getPrices(kv),
    loadDonatorTier(kv, userId),
  ]);

  let text = `💎 <b>JankensBot Donator</b>\n\nDukung bot dan dapatkan perks eksklusif!\n\n`;

  for (const [tier, info] of [['basic', TIER_PERKS.basic], ['premium', TIER_PERKS.premium]] as [Tier, typeof TIER_PERKS.basic][]) {
    text += `<b>${info.label}</b> — ${prices[tier].stars} ⭐`;
    if (stripeEnabled) text += ` atau $${(prices[tier].stripe / 100).toFixed(2)}`;
    text += `\n${info.features.map(f => `  ✅ ${f}`).join('\n')}\n\n`;
  }

  if (currentTier !== 'free') {
    const record = await kv.get<{ expiry: number }>(`donator:${userId}`, 'json');
    if (record) {
      const days = Math.ceil((record.expiry - Date.now()) / (24 * 3600 * 1000));
      text += `\n🎫 Current: <b>${TIER_PERKS[currentTier].label}</b> — expires in ${days} day${days !== 1 ? 's' : ''}`;
    }
  }

  const basicRow = [
    { text: `🥉 Basic · ${prices.basic.stars} ⭐`, callback_data: 'donate:basic:stars' },
    ...(stripeEnabled ? [{ text: `🥉 $${(prices.basic.stripe / 100).toFixed(2)} 💳`, callback_data: 'donate:basic:stripe' }] : []),
  ];
  const premRow = [
    { text: `🥇 Premium · ${prices.premium.stars} ⭐`, callback_data: 'donate:premium:stars' },
    ...(stripeEnabled ? [{ text: `🥇 $${(prices.premium.stripe / 100).toFixed(2)} 💳`, callback_data: 'donate:premium:stripe' }] : []),
  ];

  await sendMessage(token, msg.chat.id, text, { inline_keyboard: [basicRow, premRow] });
}

export async function handleDonateCallback(query: CallbackQuery, env: Env): Promise<void> {
  if (!query.message) {
    await answerCallbackQuery(env.BOT_TOKEN, query.id, '❌ Cannot process.', true);
    return;
  }

  const parts = query.data!.split(':');
  const tier = parts[1] as Tier;
  const method = parts[2] as 'stars' | 'stripe';
  const userId = query.from.id;
  const token = env.BOT_TOKEN;
  const kv = env.GAME_SESSIONS;

  if (!['basic', 'premium'].includes(tier)) {
    await answerCallbackQuery(token, query.id, '❌ Invalid tier.', true);
    return;
  }

  const prices = await getPrices(kv);

  if (method === 'stars') {
    await answerCallbackQuery(token, query.id);
    await sendInvoice(
      token,
      query.message.chat.id,
      `JankensBot ${TIER_PERKS[tier].label}`,
      TIER_PERKS[tier].features.join(', ') + ' — 30 hari',
      `donate:${tier}:${userId}`,
      'XTR',
      [{ label: TIER_PERKS[tier].label, amount: prices[tier].stars }]
    );
  } else if (method === 'stripe' && env.STRIPE_SECRET_KEY) {
    try {
      const url = await createCheckoutSession(
        env.STRIPE_SECRET_KEY,
        prices[tier].stripe,
        'usd',
        `https://t.me/${env.BOT_USERNAME}`,
        { tier, user_id: String(userId), product_name: `JankensBot ${TIER_PERKS[tier].label}` }
      );
      await answerCallbackQuery(token, query.id);
      await sendMessage(token, query.message.chat.id,
        `💳 <b>Bayar via Stripe:</b>\n${url}\n\n⏳ Link berlaku 30 menit.`
      );
    } catch {
      await answerCallbackQuery(token, query.id, '❌ Payment service unavailable.', true);
    }
  } else {
    await answerCallbackQuery(token, query.id, '❌ Payment method not available.', true);
  }
}

export async function handlePreCheckout(query: PreCheckoutQuery, env: Env): Promise<void> {
  const parts = query.invoice_payload.split(':');
  if (parts[0] === 'donate' && (parts[1] === 'basic' || parts[1] === 'premium')) {
    await answerPreCheckoutQuery(env.BOT_TOKEN, query.id, true);
  } else {
    await answerPreCheckoutQuery(env.BOT_TOKEN, query.id, false, 'Invalid invoice.');
  }
}

export async function handleSuccessfulPayment(msg: TelegramMessage, env: Env): Promise<void> {
  const payment = msg.successful_payment!;
  const parts = payment.invoice_payload.split(':');
  if (parts[0] !== 'donate') return;

  const tier = parts[1] as Tier;
  if (!['basic', 'premium'].includes(tier)) return;

  const userId = msg.from!.id;
  await activateTier(env.GAME_SESSIONS, userId, tier, 'stars');

  await sendMessage(
    env.BOT_TOKEN, msg.chat.id,
    `🎉 <b>${TIER_PERKS[tier].label} activated!</b>\n\n` +
    `Terima kasih! Perks berlaku selama 30 hari.\n` +
    TIER_PERKS[tier].features.map(f => `✅ ${f}`).join('\n')
  );
}

export async function handleStripeWebhook(request: Request, env: Env): Promise<Response> {
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) {
    return new Response('Not configured', { status: 400 });
  }

  const body = await request.text();
  const signature = request.headers.get('stripe-signature') ?? '';

  try {
    const event = await verifyStripeWebhook(body, signature, env.STRIPE_WEBHOOK_SECRET);
    if (event['type'] === 'checkout.session.completed') {
      const session = (event['data'] as { object: { metadata?: Record<string, string> } }).object;
      const meta = session.metadata;
      if (meta?.['tier'] && meta?.['user_id'] && (meta['tier'] === 'basic' || meta['tier'] === 'premium')) {
        await activateTier(
          env.GAME_SESSIONS,
          parseInt(meta['user_id']),
          meta['tier'] as Tier,
          'stripe'
        );
      }
    }
    return new Response('OK');
  } catch {
    return new Response('Invalid signature', { status: 400 });
  }
}
