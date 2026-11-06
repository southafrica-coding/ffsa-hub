/**
 * Short-lived cache for Xero reads (actuals). One page of bank
 * transactions is not fetched again for every budget opened in the same
 * few minutes, and two requests in flight share one read.
 */

const TTL_MS = 5 * 60 * 1000;

type Entry = { at: number; value: unknown };

const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

export function clearXeroReadCache(): void {
  store.clear();
  inflight.clear();
}

export async function cachedXeroRead<T extends { ok: boolean }>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;
  const promise = load()
    .then((value) => {
      inflight.delete(key);
      if (value.ok) store.set(key, { at: Date.now(), value });
      return value;
    })
    .catch((err: unknown) => {
      inflight.delete(key);
      throw err;
    });
  inflight.set(key, promise);
  return promise;
}
