// Sends the vehicle-check outbox, one item at a time, writing the on-disk
// copy after every change. All I/O is injected (live.ts wires the real
// network, disk and session), so the send/retry/give-up flow is tested with
// fakes. Same shape as the finance outbox's runner.

import {
  discard as discardItem,
  enqueue,
  markDone,
  markFailed,
  markSending,
  nextWakeAt,
  recover,
  referencedFiles,
  retry as retryItem,
  runnable,
  wakeAll,
  type Failure,
  type FormItem,
  type PhotoItem,
  type QueueItem,
} from "./state";

export type QueueStorage = {
  read(): Promise<QueueItem[]>;
  write(items: QueueItem[]): Promise<void>;
  deleteFile(uri: string): void;
  fileExists(uri: string): boolean;
  listFiles(): { uri: string; modifiedAt: number }[];
};

export type QueueDeps = {
  storage: QueueStorage;
  uploadPhoto(item: PhotoItem): Promise<unknown>;
  sendForm(item: FormItem): Promise<unknown>;
  classify(err: unknown): Failure;
  /** True when a failed form send means "already on FFSA Hub" (a retry after a lost answer). */
  isAlreadyRecorded(err: unknown): boolean;
  getUserId(): Promise<string | null>;
  isOnline(): Promise<boolean>;
  now(): number;
};

const ORPHAN_AGE_MS = 24 * 60 * 60_000;

export class PermanentError extends Error {
  name = "PermanentError";
  readonly permanent = true;
}

export class BookingsOutbox {
  private items: QueueItem[] = [];
  private listeners = new Set<() => void>();
  private ready: Promise<void> | null = null;
  private running: Promise<void> | null = null;
  private again = false;

  constructor(private deps: QueueDeps) {}

  init(): Promise<void> {
    this.ready ??= (async () => {
      try {
        this.items = recover(await this.deps.storage.read());
      } catch {
        this.items = [];
      }
      this.sweepOrphans();
      this.emit();
    })();
    return this.ready;
  }

  getItems = (): QueueItem[] => this.items;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  private emit() {
    for (const fn of this.listeners) fn();
  }

  private async set(next: QueueItem[]) {
    this.items = next;
    this.emit();
    await this.deps.storage.write(next);
  }

  async add(...added: QueueItem[]): Promise<void> {
    await this.init();
    await this.set(enqueue(this.items, ...added));
  }

  async retry(id: string): Promise<void> {
    await this.init();
    await this.set(retryItem(this.items, id));
    void this.process();
  }

  async discard(id: string): Promise<void> {
    await this.init();
    const { items, removed } = discardItem(this.items, id);
    await this.set(items);
    for (const r of removed) if (r.kind === "photo") this.safeDelete(r.localUri);
  }

  async wake(): Promise<void> {
    await this.init();
    await this.set(wakeAll(this.items));
    await this.process();
  }

  async nextWake(): Promise<number | null> {
    return nextWakeAt(this.items, await this.deps.getUserId());
  }

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
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async drain() {
    for (;;) {
      const [userId, online] = await Promise.all([this.deps.getUserId(), this.deps.isOnline()]);
      const next = runnable(this.items, { now: this.deps.now(), userId, online })[0];
      if (!next) return;
      await this.set(markSending(this.items, next.id));
      try {
        await this.send(next);
        await this.set(markDone(this.items, next.id));
        if (next.kind === "photo") this.safeDelete(next.localUri);
      } catch (err) {
        if (next.kind === "form" && this.deps.isAlreadyRecorded(err)) {
          // The first try reached the server but its answer was lost.
          await this.set(markDone(this.items, next.id));
          continue;
        }
        await this.set(markFailed(this.items, next.id, this.deps.classify(err), this.deps.now()));
      }
    }
  }

  private async send(item: QueueItem) {
    if (item.kind === "form") {
      await this.deps.sendForm(item);
      return;
    }
    if (!this.deps.storage.fileExists(item.localUri)) {
      throw new PermanentError("This photo is no longer on the phone. Remove it and take the photo again.");
    }
    await this.deps.uploadPhoto(item);
  }

  private safeDelete(uri: string) {
    try {
      this.deps.storage.deleteFile(uri);
    } catch {
      // A leftover file costs disk space, not data.
    }
  }

  private sweepOrphans() {
    try {
      const keep = referencedFiles(this.items);
      const cutoff = this.deps.now() - ORPHAN_AGE_MS;
      for (const f of this.deps.storage.listFiles()) {
        if (!keep.has(f.uri) && f.modifiedAt < cutoff) this.safeDelete(f.uri);
      }
    } catch {
      // Tidying is best-effort.
    }
  }
}
