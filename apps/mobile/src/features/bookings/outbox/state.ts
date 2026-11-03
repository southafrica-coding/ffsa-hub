// The vehicle-check outbox: photos and collection/return forms saved on this
// phone that haven't reached FFSA Hub yet. Pure state (no I/O), so every
// transition is unit-tested; runner.ts sends, store.ts keeps it on disk.
//
// Why not the finance outbox? It is built around expenses and receipts (an
// expense id, a team, a direct bucket upload then an API registration).
// Vehicle photos go to a different API route as multipart, and the form is a
// different call, so this is a small sibling queue. It reuses finance's
// backoff and give-up rule so both outboxes behave the same way:
//
//   waiting ──run──▶ sending ──ok──▶ (removed: it's on the server)
//      ▲                │
//      └── backoff ◀────┤ network, timeout, 5xx; after MAX_ATTEMPTS it needs the person
//                       └─ permanent (403, 4xx) ─▶ failed ── Retry ─▶ waiting
//                                                    └── Remove (person only)
//
// Nothing is dropped without the person choosing "Remove".

import { backoffMs, MAX_ATTEMPTS, type Failure } from "@/features/finance/outbox/state";

import type { InspectionKind, PhotoKind } from "../logic";

export { MAX_ATTEMPTS, type Failure };

export type QueueStatus = "waiting" | "sending" | "failed";

type Common = {
  id: string;
  /** Items only send while the same person is signed in. */
  userId: string;
  bookingId: string;
  /** Shown in the list: "Kombi trip · collection". */
  bookingName: string;
  inspectionKind: InspectionKind;
  status: QueueStatus;
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
  createdAt: number;
};

export type PhotoItem = Common & {
  kind: "photo";
  photoKind: PhotoKind;
  /** The compressed photo, in the app's documents folder. */
  localUri: string;
  fileName: string;
  mimeType: string;
};

export type FormItem = Common & {
  kind: "form";
  /** POST /api/vehicles/inspections body. */
  payload: Record<string, unknown> & { kind: InspectionKind };
};

export type QueueItem = PhotoItem | FormItem;

type NewMeta = { userId: string; bookingId: string; bookingName: string; inspectionKind: InspectionKind };

const fresh = { status: "waiting" as const, attempts: 0, nextAttemptAt: 0, lastError: null };

/** Queue items for freshly taken photos (ids and clock passed in, so it stays pure). */
export function newPhotoItems(
  meta: NewMeta,
  photoKind: PhotoKind,
  drafts: { localUri: string; fileName: string; mimeType: string }[],
  now: number,
  makeId: () => string,
): PhotoItem[] {
  return drafts.map((p, i) => ({ kind: "photo", id: makeId(), ...meta, ...fresh, photoKind, ...p, createdAt: now + i }));
}

export function newFormItem(meta: NewMeta, payload: FormItem["payload"], now: number, id: string): FormItem {
  return { kind: "form", id, ...meta, ...fresh, payload, createdAt: now };
}

export function enqueue(items: QueueItem[], ...added: QueueItem[]): QueueItem[] {
  const ids = new Set(added.map((a) => a.id));
  return [...items.filter((i) => !ids.has(i.id)), ...added];
}

/** After a restart nothing is mid-send. */
export function recover(items: QueueItem[]): QueueItem[] {
  return items.map((i) => (i.status === "sending" ? { ...i, status: "waiting" as const } : i));
}

/** What may go now, oldest first, for this person only. */
export function runnable(items: QueueItem[], opts: { now: number; userId: string | null; online: boolean }): QueueItem[] {
  if (!opts.online || !opts.userId) return [];
  return items
    .filter((i) => i.userId === opts.userId && i.status === "waiting" && i.nextAttemptAt <= opts.now)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function nextWakeAt(items: QueueItem[], userId: string | null): number | null {
  const times = items.filter((i) => i.userId === userId && i.status === "waiting").map((i) => i.nextAttemptAt);
  return times.length ? Math.min(...times) : null;
}

function patch(items: QueueItem[], id: string, fn: (i: QueueItem) => QueueItem): QueueItem[] {
  return items.map((i) => (i.id === id ? fn(i) : i));
}

export function markSending(items: QueueItem[], id: string): QueueItem[] {
  return patch(items, id, (i) => ({ ...i, status: "sending" }));
}

export function markDone(items: QueueItem[], id: string): QueueItem[] {
  return items.filter((i) => i.id !== id);
}

export function markFailed(items: QueueItem[], id: string, failure: Failure, now: number): QueueItem[] {
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

export function retry(items: QueueItem[], id: string): QueueItem[] {
  return patch(items, id, (i) => ({ ...i, status: "waiting", nextAttemptAt: 0, attempts: i.status === "failed" ? 0 : i.attempts }));
}

export function wakeAll(items: QueueItem[]): QueueItem[] {
  return items.map((i) => (i.status === "waiting" ? { ...i, nextAttemptAt: 0 } : i));
}

export function discard(items: QueueItem[], id: string): { items: QueueItem[]; removed: QueueItem[] } {
  return { items: items.filter((i) => i.id !== id), removed: items.filter((i) => i.id === id) };
}

// ── What the screens show ───────────────────────────────────────────────────

export function forBooking(items: QueueItem[], bookingId: string, userId: string | null): QueueItem[] {
  return items.filter((i) => i.bookingId === bookingId && i.userId === userId);
}

/** Photos of each kind for one check, saved here (any state). */
export function photoCounts(items: QueueItem[], bookingId: string, kind: InspectionKind, userId: string | null): Partial<Record<PhotoKind, number>> {
  const out: Partial<Record<PhotoKind, number>> = {};
  for (const i of items) {
    if (i.kind !== "photo" || i.bookingId !== bookingId || i.inspectionKind !== kind || i.userId !== userId) continue;
    out[i.photoKind] = (out[i.photoKind] ?? 0) + 1;
  }
  return out;
}

/** Is this check's form waiting on the phone (so it shows as "saved, not sent" rather than "not recorded")? */
export function formQueued(items: QueueItem[], bookingId: string, kind: InspectionKind, userId: string | null): boolean {
  return items.some((i) => i.kind === "form" && i.bookingId === bookingId && i.inspectionKind === kind && i.userId === userId);
}

export function referencedFiles(items: QueueItem[]): Set<string> {
  return new Set(items.filter((i): i is PhotoItem => i.kind === "photo").map((i) => i.localUri));
}
