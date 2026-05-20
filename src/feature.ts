import type { Env } from './types';

export function hasFeature(env: Env, flag: string): boolean {
  return env.FEATURE_FLAGS?.split(',').map(f => f.trim()).includes(flag) ?? false;
}

export async function isBetaUser(
  kv: KVNamespace,
  userId: number,
  ownerId: string
): Promise<boolean> {
  if (String(userId) === ownerId) return true;
  const list = await kv.get<number[]>('beta:approved', 'json') ?? [];
  return list.includes(userId);
}
