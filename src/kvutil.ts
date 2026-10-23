// Atomic read-modify-write on a JSON document in KV.
//
// Cloudflare KV has no compare-and-swap, so there the best we can do is read right before the
// write (the "re-read" pattern used throughout). The Telegram Serverless adapter (src/platform/kv.ts)
// runs handlers truly concurrently on SQLite and offers a real `cas()`; when the namespace has one,
// it is used and the mutator is retried on conflict, so it must be pure (no side effects).
//
// `fn` gets the current value (null if absent) and returns `next` (omit to leave the key untouched)
// plus a `result` the caller uses to decide what to reply / which side effects to run afterwards.
// `ttl` may depend on the new value (e.g. shorter once a lobby is full).

type Ttl<T> = number | undefined | ((next: T) => number | undefined);

function ttlOf<T>(ttl: Ttl<T>, next: T): number | undefined {
  return typeof ttl === 'function' ? ttl(next) : ttl;
}

export async function mutateJson<T, R>(
  kv: KVNamespace,
  key: string,
  ttl: Ttl<T>,
  fn: (cur: T | null) => { next?: T; result: R }
): Promise<R> {
  const cas = (kv as unknown as { cas?: (...args: any[]) => Promise<unknown> }).cas;
  if (typeof cas === 'function') {
    let result!: R;
    await cas.call(
      kv,
      key,
      (cur: T | null) => {
        const r = fn(cur);
        result = r.result;
        return r.next;
      },
      (next: T) => {
        const t = ttlOf(ttl, next);
        return t ? { expirationTtl: t } : undefined;
      }
    );
    return result;
  }
  const cur = await kv.get<T>(key, 'json');
  const r = fn(cur);
  if (r.next !== undefined) {
    const t = ttlOf(ttl, r.next);
    await kv.put(key, JSON.stringify(r.next), t ? { expirationTtl: t } : undefined);
  }
  return r.result;
}

// Shared ID lists (donators:ids, beta:approved): add / remove without losing concurrent edits.
// Resolves to the resulting list and whether anything changed.
export async function editIdList(
  kv: KVNamespace,
  key: string,
  edit: (list: number[]) => number[]
): Promise<{ list: number[]; changed: boolean }> {
  return mutateJson<number[], { list: number[]; changed: boolean }>(kv, key, undefined, cur => {
    const before = cur ?? [];
    const after = edit([...before]);
    const changed = after.length !== before.length || after.some((id, i) => id !== before[i]);
    return changed ? { next: after, result: { list: after, changed } } : { result: { list: before, changed } };
  });
}
