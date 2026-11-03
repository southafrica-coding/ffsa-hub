// The vehicle-check outbox: photos and collection/return forms saved on this
// phone that haven't reached FFSA Hub yet. Pure state (no I/O), so every
// transition is unit-tested; runner.ts sends, store.ts keeps it on disk.
//
// Why not the finance outbox? It is built around expenses and receipts (an
// expense id, a team, a direct bucket upload then an API registration).
// Vehicle photos go to a different API route as multipart, and the form is a
// different call, so this is a small sibling queue on the same shared core
// (src/lib/outbox/queue.ts: backoff, give-up rule, diagram), so both
// outboxes behave the same way. Nothing is dropped without the person
// choosing "Remove".

import { MAX_ATTEMPTS } from "@/lib/outbox/backoff";
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

import type { InspectionKind, PhotoKind } from "../logic";

export { MAX_ATTEMPTS, type Failure };

export type QueueStatus = ItemStatus;

type Common = BaseItem & {
  bookingId: string;
  /** Shown in the list: "Kombi trip · collection". */
  bookingName: string;
  inspectionKind: InspectionKind;
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

const fresh = { status: "waiting" as const, attempts: 0, nextAttemptAt: 0, lastError: null, lastTriedAt: null, holdUntil: null, maybeSent: false };

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

/** A double tap: the same photo file, or the same form for the same check. */
export function sameQueueItem(a: QueueItem, b: QueueItem): boolean {
  if (a.kind === "photo" && b.kind === "photo") return a.localUri === b.localUri;
  if (a.kind === "form" && b.kind === "form") {
    return a.bookingId === b.bookingId && a.inspectionKind === b.inspectionKind && JSON.stringify(a.payload) === JSON.stringify(b.payload);
  }
  return false;
}

export function enqueue(items: QueueItem[], ...added: QueueItem[]): QueueItem[] {
  return enqueueUnique(items, added, sameQueueItem);
}

/** Stored-item shape check (on top of the shared base fields). */
export function isQueueItem(v: BaseItem): boolean {
  const i = v as Partial<QueueItem> & Record<string, unknown>;
  if (typeof i.bookingId !== "string" || typeof i.bookingName !== "string" || typeof i.inspectionKind !== "string") return false;
  if (i.kind === "photo") return typeof i.localUri === "string" && typeof i.fileName === "string" && typeof i.mimeType === "string" && typeof i.photoKind === "string";
  if (i.kind === "form") return !!i.payload && typeof i.payload === "object";
  return false;
}

/** After a restart nothing is mid-send. */
export const recover = (items: QueueItem[]): QueueItem[] => recoverItems(items);

/** What may go now, oldest first, for this person only. */
export function runnable(items: QueueItem[], opts: { now: number; userId: string | null; online: boolean }): QueueItem[] {
  if (!opts.online || !opts.userId) return [];
  return items
    .filter((i) => i.userId === opts.userId && i.status === "waiting" && i.nextAttemptAt <= opts.now)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export const nextWakeAt = (items: QueueItem[], userId: string | null): number | null => nextWakeAtFor(items, userId);

export const markSending = (items: QueueItem[], id: string, now?: number): QueueItem[] => markSendingItem(items, id, now);

export const markDone = (items: QueueItem[], id: string): QueueItem[] => markDoneItem(items, id);

export const markFailed = (items: QueueItem[], id: string, failure: Failure, now: number, random?: number): QueueItem[] =>
  markFailedItem(items, id, failure, now, random);

export const retry = (items: QueueItem[], id: string): QueueItem[] => retryItem(items, id);

export const wakeAll = (items: QueueItem[]): QueueItem[] => wakeItems(items);

/** The person chose Remove (never mid-send). */
export function discard(items: QueueItem[], id: string): { items: QueueItem[]; removed: QueueItem[] } {
  const target = items.find((i) => i.id === id);
  if (!target || target.status === "sending") return { items, removed: [] };
  return { items: items.filter((i) => i.id !== id), removed: [target] };
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

// ── Telling a re-sent photo apart ───────────────────────────────────────────

/**
 * The upload route stores photos under a path it makes up, so a retry after
 * a lost answer can't overwrite the first copy. Instead the file name sent
 * carries the item's id ("IMG_1__<id>.jpg"), and before re-sending a photo
 * that may have arrived, the runner looks for that name on the booking.
 */
export function taggedFileName(fileName: string, id: string): string {
  const m = /^(.*?)(\.[A-Za-z0-9]+)?$/.exec(fileName);
  const stem = m?.[1] || "photo";
  return `${stem}__${id}${m?.[2] ?? ""}`;
}

export function hasTaggedFile(names: (string | null | undefined)[], id: string): boolean {
  return names.some((n) => !!n && n.includes(`__${id}`));
}
