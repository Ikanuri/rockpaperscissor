import type { Env } from './types';

export async function createCheckoutSession(
  env: Env,
  userId: number,
  tier: 'basic' | 'premium'
): Promise<string | null> {
  if (!env.STRIPE_SECRET_KEY) return null;

  const priceStr = await env.GAME_SESSIONS.get(`config:price:${tier}:stripe`);
  const amount = priceStr ? parseInt(priceStr) : (tier === 'basic' ? 500 : 2000);

  const params = new URLSearchParams({
    mode: 'payment',
    'payment_method_types[]': 'card',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][product_data][name]': `JankensBot ${tier.charAt(0).toUpperCase() + tier.slice(1)} Tier`,
    'line_items[0][price_data][unit_amount]': String(amount),
    'line_items[0][quantity]': '1',
    'metadata[user_id]': String(userId),
    'metadata[tier]': tier,
    success_url: `https://t.me/${env.BOT_USERNAME}`,
    cancel_url: `https://t.me/${env.BOT_USERNAME}`,
  });

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!res.ok) {
    console.error('[stripe] checkout error:', await res.text());
    return null;
  }

  const data = await res.json<{ url: string }>();
  return data.url;
}

export async function verifyStripeWebhook(
  body: string,
  signature: string,
  secret: string
): Promise<Record<string, unknown> | null> {
  const parts = signature.split(',').reduce<Record<string, string>>((acc, part) => {
    const [k, v] = part.split('=');
    if (k && v) acc[k] = v;
    return acc;
  }, {});

  const timestamp = parts['t'];
  const expectedSig = parts['v1'];
  if (!timestamp || !expectedSig) return null;

  const payload = `${timestamp}.${body}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const computed = Array.from(new Uint8Array(sigBytes))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  if (computed !== expectedSig) return null;
  return JSON.parse(body) as Record<string, unknown>;
}
