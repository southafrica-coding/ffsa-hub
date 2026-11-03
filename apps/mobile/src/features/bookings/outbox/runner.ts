// Sends the vehicle-check outbox, one item at a time, on the shared outbox
// engine (src/lib/outbox/engine.ts: storage, retry and safety rules). All
// I/O is injected (live.ts wires the real network, disk and session), so
// the send/retry/give-up flow is tested with fakes.
//
// Repeat safety: the form is safe to repeat (the route answers a second
// form for the same check with 409 "already recorded", which counts as
// sent). A photo is NOT: the route stores every upload under a new path. So
// a photo whose last try may have arrived (timeout, dropped connection,
// server error, app killed mid-send) is looked for on the booking first and
// only re-sent if it isn't there.

import { OutboxEngine, PermanentError, type EngineDeps } from "@/lib/outbox/engine";
import type { QueueStorage as Storage } from "@/lib/outbox/file-store";
import type { BaseItem } from "@/lib/outbox/queue";

import { discard as discardItems, isQueueItem, runnable, sameQueueItem, type FormItem, type PhotoItem, type QueueItem } from "./state";

export { PermanentError };

export type QueueStorage = Storage<QueueItem>;

export type QueueDeps = EngineDeps<QueueItem> & {
  uploadPhoto(item: PhotoItem): Promise<unknown>;
  sendForm(item: FormItem): Promise<unknown>;
  /** True when a failed form send means "already on FFSA Hub" (a retry after a lost answer). */
  isAlreadyRecorded(err: unknown): boolean;
  /**
   * Is this photo already on the booking (an earlier try got there)? Throw
   * if that can't be checked right now. Left out: photos are re-sent as
   * before.
   */
  wasReceived?(item: PhotoItem): Promise<boolean>;
};

export class BookingsOutbox extends OutboxEngine<QueueItem> {
  constructor(private deps: QueueDeps) {
    super(deps);
  }

  protected isItem(v: BaseItem) {
    return isQueueItem(v);
  }

  protected pick(candidates: QueueItem[], ctx: { now: number; userId: string; online: boolean }) {
    return runnable(candidates, ctx)[0];
  }

  protected files(item: QueueItem) {
    return item.kind === "photo" ? [item.localUri] : [];
  }

  protected removeFrom(items: QueueItem[], id: string) {
    return discardItems(items, id);
  }

  protected sameAs(a: QueueItem, b: QueueItem) {
    return sameQueueItem(a, b);
  }

  protected alreadyThere(item: QueueItem, err: unknown) {
    return item.kind === "form" && this.deps.isAlreadyRecorded(err);
  }

  protected async send(item: QueueItem) {
    if (item.kind === "form") {
      await this.deps.sendForm(item);
      return;
    }
    if (!this.deps.storage.fileExists(item.localUri)) {
      throw new PermanentError("This photo is no longer on the phone. Remove it and take the photo again.");
    }
    if (item.maybeSent && this.deps.wasReceived && (await this.deps.wasReceived(item))) return;
    await this.deps.uploadPhoto(item);
  }
}
