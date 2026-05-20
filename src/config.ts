import type { Choice, Env, GameConfig, ThumbConfig } from './types';

const CHOICES: Choice[] = ['rock', 'paper', 'scissors'];

export const DEFAULTS: GameConfig = {
  countdown: { '1': '1️⃣', '2': '2️⃣', '3': '3️⃣' },
  reveal: { rock: '✊', paper: '✋', scissors: '✌️' },
  article: { rock: '✊ Rock', paper: '✋ Paper', scissors: '✌️ Scissors' },
  sticker: { rock: null, paper: null, scissors: null },
  thumb: { rock: null, paper: null, scissors: null },
};

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = target[key];
    if (
      sv !== null && typeof sv === 'object' && !Array.isArray(sv) &&
      tv !== null && typeof tv === 'object' && !Array.isArray(tv)
    ) {
      result[key] = deepMerge(
        tv as Record<string, unknown>,
        sv as Record<string, unknown>
      );
    } else {
      result[key] = sv;
    }
  }
  return result;
}

export async function loadConfig(
  kv: KVNamespace,
  hostUserId: number,
  env: Env
): Promise<GameConfig> {
  const [globalRaw, userRaw] = await Promise.all([
    kv.get('config:global'),
    kv.get(`config:user:${hostUserId}`),
  ]);

  const global = globalRaw ? JSON.parse(globalRaw) : {};
  const user = userRaw ? JSON.parse(userRaw) : {};

  // Legacy thumb URLs stored as plain strings (migrate on read)
  const legacyThumbs: Partial<Record<Choice, ThumbConfig | null>> = {};
  if (!global.thumb && !user.thumb) {
    const [r, p, s] = await Promise.all(CHOICES.map(c => kv.get(`config:thumb:${c}`)));
    const raw = { rock: r, paper: p, scissors: s };
    for (const c of CHOICES) {
      const v = raw[c as Choice];
      if (v) {
        try {
          legacyThumbs[c as Choice] = JSON.parse(v) as ThumbConfig;
        } catch {
          legacyThumbs[c as Choice] = { type: 'url', value: v };
        }
      }
    }
  }

  const merged = deepMerge(
    deepMerge(DEFAULTS as unknown as Record<string, unknown>, global),
    user
  ) as unknown as GameConfig;

  // Apply env var fallbacks for reveal emoji (custom emoji IDs)
  const envAny = env as unknown as Record<string, string>;
  for (const c of CHOICES) {
    const envId = envAny[`CUSTOM_EMOJI_${c.toUpperCase()}`];
    if (envId && merged.reveal[c] === DEFAULTS.reveal[c]) {
      merged.reveal[c] = envId;
    }
  }

  // Apply env var fallbacks for stickers
  for (const c of CHOICES) {
    const envId = envAny[`STICKER_${c.toUpperCase()}`];
    if (envId && !merged.sticker[c]) {
      merged.sticker[c] = envId;
    }
  }

  // Apply legacy thumb fallback
  if (Object.keys(legacyThumbs).length > 0) {
    for (const c of CHOICES) {
      if (!merged.thumb[c] && legacyThumbs[c as Choice]) {
        merged.thumb[c] = legacyThumbs[c as Choice]!;
      }
    }
  }

  return merged;
}

export async function setUserConfig(
  kv: KVNamespace,
  userId: number,
  patch: Record<string, unknown>
): Promise<void> {
  const raw = await kv.get(`config:user:${userId}`);
  const current = raw ? JSON.parse(raw) : {};
  await kv.put(`config:user:${userId}`, JSON.stringify(deepMerge(current, patch)));
}

export async function setGlobalConfig(
  kv: KVNamespace,
  patch: Record<string, unknown>
): Promise<void> {
  const raw = await kv.get('config:global');
  const current = raw ? JSON.parse(raw) : {};
  await kv.put('config:global', JSON.stringify(deepMerge(current, patch)));
}

export async function getUserConfigRaw(
  kv: KVNamespace,
  userId: number
): Promise<Record<string, unknown>> {
  const raw = await kv.get(`config:user:${userId}`);
  return raw ? JSON.parse(raw) : {};
}

export async function getGlobalConfigRaw(
  kv: KVNamespace
): Promise<Record<string, unknown>> {
  const raw = await kv.get('config:global');
  return raw ? JSON.parse(raw) : {};
}
