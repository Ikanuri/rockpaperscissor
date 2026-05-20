import type { DonatorRecord, DonatorTier } from './types';

export const TIER_PERKS: Record<DonatorTier, string> = {
  free: 'Standard gameplay, max 3 active games',
  basic: 'Custom emoji (plain), GIF & sticker thumbnails, donator badge ✨, max 5 active games',
  premium: 'Animated custom emoji, custom game code, custom waiting text, max 10 active games',
};

export const TIER_DAYS: Record<Exclude<DonatorTier, 'free'>, number> = {
  basic: 30,
  premium: 30,
};

export async function loadDonatorTier(
  kv: KVNamespace,
  userId: number
): Promise<DonatorTier> {
  const d = await kv.get<DonatorRecord>(`donator:${userId}`, 'json');
  if (!d || Date.now() > d.expiry) return 'free';
  return d.tier;
}

export async function activateTier(
  kv: KVNamespace,
  userId: number,
  tier: Exclude<DonatorTier, 'free'>,
  method: DonatorRecord['method']
): Promise<void> {
  const days = TIER_DAYS[tier];
  const expiry = Date.now() + days * 24 * 60 * 60 * 1000;
  await kv.put(`donator:${userId}`, JSON.stringify({ tier, expiry, method } satisfies DonatorRecord));
}

export function tierBadge(tier: DonatorTier): string {
  if (tier === 'premium') return ' 💎';
  if (tier === 'basic') return ' ✨';
  return '';
}
