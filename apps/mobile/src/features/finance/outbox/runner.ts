// Sends the finance outbox, one item at a time. The send loop, storage and
// retry rules are the shared outbox engine (src/lib/outbox/engine.ts); this
// says what finance sends and in which order. All I/O is injected (see
// live.ts for the real wiring), so the whole flow is unit-tested with fakes.
//
// Both calls are safe to repeat, so a retry after a lost answer never
// creates a second record: the expense carries the id chosen on the phone
// (the API answers a repeat with the existing row), and a receipt's storage
// path is fixed when it's queued (upload is upsert; the API answers a repeat
// registration with the existing row).

import { OutboxEngine, PermanentError, type EngineDeps } from "@/lib/outbox/engine";
import type { QueueStorage } from "@/lib/outbox/file-store";
import type { BaseItem } from "@/lib/outbox/queue";

import type { ExpensePayload } from "../expense-form";

import { discard as discardItems, isOutboxItem, markFileUploaded, runnable, sameOutboxItem, type OutboxItem } from "./state";

export { PermanentError };

export type OutboxStorage = QueueStorage<OutboxItem>;

export type OutboxDeps = EngineDeps<OutboxItem> & {
  createExpense(id: string, payload: ExpensePayload): Promise<unknown>;
  registerReceipt(r: { expense_id: string; file_path: string; file_name: string; file_size: number; mime_type: string }): Promise<unknown>;
  uploadFile(filePath: string, localUri: string, mimeType: string): Promise<void>;
};

export class Outbox extends OutboxEngine<OutboxItem> {
  constructor(private deps: OutboxDeps) {
    super(deps);
  }

  protected isItem(v: BaseItem) {
    return isOutboxItem(v);
  }

  protected pick(candidates: OutboxItem[], ctx: { now: number; userId: string; online: boolean }) {
    return runnable(this.items, ctx).find((i) => candidates.includes(i));
  }

  protected files(item: OutboxItem) {
    return item.kind === "receipt" ? [item.localUri] : [];
  }

  protected removeFrom(items: OutboxItem[], id: string) {
    return discardItems(items, id);
  }

  protected sameAs(a: OutboxItem, b: OutboxItem) {
    return sameOutboxItem(a, b);
  }

  protected async send(item: OutboxItem) {
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
}
