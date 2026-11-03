// The send loop every outbox shares. Sends one item at a time, writes the
// on-disk copy after every change, and never sends anything for a person
// other than the one signed in. All I/O is injected, so kill-mid-send,
// restart, offline → online, Retry-After, "already there", corrupted
// storage and user switches are all unit-tested with fakes.
//
// A queue (finance, bookings) subclasses this and says what to send and in
// which order; the retry, storage and safety rules live here once.

import { parseStore, type StoreProblem } from "./persist";
import {
  enqueueUnique,
  isMidSend,
  markDoneItem,
  markFailedItem,
  markSendingItem,
  nextWakeAtFor,
  recoverItems,
  retryItem,
  wakeItems,
  type BaseItem,
  type Failure,
} from "./queue";
import type { QueueStorage } from "./file-store";

export type EngineDeps<T extends BaseItem> = {
  storage: QueueStorage<T>;
  classify(err: unknown): Failure;
  getUserId(): Promise<string | null>;
  isOnline(): Promise<boolean>;
  now(): number;
  /** [0,1) for backoff jitter; none when left out (tests stay exact). */
  random?(): number;
};

/** Draft photos nobody queued are removed after a day (never queued ones). */
const ORPHAN_AGE_MS = 24 * 60 * 60_000;

/** A failure retrying can't fix (classifiers see `permanent`). */
export class PermanentError extends Error {
  name = "PermanentError";
  readonly permanent = true;
}

export abstract class OutboxEngine<T extends BaseItem> {
  protected items: T[] = [];
  private listeners = new Set<() => void>();
  private ready: Promise<void> | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  private problem: StoreProblem = null;

  constructor(protected base: EngineDeps<T>) {}

  // ── What each queue decides ───────────────────────────────────────────────

  /** This queue's own fields are present and sane (base fields are checked already). */
  protected abstract isItem(v: BaseItem): boolean;
  /** The next item to send, if any may go now. */
  protected abstract pick(items: T[], ctx: { now: number; userId: string; online: boolean }): T | undefined;
  /** Send it. Throw on failure. */
  protected abstract send(item: T): Promise<void>;
  /** Local files the item owns (deleted once it's on the server or removed). */
  protected abstract files(item: T): string[];
  /** The person chose Remove: which items go (and so which files). */
  protected removeFrom(items: T[], id: string): { items: T[]; removed: T[] } {
    return { items: items.filter((i) => i.id !== id), removed: items.filter((i) => i.id === id) };
  }
  /** Double-tap guard: is `b` the same thing as `a`, already queued? */
  protected sameAs(_a: T, _b: T): boolean {
    return false;
  }
  /** Does this error mean "it's already on the server" (a retry after a lost answer)? */
  protected alreadyThere(_item: T, _err: unknown): boolean {
    return false;
  }

  // ── Public API (stable: screens use these) ────────────────────────────────

  /**
   * Load from disk once. Anything left mid-send by a crash goes back to
   * waiting. A file that can't be read is set aside, never wiped.
   */
  init(): Promise<void> {
    this.ready ??= (async () => {
      let raw: unknown = null;
      try {
        raw = await this.base.storage.read();
        const parsed = parseStore<T>(raw, (v) => this.isItem(v));
        this.items = recoverItems(parsed.items);
        this.problem = parsed.problem;
      } catch {
        this.items = [];
        this.problem = "corrupt";
      }
      if (this.problem) {
        try {
          await this.base.storage.quarantine?.(raw);
        } catch {
          // The copy is best-effort; the message still shows.
        }
      }
      this.sweepOrphans();
      this.emit();
    })();
    return this.ready;
  }

  getItems = (): T[] => this.items;

  /** Set when the saved queue couldn't be fully read on start (a copy was kept). */
  getProblem = (): StoreProblem => this.problem;

  dismissProblem(): void {
    this.problem = null;
    this.items = [...this.items];
    this.emit();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  async add(...added: T[]): Promise<void> {
    await this.init();
    await this.set(enqueueUnique(this.items, added, (a, b) => this.sameAs(a, b)));
  }

  async retry(id: string): Promise<void> {
    await this.init();
    await this.set(retryItem(this.items, id));
    void this.process();
  }

  /**
   * The person chose Remove: delete the item (and its photo files). Refused
   * while it is mid-send; returns whether anything was removed.
   */
  async discard(id: string, opts: { keepFiles?: boolean } = {}): Promise<boolean> {
    await this.init();
    if (isMidSend(this.items, id)) return false;
    const { items, removed } = this.removeFrom(this.items, id);
    if (removed.length === 0) return false;
    await this.set(items);
    if (!opts.keepFiles) for (const r of removed) for (const f of this.files(r)) this.safeDelete(f);
    return true;
  }

  /** Connectivity is back or the app came to the front: try what's due. */
  async wake(): Promise<void> {
    await this.init();
    await this.set(wakeItems(this.items));
    await this.process();
  }

  async nextWake(): Promise<number | null> {
    return nextWakeAtFor(this.items, await this.base.getUserId());
  }

  /** Send everything that can go now. Concurrent calls share one run. */
  process(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      await this.init();
      do {
        this.again = false;
        await this.drain();
      } while (this.again);
    })()
      // A failed disk write mid-run must not become an unhandled rejection;
      // the in-memory queue is intact and the next change writes it again.
      .catch(() => undefined)
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  protected emit() {
    for (const fn of this.listeners) fn();
  }

  protected async set(next: T[]) {
    this.items = next;
    this.emit();
    // Written after every change: an item is on disk before anything tries to send it.
    await this.base.storage.write(next);
  }

  private async drain() {
    for (;;) {
      const [userId, online] = await Promise.all([this.base.getUserId(), this.base.isOnline()]);
      // Never as someone else, never signed out.
      if (!userId || !online) return;
      const now = this.base.now();
      const next = this.pick(
        this.items.filter((i) => i.userId === userId && i.status === "waiting" && i.nextAttemptAt <= now),
        { now, userId, online },
      );
      if (!next) return;
      await this.set(markSendingItem(this.items, next.id, now));
      try {
        await this.send(next);
        await this.sent(next);
      } catch (err) {
        if (this.alreadyThere(next, err)) {
          // The first try got there but its answer was lost.
          await this.sent(next);
          continue;
        }
        const random = this.base.random?.() ?? 1;
        await this.set(markFailedItem(this.items, next.id, this.base.classify(err), this.base.now(), random));
      }
    }
  }

  private async sent(item: T) {
    await this.set(markDoneItem(this.items, item.id));
    for (const f of this.files(item)) this.safeDelete(f);
  }

  protected safeDelete(uri: string) {
    try {
      this.base.storage.deleteFile(uri);
    } catch {
      // A leftover file costs disk space, not data.
    }
  }

  private sweepOrphans() {
    try {
      const keep = new Set(this.items.flatMap((i) => this.files(i)));
      const cutoff = this.base.now() - ORPHAN_AGE_MS;
      for (const f of this.base.storage.listFiles()) {
        if (!keep.has(f.uri) && f.modifiedAt < cutoff) this.safeDelete(f.uri);
      }
    } catch {
      // Tidying is best-effort.
    }
  }
}
