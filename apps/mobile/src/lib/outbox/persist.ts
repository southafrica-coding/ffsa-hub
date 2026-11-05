// How an outbox is written to the phone, and read back safely.
//
// Stored shape (version 2):  { "version": 2, "items": [ … ] }
// Version 1 (Phase 1/2) was a bare array of items; it is read and upgraded.
//
// Reading never turns a damaged file into a silently empty queue: whatever
// can't be read is reported (`problem`) so the caller keeps a copy of the
// raw file aside and tells the person, and every item that CAN be read is
// kept.

import { withDefaults, type BaseItem } from "./queue";

export const STORE_VERSION = 2;

/** "corrupt": nothing could be read. "partial": some items couldn't be read. */
export type StoreProblem = "corrupt" | "partial" | null;

export type Parsed<T> = { items: T[]; problem: StoreProblem };

export function serializeStore(items: BaseItem[]): string {
  return JSON.stringify({ version: STORE_VERSION, items });
}

const STATUSES = new Set(["waiting", "sending", "failed"]);
const isNum = (v: unknown) => typeof v === "number" && Number.isFinite(v);

/** The fields every outbox item must have to be sendable. */
export function isBaseItem(v: unknown): v is BaseItem {
  if (!v || typeof v !== "object") return false;
  const i = v as Record<string, unknown>;
  return (
    typeof i.id === "string" &&
    i.id.length > 0 &&
    typeof i.kind === "string" &&
    typeof i.userId === "string" &&
    typeof i.status === "string" &&
    STATUSES.has(i.status) &&
    isNum(i.attempts) &&
    isNum(i.nextAttemptAt) &&
    isNum(i.createdAt) &&
    (i.lastError === null || i.lastError === undefined || typeof i.lastError === "string")
  );
}

/**
 * Read what's stored. `raw` is the file's text (or, in tests, an already
 * parsed value); `isItem` checks one queue's own fields on top of the base.
 */
export function parseStore<T extends BaseItem>(raw: unknown, isItem: (v: BaseItem) => boolean): Parsed<T> {
  if (raw === null || raw === undefined || raw === "") return { items: [], problem: null };

  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return { items: [], problem: "corrupt" };
    }
  }

  let list: unknown[];
  let newer = false;
  if (Array.isArray(value)) {
    list = value; // version 1
  } else if (value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)) {
    const v = (value as { version?: unknown }).version;
    // Written by a newer app (then the app was rolled back): read what we
    // understand, but keep the original aside.
    newer = typeof v === "number" && v > STORE_VERSION;
    list = (value as { items: unknown[] }).items;
  } else {
    return { items: [], problem: "corrupt" };
  }

  const items: T[] = [];
  for (const entry of list) {
    if (isBaseItem(entry) && isItem(entry)) items.push(withDefaults(entry as T));
  }
  const dropped = items.length < list.length;
  return { items, problem: dropped || newer ? "partial" : null };
}
