// DEBUG SEMENTARA — seluruh file ini (dan semua pemanggilnya yang bertanda "DEBUG SEMENTARA")
// dihapus setelah investigasi selesai. Merekam data nyata ke DEBUG_KV (TTL 1 jam) agar bisa
// dibaca lewat GET /debug/<nama> yang dijaga DEBUG_SECRET. Aktif hanya jika binding DEBUG_KV ada.
import type { Env } from './types';

let kv: KVNamespace | null = null;

export function enableDebug(env: Env): void {
  kv = env.DEBUG_KV ?? null;
}

export function debugOn(): boolean {
  return kv !== null;
}

// Bot token (123456:AA...) dan header Authorization tidak boleh pernah tersimpan.
function redact(s: string): string {
  return s
    .replace(/\d{6,}:[A-Za-z0-9_-]{30,}/g, '[REDACTED]')
    .replace(/"?authorization"?\s*[:=]\s*"?[^",}\s]+/gi, 'authorization:[REDACTED]');
}

export async function dbg(name: string, data: Record<string, unknown>): Promise<void> {
  if (!kv) return;
  try {
    const key = `debug:${name}:${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await kv.put(key, redact(JSON.stringify({ t: new Date().toISOString(), ...data })), { expirationTtl: 3600 });
  } catch { /* debug tidak boleh merusak request */ }
}

function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

export async function handleDebugRequest(request: Request, env: Env): Promise<Response> {
  const notFound = () => new Response('Not Found', { status: 404 });
  const url = new URL(request.url);
  const given = request.headers.get('X-Debug-Token') ?? url.searchParams.get('token') ?? '';
  if (!env.DEBUG_SECRET || !env.DEBUG_KV || !safeEqual(given, env.DEBUG_SECRET)) return notFound();

  const name = decodeURIComponent(url.pathname.slice('/debug/'.length));
  if (!/^[a-z0-9_-]{1,40}$/i.test(name)) return notFound();

  const store = env.DEBUG_KV;
  const list = await store.list({ prefix: `debug:${name}:`, limit: 100 });
  const items = await Promise.all(list.keys.map(async k => {
    const raw = await store.get(k.name);
    let value: unknown = raw;
    try { value = raw ? JSON.parse(raw) : null; } catch { /* biarkan string mentah */ }
    return { key: k.name, value };
  }));
  items.sort((x, y) => x.key.localeCompare(y.key));
  return new Response(JSON.stringify({ name, count: items.length, items }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
}
