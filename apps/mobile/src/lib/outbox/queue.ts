// The state machine every outbox shares (finance receipts + expenses,
// vehicle-check photos + forms). Pure: no I/O, no clock, no randomness of
// its own, so every transition is unit-tested.
//
//   waiting ──run──▶ sending ──ok / "already there"──▶ (removed: it's on the server)
//      ▲                │
//      │   transient    │ offline, timeout, 408/429/5xx: back to waiting after a
//      └── (backoff) ◀──┤ jittered, growing delay (or the server's Retry-After);
//                       │ after MAX_ATTEMPTS it needs the person
//                       │
//                       └─ permanent (403, other 4xx) ─▶ failed ── Retry ─▶ waiting
//                                                          └── Remove (person only)
//
// Nothing is ever dropped without the person choosing "Remove". An item
// that is "sending" can't be retried or removed until its answer is in, so
// one tap can never put the same thing on the wire twice.

import { MAX_ATTEMPTS, MAX_RETRY_AFTER_MS, MIN_WAKE_GAP_MS, retryDelayMs } from "./backoff";

export type ItemStatus = "waiting" | "sending" | "failed";

export type BaseItem = {
  /** Chosen on the phone when the item is queued, and reused on every retry. */
  id: string;
  kind: string;
  /** Whose item this is: it only sends while the same person is signed in. */
  userId: string;
  status: ItemStatus;
  attempts: number;
  /** Epoch ms before which an automatic retry won't run. */
  nextAttemptAt: number;
  lastError: string | null;
  createdAt: number;
  /** When the last send started (epoch ms), for "Last tried 14:05". Added in store v2. */
  lastTriedAt?: number | null;
  /** The server asked us to wait until then (Retry-After); reconnecting doesn't skip it. */
  holdUntil?: number | null;
  /**
   * A try may have reached the server without us hearing back (timeout,
   * dropped connection, app killed mid-send). Queues whose call is not
   * idempotent check before sending again.
   */
  maybeSent?: boolean;
};

export type Failure = {
  permanent: boolean;
  message: string;
  /** Server's Retry-After, in ms. */
  retryAfterMs?: number | null;
  /** The request may have reached the server (timeout, dropped connection, 5xx). */
  ambiguous?: boolean;
};

export { MAX_ATTEMPTS };

/** Fill in fields older stored items don't have. */
export function withDefaults<T extends BaseItem>(item: T): T {
  return { ...item, lastTriedAt: item.lastTriedAt ?? null, holdUntil: item.holdUntil ?? null, maybeSent: item.maybeSent ?? false };
}

/**
 * Add items. The same id again replaces the old copy (unless that one is
 * mid-send); an item `sameAs` one already waiting is a double tap and is
 * ignored.
 */
export function enqueueUnique<T extends BaseItem>(items: T[], added: T[], sameAs?: (a: T, b: T) => boolean): T[] {
  let out = items;
  for (const a of added) {
    const existing = out.find((i) => i.id === a.id);
    if (existing?.status === "sending") continue;
    if (!existing && sameAs && out.some((i) => i.userId === a.userId && sameAs(i, a))) continue;
    out = [...out.filter((i) => i.id !== a.id), a];
  }
  return out;
}

/**
 * After a restart nothing is mid-send: anything left "sending" goes back to
 * waiting, flagged as maybe-sent (the request may have arrived before the
 * app was killed).
 */
export function recoverItems<T extends BaseItem>(items: T[]): T[] {
  return items.map((i) => (i.status === "sending" ? { ...i, status: "waiting" as const, maybeSent: true } : i));
}

/** When the next automatic retry is due, or null if nothing is waiting on a timer. */
export function nextWakeAtFor<T extends BaseItem>(items: T[], userId: string | null): number | null {
  const times = items.filter((i) => i.userId === userId && i.status === "waiting").map((i) => i.nextAttemptAt);
  return times.length ? Math.min(...times) : null;
}

function patch<T extends BaseItem>(items: T[], id: string, fn: (i: T) => T): T[] {
  return items.map((i) => (i.id === id ? fn(i) : i));
}

export function markSendingItem<T extends BaseItem>(items: T[], id: string, now?: number): T[] {
  return patch(items, id, (i) => ({ ...i, status: "sending", lastTriedAt: now ?? i.lastTriedAt ?? null }));
}

/** On the server: out of the queue. */
export function markDoneItem<T extends BaseItem>(items: T[], id: string): T[] {
  return items.filter((i) => i.id !== id);
}

/**
 * A send failed. Transient: wait (jittered backoff, at least the server's
 * Retry-After) and try again, until MAX_ATTEMPTS. Permanent: needs the
 * person. `random` in [0,1) jitters the delay; 1 = none.
 */
export function markFailedItem<T extends BaseItem>(items: T[], id: string, failure: Failure, now: number, random = 1): T[] {
  return patch(items, id, (i) => {
    const attempts = i.attempts + 1;
    const giveUp = failure.permanent || attempts >= MAX_ATTEMPTS;
    const hold = failure.retryAfterMs == null ? null : now + Math.min(MAX_RETRY_AFTER_MS, failure.retryAfterMs);
    return {
      ...i,
      attempts,
      lastError: failure.message,
      status: giveUp ? "failed" : "waiting",
      nextAttemptAt: giveUp ? i.nextAttemptAt : now + retryDelayMs(attempts, { retryAfterMs: failure.retryAfterMs, random }),
      holdUntil: hold,
      // Sticky: once a try may have arrived, only the server can say otherwise.
      maybeSent: (i.maybeSent ?? false) || failure.ambiguous === true,
    };
  });
}

/** The person tapped Retry: try now. Ignored while the item is mid-send. */
export function retryItem<T extends BaseItem>(items: T[], id: string): T[] {
  return patch(items, id, (i) =>
    i.status === "sending" ? i : { ...i, status: "waiting", nextAttemptAt: 0, holdUntil: null, attempts: i.status === "failed" ? 0 : i.attempts },
  );
}

/**
 * Connectivity came back or the app came to the front: waiting items
 * needn't sit out their backoff, but a server's Retry-After still holds and
 * nothing is retried within MIN_WAKE_GAP_MS of its last try (a flapping
 * connection must not become a tight loop that burns through attempts).
 */
export function wakeItems<T extends BaseItem>(items: T[]): T[] {
  return items.map((i) => {
    if (i.status !== "waiting") return i;
    const earliest = Math.max(i.holdUntil ?? 0, i.lastTriedAt ? i.lastTriedAt + MIN_WAKE_GAP_MS : 0);
    return { ...i, nextAttemptAt: Math.min(i.nextAttemptAt, earliest) };
  });
}

export function isMidSend(items: BaseItem[], id: string): boolean {
  return items.some((i) => i.id === id && i.status === "sending");
}
