// When to try a failed send again. Pure, so every rule is unit-tested.
//
//   attempt 1 fails → ~2 s, 2 → ~4 s, 3 → ~8 s … capped at 5 minutes,
//   each delay "jittered" down by up to half so a room of phones that lost
//   signal together don't all hit the server in the same second.
//   A server that says Retry-After (429 / 503) is obeyed (up to an hour).
//   After MAX_ATTEMPTS the item stops retrying by itself and needs the person.

export const MAX_ATTEMPTS = 8;
export const BASE_DELAY_MS = 2_000;
export const MAX_DELAY_MS = 5 * 60_000;
/** A Retry-After longer than this is treated as this: the person can always tap Retry. */
export const MAX_RETRY_AFTER_MS = 60 * 60_000;
/** Reconnect / app-to-front never retries an item sooner than this after its last try. */
export const MIN_WAKE_GAP_MS = 5_000;

/** 2s, 4s, 8s … capped at 5 minutes (no jitter). */
export function backoffMs(attempts: number): number {
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1));
}

/**
 * "Equal jitter": somewhere between half and all of `ms`. `random` is in
 * [0, 1); 1 (the default) means no jitter, which keeps pure tests exact.
 */
export function jitter(ms: number, random = 1): number {
  const r = Math.min(1, Math.max(0, random));
  return Math.round(ms / 2 + (ms / 2) * r);
}

/**
 * A Retry-After header in ms from `now`: either whole seconds ("20") or an
 * HTTP date. Null when missing or unreadable; never negative; capped.
 */
export function parseRetryAfter(value: string | null | undefined, now: number): number | null {
  if (value == null) return null;
  const v = value.trim();
  if (!v) return null;
  let ms: number;
  if (/^\d+$/.test(v)) ms = Number(v) * 1000;
  else {
    const at = Date.parse(v);
    if (Number.isNaN(at)) return null;
    ms = at - now;
  }
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, ms));
}

/** The delay before the next automatic try after `attempts` failures. */
export function retryDelayMs(attempts: number, opts: { retryAfterMs?: number | null; random?: number } = {}): number {
  const base = jitter(backoffMs(attempts), opts.random);
  const server = opts.retryAfterMs == null ? 0 : Math.min(MAX_RETRY_AFTER_MS, opts.retryAfterMs);
  return Math.max(base, server);
}

/** HTTP statuses that are worth retrying by themselves. */
export function isRetryableStatus(status: number | undefined): boolean {
  if (status === undefined) return true;
  return status === 408 || status === 425 || status === 429 || status >= 500;
}
