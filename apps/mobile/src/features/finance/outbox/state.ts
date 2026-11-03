// The outbox: expenses and receipt photos saved on this phone that haven't
// reached FFSA Hub yet. This file is the pure state machine (no I/O), so
// every transition is unit-tested; runner.ts does the sending and store.ts
// keeps it on disk.
//
//   waiting ──run──▶ sending ──ok──▶ (removed: it's on the server)
//      ▲                │
//      │   transient    │ network, timeout, 5xx: back to waiting with a
//      └── (backoff) ◀──┤ growing delay; after MAX_ATTEMPTS it needs the person
//                       │
//                       └─ permanent (403, 4xx) ─▶ failed ── Retry ─▶ waiting
//                                                     └── Remove (person only)
//
// Nothing is ever dropped without the person choosing "Remove".
// A receipt waits behind its expense while that expense is still in the
// outbox, so a photo is never registered against an expense the server
// doesn't have yet.

import type { ExpensePayload } from "../expense-form";

export type OutboxStatus = "waiting" | "sending" | "failed";

type Common = {
  /** Expense id (kind "expense") or a local id (kind "receipt"). */
  id: string;
  /** Whose outbox this is: items only send while the same person is signed in. */
  userId: string;
  teamId: string;
  status: OutboxStatus;
  attempts: number;
  /** Epoch ms before which an automatic retry won't run. */
  nextAttemptAt: number;
  lastError: string | null;
  createdAt: number;
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

export const MAX_ATTEMPTS = 8;
const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 5 * 60_000;

/** 2s, 4s, 8s … capped at 5 minutes. */
export function backoffMs(attempts: number): number {
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1));
}

/** The web's path rule: `${teamId}/${expenseId}/${Date.now()}_${file.name}`. */
export function receiptPath(teamId: string, expenseId: string, fileName: string, now: number): string {
  return `${teamId}/${expenseId}/${now}_${fileName}`;
}

export function enqueue(items: OutboxItem[], ...added: OutboxItem[]): OutboxItem[] {
  const ids = new Set(added.map((a) => a.id));
  return [...items.filter((i) => !ids.has(i.id)), ...added];
}

/** After a restart nothing is mid-send: anything left "sending" goes back to waiting. */
export function recover(items: OutboxItem[]): OutboxItem[] {
  return items.map((i) => (i.status === "sending" ? { ...i, status: "waiting" as const } : i));
}

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
export function nextWakeAt(items: OutboxItem[], userId: string | null): number | null {
  const times = items.filter((i) => i.userId === userId && i.status === "waiting").map((i) => i.nextAttemptAt);
  return times.length ? Math.min(...times) : null;
}

function patch(items: OutboxItem[], id: string, fn: (i: OutboxItem) => OutboxItem): OutboxItem[] {
  return items.map((i) => (i.id === id ? fn(i) : i));
}

export function markSending(items: OutboxItem[], id: string): OutboxItem[] {
  return patch(items, id, (i) => ({ ...i, status: "sending" }));
}

export function markFileUploaded(items: OutboxItem[], id: string): OutboxItem[] {
  return patch(items, id, (i) => (i.kind === "receipt" ? { ...i, fileUploaded: true } : i));
}

/** On the server: out of the outbox. */
export function markDone(items: OutboxItem[], id: string): OutboxItem[] {
  return items.filter((i) => i.id !== id);
}

export type Failure = { permanent: boolean; message: string };

export function markFailed(items: OutboxItem[], id: string, failure: Failure, now: number): OutboxItem[] {
  return patch(items, id, (i) => {
    const attempts = i.attempts + 1;
    const giveUp = failure.permanent || attempts >= MAX_ATTEMPTS;
    return {
      ...i,
      attempts,
      lastError: failure.message,
      status: giveUp ? "failed" : "waiting",
      nextAttemptAt: giveUp ? i.nextAttemptAt : now + backoffMs(attempts),
    };
  });
}

/** The person tapped Retry (or connectivity came back): try now. */
export function retry(items: OutboxItem[], id: string): OutboxItem[] {
  return patch(items, id, (i) => ({ ...i, status: "waiting", nextAttemptAt: 0, attempts: i.status === "failed" ? 0 : i.attempts }));
}

/** Connectivity came back or the app was opened: waiting items needn't sit out their backoff. */
export function wakeAll(items: OutboxItem[]): OutboxItem[] {
  return items.map((i) => (i.status === "waiting" ? { ...i, nextAttemptAt: 0 } : i));
}

/**
 * The person chose Remove. An expense takes its own waiting receipts with
 * it (they could never be registered). Returns what was removed so the
 * caller can delete the photo files.
 */
export function discard(items: OutboxItem[], id: string): { items: OutboxItem[]; removed: OutboxItem[] } {
  const target = items.find((i) => i.id === id);
  if (!target) return { items, removed: [] };
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
