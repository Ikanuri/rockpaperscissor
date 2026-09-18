import type { Choice, Env, GameConfig, ThumbConfig } from './types';


const CHOICES: Choice[] = ['rock', 'paper', 'scissors'];

const DEFAULTS: GameConfig = {
  reveal: { rock: '✊', paper: '✋', scissors: '✌️' },
  sticker: {},
  thumb: {},
};

function overlayEnv(config: GameConfig, env: Env): void {
  const envAny = env as unknown as Record<string, string>;
  for (const c of CHOICES) {
    const stickerId = envAny[`STICKER_${c.toUpperCase()}`];
    if (stickerId) config.sticker[c] = stickerId;
    const emojiId = envAny[`CUSTOM_EMOJI_${c.toUpperCase()}`];
    if (emojiId) config.reveal[c] = emojiId;
  }
}

function overlayPatch(target: GameConfig, patch: Partial<GameConfig>): void {
  if (patch.reveal) {
    if (!target.reveal) target.reveal = { ...DEFAULTS.reveal };
    Object.assign(target.reveal, patch.reveal);
  }
  if (patch.sticker) {
    if (!target.sticker) target.sticker = {};
    Object.assign(target.sticker, patch.sticker);
  }
  if (patch.thumb) {
    if (!target.thumb) target.thumb = {};
    Object.assign(target.thumb, patch.thumb);
  }
}

export async function loadConfig(kv: KVNamespace, hostUserId: number, env: Env): Promise<GameConfig> {
  const config: GameConfig = {
    reveal: { ...DEFAULTS.reveal },
    sticker: {},
    thumb: {},
  };
  overlayEnv(config, env);

  const [global, user] = await Promise.all([
    kv.get<Partial<GameConfig>>('config:global', 'json'),
    kv.get<Partial<GameConfig>>(`config:user:${hostUserId}`, 'json'),
  ]);
  if (global) overlayPatch(config, global);
  if (user) overlayPatch(config, user);
  return config;
}

export async function setUserConfig(kv: KVNamespace, userId: number, patch: Partial<GameConfig>): Promise<void> {
  const existing = (await kv.get<Partial<GameConfig>>(`config:user:${userId}`, 'json')) ?? {};
  overlayPatch(existing as GameConfig, patch);
  await kv.put(`config:user:${userId}`, JSON.stringify(existing));
}

export async function setGlobalConfig(kv: KVNamespace, patch: Partial<GameConfig>): Promise<void> {
  const existing = (await kv.get<Partial<GameConfig>>('config:global', 'json')) ?? {};
  overlayPatch(existing as GameConfig, patch);
  await kv.put('config:global', JSON.stringify(existing));
}

export async function getUserConfigRaw(kv: KVNamespace, userId: number): Promise<Partial<GameConfig> | null> {
  return kv.get<Partial<GameConfig>>(`config:user:${userId}`, 'json');
}

export async function getGlobalConfigRaw(kv: KVNamespace): Promise<Partial<GameConfig> | null> {
  return kv.get<Partial<GameConfig>>('config:global', 'json');
}

export async function resetUserConfig(kv: KVNamespace, userId: number): Promise<void> {
  await kv.delete(`config:user:${userId}`);
}

export async function resetGlobalConfig(kv: KVNamespace): Promise<void> {
  await kv.delete('config:global');
}

export async function getResultFooter(kv: KVNamespace): Promise<string | null> {
  return kv.get('config:result_footer');
}

export async function setResultFooter(kv: KVNamespace, text: string): Promise<void> {
  await kv.put('config:result_footer', text);
}

export async function clearResultFooter(kv: KVNamespace): Promise<void> {
  await kv.delete('config:result_footer');
}

export type { ThumbConfig };
