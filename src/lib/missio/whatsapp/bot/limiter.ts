// ────────────────────────────────────────────────────────────
// Missio WhatsApp menu — send limiter and per-thread order
// ────────────────────────────────────────────────────────────
// Server only, in-process. The bot's sends use their own limiter, never
// the pastors' 20-a-minute composer bucket (missioRateLimit "whatsapp-send").

export type Limiter = { run<T>(fn: () => Promise<T>): Promise<T>; readonly active: number; readonly waiting: number };

/** At most `max` Graph sends at once on this server; the rest wait their turn. */
export function createLimiter(max: number): Limiter {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    if (active >= max) return;
    const start = queue.shift();
    if (start) start();
  };
  return {
    get active() {
      return active;
    },
    get waiting() {
      return queue.length;
    },
    run<T>(fn: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        queue.push(() => {
          active += 1;
          fn()
            .then(resolve, reject)
            .finally(() => {
              active -= 1;
              next();
            });
        });
        next();
      });
    },
  };
}

/**
 * Runs work for one thread strictly in the order it was queued, while
 * different threads run side by side. In-process only: across servers the
 * engine's turn claim and "newer message already answered" check keep the
 * order safe.
 */
export function createThreadQueue() {
  const tails = new Map<string, Promise<unknown>>();
  return {
    run<T>(threadId: string, fn: () => Promise<T>): Promise<T> {
      const previous = tails.get(threadId) ?? Promise.resolve();
      const result = previous.then(fn, fn);
      const tail = result.catch(() => undefined);
      tails.set(threadId, tail);
      void tail.then(() => {
        if (tails.get(threadId) === tail) tails.delete(threadId);
      });
      return result;
    },
    get size() {
      return tails.size;
    },
  };
}
