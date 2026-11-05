// The finance outbox: expenses and receipt photos saved on this phone that
// haven't reached FFSA Hub yet. Pure state (no I/O), so every transition is
// unit-tested; runner.ts sends and store.ts keeps it on disk.
//
// The retry/backoff/give-up rules are the shared outbox core
// (src/lib/outbox/queue.ts, diagram there); this file adds what is special
// to finance. A receipt waits behind its expense while that expense is
// still in the outbox, so a photo is never registered against an expense
// the server doesn't have yet. Nothing is ever dropped without the person
// choosing "Remove".

import { backoffMs, MAX_ATTEMPTS } from "@/lib/outbox/backoff";
import {
  enqueueUnique,
  markDoneItem,
  markFailedItem,
  markSendingItem,
  nextWakeAtFor,
  recoverItems,
  retryItem,
  wakeItems,
  type BaseItem,
  type Failure,
  type ItemStatus,
} from "@/lib/outbox/queue";

import type { ExpensePayload } from "../expense-form";

export { backoffMs, MAX_ATTEMPTS, type Failure };

export type OutboxStatus = ItemStatus;

type Common = BaseItem & {
  /** Expense id (kind "expense") or a local id (kind "receipt"), chosen when queued. */
  id: string;
  teamId: string;
};

export type ExpenseItem = Common & {
  kind: "expense";
  /** Sent to POST /api/finance/outreach/expenses with `id`, so a retry is recognised. */
  payload: ExpensePayload;
};

export type ReceiptItem = Common & {
  kind: "receipt";
  expenseId: string;
  /** The compressed photo, in the app's documents folder. */
  localUri: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  /** Fixed when the photo is queued, so a retry overwrites the same object. */
  filePath: string;
  /** The file is in the bucket; only the API registration is left. */
  fileUploaded: boolean;
};

export type OutboxItem = ExpenseItem | ReceiptItem;

/** The web's path rule: `${teamId}/${expenseId}/${Date.now()}_${file.name}`. */
export function receiptPath(teamId: string, expenseId: string, fileName: string, now: number): string {
  return `${teamId}/${expenseId}/${now}_${fileName}`;
}

/** The same photo file queued twice (a double tap) is one receipt. */
export function sameOutboxItem(a: OutboxItem, b: OutboxItem): boolean {
  return a.kind === "receipt" && b.kind === "receipt" && a.localUri === b.localUri;
}

export function enqueue(items: OutboxItem[], ...added: OutboxItem[]): OutboxItem[] {
  return enqueueUnique(items, added, sameOutboxItem);
}

/** Stored-item shape check (on top of the shared base fields). */
export function isOutboxItem(v: BaseItem): boolean {
  const i = v as Partial<OutboxItem> & Record<string, unknown>;
  if (typeof i.teamId !== "string") return false;
  if (i.kind === "expense") return !!i.payload && typeof i.payload === "object";
  if (i.kind === "receipt") {
    return (
      typeof i.expenseId === "string" &&
      typeof i.localUri === "string" &&
      typeof i.fileName === "string" &&
      typeof i.mimeType === "string" &&
      typeof i.filePath === "string" &&
      typeof i.fileSize === "number" &&
      typeof i.fileUploaded === "boolean"
    );
  }
  return false;
}

/** After a restart nothing is mid-send: anything left "sending" goes back to waiting. */
export const recover = (items: OutboxItem[]): OutboxItem[] => recoverItems(items);

/**
 * What may be sent now, in order: this person's expenses first, then
 * receipts whose expense is no longer waiting in the outbox.
 */
export function runnable(items: OutboxItem[], opts: { now: number; userId: string | null; online: boolean }): OutboxItem[] {
  if (!opts.online || !opts.userId) return [];
  const mine = items.filter((i) => i.userId === opts.userId && i.status === "waiting" && i.nextAttemptAt <= opts.now);
  const pendingExpenses = new Set(items.filter((i) => i.kind === "expense").map((i) => i.id));
  const expenses = mine.filter((i) => i.kind === "expense");
  const receipts = mine.filter((i): i is ReceiptItem => i.kind === "receipt" && !pendingExpenses.has(i.expenseId));
  const byAge = (a: OutboxItem, b: OutboxItem) => a.createdAt - b.createdAt;
  return [...expenses.sort(byAge), ...receipts.sort(byAge)];
}

/** When the next automatic retry is due, or null if nothing is waiting on a timer. */
export const nextWakeAt = (items: OutboxItem[], userId: string | null): number | null => nextWakeAtFor(items, userId);

export const markSending = (items: OutboxItem[], id: string, now?: number): OutboxItem[] => markSendingItem(items, id, now);

export function markFileUploaded(items: OutboxItem[], id: string): OutboxItem[] {
  return items.map((i) => (i.id === id && i.kind === "receipt" ? { ...i, fileUploaded: true } : i));
}

/** On the server: out of the outbox. */
export const markDone = (items: OutboxItem[], id: string): OutboxItem[] => markDoneItem(items, id);

export const markFailed = (items: OutboxItem[], id: string, failure: Failure, now: number, random?: number): OutboxItem[] =>
  markFailedItem(items, id, failure, now, random);

/** The person tapped Retry: try now (ignored while it's mid-send). */
export const retry = (items: OutboxItem[], id: string): OutboxItem[] => retryItem(items, id);

/** Connectivity came back or the app was opened: waiting items needn't sit out their backoff. */
export const wakeAll = (items: OutboxItem[]): OutboxItem[] => wakeItems(items);

/**
 * The person chose Remove. An expense takes its own waiting receipts with
 * it (they could never be registered). Returns what was removed so the
 * caller can delete the photo files. Nothing is removed mid-send.
 */
export function discard(items: OutboxItem[], id: string): { items: OutboxItem[]; removed: OutboxItem[] } {
  const target = items.find((i) => i.id === id);
  if (!target || target.status === "sending") return { items, removed: [] };
  const goes = (i: OutboxItem) => i.id === id || (target.kind === "expense" && i.kind === "receipt" && i.expenseId === id);
  return { items: items.filter((i) => !goes(i)), removed: items.filter(goes) };
}

// ── What the screens show ───────────────────────────────────────────────────

export function forTeam(items: OutboxItem[], teamId: string, userId: string | null) {
  const mine = items.filter((i) => i.teamId === teamId && i.userId === userId);
  return {
    expenses: mine.filter((i): i is ExpenseItem => i.kind === "expense"),
    receipts: mine.filter((i): i is ReceiptItem => i.kind === "receipt"),
  };
}

export function receiptsFor(items: OutboxItem[], expenseId: string, userId: string | null): ReceiptItem[] {
  return items.filter((i): i is ReceiptItem => i.kind === "receipt" && i.expenseId === expenseId && i.userId === userId);
}

export function referencedFiles(items: OutboxItem[]): Set<string> {
  return new Set(items.filter((i): i is ReceiptItem => i.kind === "receipt").map((i) => i.localUri));
}
