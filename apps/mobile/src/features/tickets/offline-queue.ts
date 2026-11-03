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
//      ▲                 │  └──server says no (wrong event, void, …)──▶ rejected
//      └──no connection──┘
//
// "sending" never survives an app restart: on load it goes back to pending
// (the request may or may not have arrived; resending is safe because the
// server's check-in is idempotent and answers "already checked in").
//
// The reducer is pure and unit-tested; storage and sending are thin
// wrappers below it.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";

import { scanOutcomeSchema, type DoorClient, type ScanOutcome } from "./api";
import { isRetryableError } from "./result";

export type QueuedScanState = "pending" | "sending" | "confirmed" | "rejected";

export type QueuedScan = {
  id: string;
  eventId: string;
  code: string;
  queuedAt: string;
  attempts: number;
  state: QueuedScanState;
  outcome: ScanOutcome | null;
  lastError: string | null;
};

export type QueueAction =
  | { type: "enqueue"; id: string; eventId: string; code: string; at: string }
  | { type: "sending"; id: string }
  | { type: "answered"; id: string; outcome: ScanOutcome }
  | { type: "failed"; id: string; error: string }
  | { type: "dismiss"; id: string }
  | { type: "restore" }
  | { type: "load"; items: QueuedScan[] };

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
      return queue.map((q) => (q.id === action.id && q.state === "pending" ? { ...q, state: "sending" } : q));
    case "answered": {
      const admitted = action.outcome.result === "ok" || action.outcome.result === "already_checked_in";
      return queue.map((q) =>
        q.id === action.id && q.state === "sending"
          ? { ...q, state: admitted ? "confirmed" : "rejected", outcome: action.outcome, attempts: q.attempts + 1, lastError: null }
          : q,
      );
    }
    case "failed":
      return queue.map((q) =>
        q.id === action.id && q.state === "sending"
          ? { ...q, state: "pending", attempts: q.attempts + 1, lastError: action.error }
          : q,
      );
    case "dismiss":
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

// ── Storage ─────────────────────────────────────────────────────────────────

const STORAGE_PREFIX = "ffsa.tickets.checkin-queue.v1:";

const storedSchema = z.array(
  z.object({
    id: z.string(),
    eventId: z.string(),
    code: z.string(),
    queuedAt: z.string(),
    attempts: z.number(),
    state: z.enum(["pending", "sending", "confirmed", "rejected"]),
    outcome: scanOutcomeSchema.nullable(),
    lastError: z.string().nullable(),
  }),
);

/** Per signed-in user, so one person's queue is never sent under another's account. */
export const queueKey = (userId: string) => `${STORAGE_PREFIX}${userId}`;

export async function loadQueue(userId: string): Promise<QueuedScan[]> {
  try {
    const raw = await AsyncStorage.getItem(queueKey(userId));
    if (!raw) return [];
    const parsed = storedSchema.safeParse(JSON.parse(raw));
    return parsed.success ? queueReducer(parsed.data, { type: "restore" }) : [];
  } catch {
    return [];
  }
}

export async function saveQueue(userId: string, queue: QueuedScan[]): Promise<void> {
  // Confirmed items have done their job; keep the file small.
  const keep = queue.filter((q) => q.state !== "confirmed");
  await AsyncStorage.setItem(queueKey(userId), JSON.stringify(keep));
}

// ── Sending ─────────────────────────────────────────────────────────────────

/**
 * Send every pending scan for one event, one at a time, through `dispatch`
 * (so the UI and storage see each step). Stops at the first connection
 * failure: the rest are still offline. Returns how many got an answer.
 */
export async function flushQueue(
  queue: QueuedScan[],
  eventId: string,
  door: Pick<DoorClient, "checkIn">,
  dispatch: (action: QueueAction) => void,
): Promise<number> {
  let answered = 0;
  for (const item of pendingFor(queue, eventId)) {
    if (item.state !== "pending") continue;
    dispatch({ type: "sending", id: item.id });
    try {
      const outcome = await door.checkIn(item.code);
      dispatch({ type: "answered", id: item.id, outcome });
      answered++;
    } catch (err) {
      dispatch({ type: "failed", id: item.id, error: err instanceof Error ? err.message : "Failed" });
      if (isRetryableError(err)) break;
    }
  }
  return answered;
}
