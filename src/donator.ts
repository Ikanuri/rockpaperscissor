export type DonatorTier = 'free' | 'basic' | 'premium';

export interface DonatorRecord {
  tier: Exclude<DonatorTier, 'free'>;
  expiry: number;
  method: 'stars' | 'stripe';
}

export const TIER_PERKS = {
  basic: {
    label: '🥉 Basic',
    maxGames: 5,
    waitingTtl: 1200,
    badge: '✨',
    features: ['Custom emoji (plain text)', 'GIF & sticker thumbnail', 'Donator badge ✨', 'Max 5 active games'],
  },
  premium: {
    label: '🥇 Premium',
    maxGames: 10,
    waitingTtl: 1800,
    badge: '💎',
    features: ['Everything in Basic', 'Animated emoji (custom_emoji_id)', 'Custom game code', 'Max 10 active games'],
  },
} as const;

export const TIER_DAYS: Record<Exclude<DonatorTier, 'free'>, number> = {
  basic: 30,
  premium: 30,
};

export async function loadDonatorTier(kv: KVNamespace, userId: number): Promise<DonatorTier> {
  const d = await kv.get<DonatorRecord>(`donator:${userId}`, 'json');
  if (!d || Date.now() > d.expiry) return 'free';
  return d.tier;
}

export async function activateTier(
  kv: KVNamespace,
  userId: number,
  tier: Exclude<DonatorTier, 'free'>,
  method: 'stars' | 'stripe',
  durationMs?: number
): Promise<void> {
  const existing = await kv.get<DonatorRecord>(`donator:${userId}`, 'json');
  const baseTime = existing && Date.now() < existing.expiry ? existing.expiry : Date.now();
  const actualMs = durationMs ?? TIER_DAYS[tier] * 24 * 3600 * 1000;
  const record: DonatorRecord = {
    tier,
    expiry: baseTime + actualMs,
    method,
  };
  await kv.put(`donator:${userId}`, JSON.stringify(record));
}

export function parseDuration(s: string): number | null {
  const lower = s.toLowerCase();
  if (lower.endsWith('m')) {
    const n = parseInt(lower);
    return isNaN(n) || n <= 0 ? null : n * 60 * 1000;
  }
  if (lower.endsWith('d')) {
    const n = parseInt(lower);
    return isNaN(n) || n <= 0 ? null : n * 24 * 3600 * 1000;
  }
  const n = parseInt(lower);
  return isNaN(n) || n <= 0 ? null : n * 24 * 3600 * 1000;
}

export function tierBadge(tier: DonatorTier): string {
  if (tier === 'premium') return ' 💎';
  if (tier === 'basic') return ' ✨';
  return '';
}
