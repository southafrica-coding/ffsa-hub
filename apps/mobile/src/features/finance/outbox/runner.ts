// Sends what's in the outbox, one item at a time, and keeps the on-disk copy
// in step after every change. All I/O is injected (see live.ts for the real
// wiring), so the whole send/retry/permanent-failure flow is unit-tested with
// fakes for the network, the file system and connectivity.

import type { ExpensePayload } from "../expense-form";

import {
  discard as discardItem,
  enqueue,
  markDone,
  markFailed,
  markFileUploaded,
  markSending,
  nextWakeAt,
  recover,
  referencedFiles,
  retry as retryItem,
  runnable,
  wakeAll,
  type Failure,
  type OutboxItem,
} from "./state";

export type OutboxStorage = {
  read(): Promise<OutboxItem[]>;
  write(items: OutboxItem[]): Promise<void>;
  deleteFile(uri: string): void;
  fileExists(uri: string): boolean;
  /** Photo files in the outbox folder, for tidying up abandoned drafts. */
  listFiles(): { uri: string; modifiedAt: number }[];
};

export type OutboxDeps = {
  storage: OutboxStorage;
  createExpense(id: string, payload: ExpensePayload): Promise<unknown>;
  registerReceipt(r: { expense_id: string; file_path: string; file_name: string; file_size: number; mime_type: string }): Promise<unknown>;
  uploadFile(filePath: string, localUri: string, mimeType: string): Promise<void>;
  classify(err: unknown): Failure;
  getUserId(): Promise<string | null>;
  isOnline(): Promise<boolean>;
  now(): number;
};

/** Draft photos nobody saved are removed after a day (never queued ones). */
const ORPHAN_AGE_MS = 24 * 60 * 60_000;

export class Outbox {
  private items: OutboxItem[] = [];
  private listeners = new Set<() => void>();
  private ready: Promise<void> | null = null;
  private running: Promise<void> | null = null;
  private again = false;

  constructor(private deps: OutboxDeps) {}

  /** Load from disk once; anything left mid-send by a crash goes back to waiting. */
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

  getItems = (): OutboxItem[] => this.items;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  private emit() {
    for (const fn of this.listeners) fn();
  }

  private async set(next: OutboxItem[]) {
    this.items = next;
    this.emit();
    // Written after every change: a photo is on disk in the queue before
    // anything tries to send it.
    await this.deps.storage.write(next);
  }

  async add(...added: OutboxItem[]): Promise<void> {
    await this.init();
    await this.set(enqueue(this.items, ...added));
  }

  async retry(id: string): Promise<void> {
    await this.init();
    await this.set(retryItem(this.items, id));
    void this.process();
  }

  /** The person chose Remove: delete the item (and its photo files). */
  async discard(id: string, opts: { keepFiles?: boolean } = {}): Promise<void> {
    await this.init();
    const { items, removed } = discardItem(this.items, id);
    await this.set(items);
    if (!opts.keepFiles) {
      for (const r of removed) if (r.kind === "receipt") this.safeDelete(r.localUri);
    }
  }

  /** Connectivity is back or the app came to the front: try everything now. */
  async wake(): Promise<void> {
    await this.init();
    await this.set(wakeAll(this.items));
    await this.process();
  }

  async nextWake(): Promise<number | null> {
    return nextWakeAt(this.items, await this.deps.getUserId());
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
        if (next.kind === "receipt") this.safeDelete(next.localUri);
      } catch (err) {
        await this.set(markFailed(this.items, next.id, this.deps.classify(err), this.deps.now()));
      }
    }
  }

  private async send(item: OutboxItem) {
    if (item.kind === "expense") {
      await this.deps.createExpense(item.id, item.payload);
      return;
    }
    if (!item.fileUploaded) {
      if (!this.deps.storage.fileExists(item.localUri)) {
        throw new PermanentError("This photo is no longer on the phone. Remove it and take the photo again.");
      }
      await this.deps.uploadFile(item.filePath, item.localUri, item.mimeType);
      await this.set(markFileUploaded(this.items, item.id));
    }
    await this.deps.registerReceipt({
      expense_id: item.expenseId,
      file_path: item.filePath,
      file_name: item.fileName,
      file_size: item.fileSize,
      mime_type: item.mimeType,
    });
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

/** A failure that retrying can't fix (the classifier sees `permanent`). */
export class PermanentError extends Error {
  name = "PermanentError";
  readonly permanent = true;
}
