export async function createCheckoutSession(
  secretKey: string,
  amount: number,
  currency: string,
  cancelUrl: string,
  metadata: Record<string, string>
): Promise<string> {
  const params = new URLSearchParams({
    'payment_method_types[]': 'card',
    'line_items[0][price_data][currency]': currency,
    'line_items[0][price_data][unit_amount]': String(amount),
    'line_items[0][price_data][product_data][name]': metadata['product_name'] ?? 'GubakeBot Donator',
    'line_items[0][quantity]': '1',
    mode: 'payment',
    success_url: cancelUrl,
    cancel_url: cancelUrl,
    ...Object.fromEntries(Object.entries(metadata).map(([k, v]) => [`metadata[${k}]`, v])),
  });

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });

  if (!res.ok) throw new Error(`Stripe error: ${await res.text()}`);
  const data = await res.json<{ url: string }>();
  return data.url;
}

export async function verifyStripeWebhook(
  body: string,
  signature: string,
  secret: string
): Promise<Record<string, unknown>> {
  const parts = signature.split(',').reduce<Record<string, string>>((acc, part) => {
    const [k, v] = part.split('=');
    acc[k] = v;
    return acc;
  }, {});

  const timestamp = parts['t'];
  const sigHash = parts['v1'];
  if (!timestamp || !sigHash) throw new Error('Invalid signature format');

  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
    throw new Error('Webhook timestamp too old');
  }

  const payload = `${timestamp}.${body}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  const expected = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  if (expected !== sigHash) throw new Error('Signature mismatch');
  return JSON.parse(body);
}
