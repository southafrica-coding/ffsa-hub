// Offline check-in queue.
//
// When the door has no signal, a scan is saved here instead of being lost.
// It is NEVER shown as a check-in until the server has answered: a queued
// scan is "Saved, not yet confirmed", and only a server "ok" (or "already
// checked in") turns it into confirmed.
//
// State machine per item:
//
//   pending ──send──▶ sending ──server ok / already in──▶ confirmed
//      ▲                 │  ├──server says no (wrong event, void, …)──▶ rejected
//      │                 │  └──refused (403, 4xx) or MAX_ATTEMPTS tries──▶ failed ("needs you")
//      └──no connection, │                                                  │ Retry → pending
//         timeout, 5xx ──┘                                                  │ Remove (asks first)
//
// "sending" never survives an app restart: on load it goes back to pending
// (the request may or may not have arrived; resending is safe because the
// server's check-in is idempotent and answers "already checked in").
//
// The reducer is pure and unit-tested; storage and sending are thin
// wrappers below it.

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { z } from "zod";

import { ApiError } from "@/lib/api";
import { isRetryableStatus, MAX_ATTEMPTS } from "@/lib/outbox/backoff";
import type { StoreProblem } from "@/lib/outbox/persist";

import { scanOutcomeSchema, type DoorClient, type ScanOutcome } from "./api";
import { isRetryableError } from "./result";

export type QueuedScanState = "pending" | "sending" | "confirmed" | "rejected" | "failed";

export type QueuedScan = {
  id: string;
  eventId: string;
  code: string;
  queuedAt: string;
  attempts: number;
  state: QueuedScanState;
  outcome: ScanOutcome | null;
  lastError: string | null;
  /** When the last send started (epoch ms). Added in storage v2. */
  lastTriedAt?: number | null;
};

export type QueueAction =
  | { type: "enqueue"; id: string; eventId: string; code: string; at: string }
  | { type: "sending"; id: string; at?: number }
  | { type: "answered"; id: string; outcome: ScanOutcome }
  /** `permanent`: retrying won't help (the person must decide). `uncounted`: not this scan's fault (signed out). */
  | { type: "failed"; id: string; error: string; permanent?: boolean; uncounted?: boolean }
  /** The person tapped Retry on scans that need them. */
  | { type: "retry"; id: string }
  | { type: "dismiss"; id: string }
  | { type: "restore" }
  | { type: "load"; items: QueuedScan[] };

/** A stable id for a queued scan, chosen once when it's queued. */
export function newScanId(): string {
  if (typeof Crypto.randomUUID === "function") return Crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function queueReducer(queue: QueuedScan[], action: QueueAction): QueuedScan[] {
  switch (action.type) {
    case "enqueue": {
      // The same code twice for one event is one guest: keep a single entry.
      const dupe = queue.some(
        (q) => q.eventId === action.eventId && q.code === action.code && (q.state === "pending" || q.state === "sending"),
      );
      if (dupe) return queue;
      return [
        ...queue,
        {
          id: action.id,
          eventId: action.eventId,
          code: action.code,
          queuedAt: action.at,
          attempts: 0,
          state: "pending",
          outcome: null,
          lastError: null,
        },
      ];
    }
    case "sending":
      return queue.map((q) =>
        q.id === action.id && q.state === "pending" ? { ...q, state: "sending", lastTriedAt: action.at ?? q.lastTriedAt ?? null } : q,
      );
    case "answered": {
      const admitted = action.outcome.result === "ok" || action.outcome.result === "already_checked_in";
      return queue.map((q) =>
        q.id === action.id && q.state === "sending"
          ? { ...q, state: admitted ? "confirmed" : "rejected", outcome: action.outcome, attempts: q.attempts + 1, lastError: null }
          : q,
      );
    }
    case "failed":
      return queue.map((q) => {
        if (q.id !== action.id || q.state !== "sending") return q;
        const attempts = action.uncounted ? q.attempts : q.attempts + 1;
        const giveUp = action.permanent === true || attempts >= MAX_ATTEMPTS;
        return { ...q, state: giveUp ? "failed" : "pending", attempts, lastError: action.error };
      });
    case "retry":
      return queue.map((q) => (q.id === action.id && q.state === "failed" ? { ...q, state: "pending", attempts: 0 } : q));
    case "dismiss":
      // Unsent scans are never dropped by a dismiss; a "needs you" scan only
      // goes when the person confirms Remove.
      return queue.filter((q) => q.id !== action.id || q.state === "pending" || q.state === "sending");
    case "restore":
      return queue.map((q) => (q.state === "sending" ? { ...q, state: "pending" } : q));
    case "load": {
      // Saved items first (they're older); anything queued meanwhile stays.
      const ids = new Set(queue.map((q) => q.id));
      const loaded = queueReducer(action.items, { type: "restore" }).filter((q) => !ids.has(q.id));
      return [...loaded, ...queue];
    }
  }
}

export function pendingFor(queue: QueuedScan[], eventId: string) {
  return queue.filter((q) => q.eventId === eventId && (q.state === "pending" || q.state === "sending"));
}

export function rejectedFor(queue: QueuedScan[], eventId: string) {
  return queue.filter((q) => q.eventId === eventId && q.state === "rejected");
}

/** Scans that couldn't be sent and need the person (Retry or Remove). */
export function failedFor(queue: QueuedScan[], eventId: string) {
  return queue.filter((q) => q.eventId === eventId && q.state === "failed");
}

/** The latest "last tried" among these scans, or null. */
export function lastTriedOf(scans: QueuedScan[]): number | null {
  const times = scans.map((q) => q.lastTriedAt ?? 0).filter((t) => t > 0);
  return times.length ? Math.max(...times) : null;
}

// ── Storage ─────────────────────────────────────────────────────────────────

// Stored as { version: 2, items: [...] } under one key per signed-in user.
// Version 1 (the key is unchanged) was a bare array; it is still read.
const STORAGE_PREFIX = "ffsa.tickets.checkin-queue.v1:";
const STORE_VERSION = 2;

const storedItemSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  code: z.string(),
  queuedAt: z.string(),
  attempts: z.number(),
  state: z.enum(["pending", "sending", "confirmed", "rejected", "failed"]),
  outcome: scanOutcomeSchema.nullable(),
  lastError: z.string().nullable(),
  lastTriedAt: z.number().nullish(),
});

/** Per signed-in user, so one person's queue is never sent under another's account. */
export const queueKey = (userId: string) => `${STORAGE_PREFIX}${userId}`;

/** Where an unreadable queue is kept, untouched, so a damaged copy never silently becomes empty. */
export const quarantineKey = (userId: string, at: number) => `${queueKey(userId)}:quarantine:${at}`;

/** Pure: stored text → what can be read, and whether anything couldn't. */
export function parseStoredQueue(raw: string | null): { items: QueuedScan[]; problem: StoreProblem } {
  if (!raw) return { items: [], problem: null };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { items: [], problem: "corrupt" };
  }
  const list = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)
      ? (value as { items: unknown[] }).items
      : null;
  if (!list) return { items: [], problem: "corrupt" };
  const items: QueuedScan[] = [];
  for (const entry of list) {
    const parsed = storedItemSchema.safeParse(entry);
    if (parsed.success) items.push({ ...parsed.data, lastTriedAt: parsed.data.lastTriedAt ?? null });
  }
  return { items: queueReducer(items, { type: "restore" }), problem: items.length < list.length ? "partial" : null };
}

/**
 * Load one person's queue. Anything that can't be read is copied to a
 * quarantine key before the queue is used (and later overwritten), and
 * reported so the door can say so.
 */
export async function loadQueueWithStatus(userId: string, now: number = Date.now()): Promise<{ items: QueuedScan[]; problem: StoreProblem }> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(queueKey(userId));
  } catch {
    return { items: [], problem: "corrupt" };
  }
  const result = parseStoredQueue(raw);
  if (result.problem && raw) {
    await AsyncStorage.setItem(quarantineKey(userId, now), raw).catch(() => undefined);
  }
  return result;
}

export async function loadQueue(userId: string): Promise<QueuedScan[]> {
  return (await loadQueueWithStatus(userId)).items;
}

export async function saveQueue(userId: string, queue: QueuedScan[]): Promise<void> {
  // Confirmed items have done their job; keep the entry small. (One
  // AsyncStorage setItem replaces the value whole, so a crash can't leave
  // half a queue.)
  const keep = queue.filter((q) => q.state !== "confirmed");
  await AsyncStorage.setItem(queueKey(userId), JSON.stringify({ version: STORE_VERSION, items: keep }));
}

// ── Sending ─────────────────────────────────────────────────────────────────

/** How a failed check-in send is handled. */
export function classifyScanError(err: unknown): { stop: boolean; permanent: boolean; uncounted: boolean } {
  // No connection or no answer: the rest are offline too. The check-in is
  // idempotent on the server, so sending again later is safe.
  if (isRetryableError(err)) return { stop: true, permanent: false, uncounted: false };
  if (err instanceof ApiError) {
    // Signed out: the app is going to the sign-in screen; nothing is this scan's fault.
    if (err.kind === "unauthenticated" || err.kind === "deactivated") return { stop: true, permanent: false, uncounted: true };
    if (err.kind === "http" && isRetryableStatus(err.status)) return { stop: false, permanent: false, uncounted: false };
    if (err.kind === "invalid_response") return { stop: false, permanent: false, uncounted: false };
    // 403 (can't run this door any more) and other refusals: retrying won't help.
    return { stop: false, permanent: true, uncounted: false };
  }
  return { stop: false, permanent: false, uncounted: false };
}

/**
 * Send every pending scan for one event, one at a time, through `dispatch`
 * (so the UI and storage see each step). Stops at the first connection
 * failure: the rest are still offline. `stillOwner` is checked before each
 * send, so nothing goes under someone else's account. Returns how many got
 * an answer.
 */
export async function flushQueue(
  queue: QueuedScan[],
  eventId: string,
  door: Pick<DoorClient, "checkIn">,
  dispatch: (action: QueueAction) => void,
  opts: { now?: () => number; stillOwner?: () => Promise<boolean> } = {},
): Promise<number> {
  let answered = 0;
  for (const item of pendingFor(queue, eventId)) {
    if (item.state !== "pending") continue;
    if (opts.stillOwner && !(await opts.stillOwner())) break;
    dispatch({ type: "sending", id: item.id, at: (opts.now ?? Date.now)() });
    try {
      const outcome = await door.checkIn(item.code);
      dispatch({ type: "answered", id: item.id, outcome });
      answered++;
    } catch (err) {
      const c = classifyScanError(err);
      dispatch({ type: "failed", id: item.id, error: err instanceof Error ? err.message : "Failed", permanent: c.permanent, uncounted: c.uncounted });
      if (c.stop) break;
    }
  }
  return answered;
}
