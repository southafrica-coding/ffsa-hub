// The door controller: one hook that turns scans, typed codes and name-search
// taps into verdicts, keeps the tally fresh, holds the Undo window, and
// queues scans while offline. It talks to a DoorClient, so the volunteer
// door (/api/scan/[token], src/features/public-scan) reuses it with a
// different client and a different queue owner.

import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AccessibilityInfo, AppState } from "react-native";

import { ApiError } from "@/lib/api";
import { backoffMs, jitter } from "@/lib/outbox/backoff";
import type { StoreProblem } from "@/lib/outbox/persist";

import type { DoorClient, DoorStats } from "./api";
import { currentUserId, isSignedOutError } from "./hooks";
import {
  failedFor,
  flushQueue,
  lastTriedOf,
  loadQueueWithStatus,
  newScanId,
  pendingFor,
  queueReducer,
  rejectedFor,
  saveQueue,
  type QueueAction,
} from "./offline-queue";
import { parseTicketCode } from "./qr";
import {
  isRetryableError,
  verdictFromError,
  verdictFromOutcome,
  verdictNotATicket,
  verdictQueued,
  verdictUndone,
  type Verdict,
  type VerdictHaptic,
} from "./result";
import { createScanGate } from "./scan-gate";
import { strings } from "./strings";

/** How long "Undo" stays offered after a check-in. */
export const UNDO_MS = 10_000;
/** The same ticket held in front of the lens isn't resubmitted for this long. */
export const SAME_CODE_MS = 8_000;
/** Tally refresh while the door screen is open and online. */
export const STATS_POLL_MS = 30_000;

const HAPTIC: Record<VerdictHaptic, Haptics.NotificationFeedbackType> = {
  success: Haptics.NotificationFeedbackType.Success,
  warning: Haptics.NotificationFeedbackType.Warning,
  error: Haptics.NotificationFeedbackType.Error,
};

export type DoorState = ReturnType<typeof useDoor>;

/**
 * `owner` names whose saved scans these are (the storage key, and the check
 * before each send). The signed-in person by default; the volunteer door
 * passes its link instead, because a volunteer may have no account.
 */
export function useDoor(
  eventId: string,
  door: DoorClient,
  online: boolean,
  now: () => number = Date.now,
  owner: () => Promise<string | null> = currentUserId,
) {
  const [stats, setStats] = useState<DoorStats | null>(null);
  const [statsFailed, setStatsFailed] = useState(false);
  const [denied, setDenied] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [undoOpen, setUndoOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [queue, dispatchRaw] = useReducer(queueReducer, []);
  const [problem, setProblem] = useState<StoreProblem>(null);

  const gate = useMemo(() => createScanGate(SAME_CODE_MS), []);
  const userId = useRef<string | null>(null);
  const queueLoaded = useRef(false);
  const queueRef = useRef(queue);
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);
  const busyRef = useRef(false);
  const ownerRef = useRef(owner);
  useEffect(() => {
    ownerRef.current = owner;
  }, [owner]);

  const dispatch = useCallback((a: QueueAction) => dispatchRaw(a), []);

  // ── Queue: load once, persist on every change ─────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      userId.current = await ownerRef.current();
      const stored = userId.current ? await loadQueueWithStatus(userId.current) : { items: [], problem: null };
      if (cancelled) return;
      queueLoaded.current = true;
      setProblem(stored.problem);
      dispatchRaw({ type: "load", items: stored.items });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (queueLoaded.current && userId.current) void saveQueue(userId.current, queue);
  }, [queue]);

  // ── Tally ────────────────────────────────────────────────────────────────
  const refreshStats = useCallback(
    () =>
      door.stats().then(
        (next) => {
          setStats(next);
          setStatsFailed(false);
        },
        (err: unknown) => {
          if (isSignedOutError(err)) return;
          setStatsFailed(true);
          // The server is the judge: a 403 here means this person can't run this door.
          if (err instanceof ApiError && err.kind === "forbidden") setDenied(true);
        },
      ),
    [door],
  );

  useEffect(() => {
    if (!online) return;
    void refreshStats();
    const t = setInterval(() => void refreshStats(), STATS_POLL_MS);
    return () => clearInterval(t);
  }, [online, refreshStats]);

  // ── Verdicts ─────────────────────────────────────────────────────────────
  const show = useCallback((v: Verdict) => {
    setVerdict(v);
    setUndoOpen(!!v.undoTicketId);
    void Haptics.notificationAsync(HAPTIC[v.haptic]).catch(() => undefined);
    AccessibilityInfo.announceForAccessibility([v.title, v.detail].filter(Boolean).join(". "));
  }, []);

  useEffect(() => {
    if (!undoOpen) return;
    const t = setTimeout(() => setUndoOpen(false), UNDO_MS);
    return () => clearTimeout(t);
  }, [undoOpen, verdict]);

  const submit = useCallback(
    async (code: string) => {
      if (!online) {
        dispatch({ type: "enqueue", id: newScanId(), eventId, code, at: new Date(now()).toISOString() });
        show(verdictQueued());
        return;
      }
      try {
        const outcome = await door.checkIn(code);
        show(verdictFromOutcome(outcome));
        if (outcome.result === "ok") void refreshStats();
      } catch (err) {
        if (isSignedOutError(err)) return;
        if (isRetryableError(err)) {
          dispatch({ type: "enqueue", id: newScanId(), eventId, code, at: new Date(now()).toISOString() });
          show(verdictQueued());
        } else {
          show(verdictFromError(err));
        }
      }
    },
    [online, door, eventId, now, show, dispatch, refreshStats],
  );

  /** Typed code or a name-search tap: no camera debounce, one at a time. */
  const checkInCode = useCallback(
    async (raw: string) => {
      if (busyRef.current) return;
      const parsed = parseTicketCode(raw);
      if (!parsed.ok) {
        show(verdictNotATicket());
        return;
      }
      busyRef.current = true;
      setBusy(true);
      try {
        await submit(parsed.code);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [submit, show],
  );

  /** From the camera: debounced so one ticket is never sent twice. */
  const onScanned = useCallback(
    async (raw: string) => {
      if (busyRef.current || !gate.accept(raw, now())) return;
      busyRef.current = true;
      setBusy(true);
      try {
        const parsed = parseTicketCode(raw);
        if (!parsed.ok) show(verdictNotATicket());
        else await submit(parsed.code);
      } finally {
        gate.release();
        busyRef.current = false;
        setBusy(false);
      }
    },
    [gate, now, submit, show],
  );

  const undo = useCallback(async () => {
    const ticketId = verdict?.undoTicketId;
    if (!ticketId || !undoOpen) return;
    setUndoOpen(false);
    try {
      await door.undo(ticketId);
      gate.reset();
      show(verdictUndone());
      void refreshStats();
    } catch (err) {
      if (!isSignedOutError(err)) show(verdictFromError(err, strings.result.undoFailed));
    }
  }, [verdict, undoOpen, door, gate, show, refreshStats]);

  const dismiss = useCallback(() => {
    setVerdict(null);
    setUndoOpen(false);
  }, []);

  // ── Offline queue ────────────────────────────────────────────────────────
  const pending = pendingFor(queue, eventId);
  const rejected = rejectedFor(queue, eventId);
  const failed = failedFor(queue, eventId);
  const lastTriedAt = lastTriedOf([...pending, ...failed]);

  const sync = useCallback(async () => {
    if (syncing || !online) return;
    setSyncing(true);
    try {
      const ownerId = userId.current;
      const answered = await flushQueue(queueRef.current, eventId, door, dispatch, {
        now,
        // Never send one person's saved scans under someone else's account.
        stillOwner: async () => !!ownerId && (await ownerRef.current()) === ownerId,
      });
      if (answered > 0) void refreshStats();
    } finally {
      setSyncing(false);
    }
  }, [syncing, online, eventId, door, dispatch, refreshStats, now]);
  const syncRef = useRef(sync);
  useEffect(() => {
    syncRef.current = sync;
  }, [sync]);

  // Back online with scans waiting: send them.
  const pendingCount = pending.length;
  useEffect(() => {
    if (!online || pendingCount === 0) return;
    const t = setTimeout(() => void sync(), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when connectivity or the count changes
  }, [online, pendingCount]);

  // A try failed but the phone still looks online (server busy, weak
  // signal): try again after a growing, jittered delay, never in a loop.
  const maxAttempts = pending.reduce((m, q) => Math.max(m, q.attempts), 0);
  useEffect(() => {
    if (!online || pendingCount === 0 || maxAttempts === 0) return;
    const t = setTimeout(() => void syncRef.current(), jitter(backoffMs(maxAttempts), Math.random()));
    return () => clearTimeout(t);
  }, [online, pendingCount, maxAttempts]);

  // Back to the door app after a while: send what's waiting.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && pendingFor(queueRef.current, eventId).length > 0) void syncRef.current();
    });
    return () => sub.remove();
  }, [eventId]);

  /** The person tapped Retry on the scans that need them. */
  const retryFailed = useCallback(() => {
    for (const f of failedFor(queueRef.current, eventId)) dispatch({ type: "retry", id: f.id });
  }, [eventId, dispatch]);

  /** The person confirmed Remove: these scans are dropped from the phone. */
  const removeFailed = useCallback(() => {
    for (const f of failedFor(queueRef.current, eventId)) dispatch({ type: "dismiss", id: f.id });
  }, [eventId, dispatch]);

  const dismissProblem = useCallback(() => setProblem(null), []);

  const clearRejected = useCallback(() => {
    for (const r of rejectedFor(queueRef.current, eventId)) dispatch({ type: "dismiss", id: r.id });
  }, [eventId, dispatch]);

  return {
    stats,
    statsFailed,
    denied,
    verdict,
    undoOpen,
    busy,
    syncing,
    pending,
    rejected,
    failed,
    lastTriedAt,
    problem,
    dismissProblem,
    retryFailed,
    removeFailed,
    onScanned,
    checkInCode,
    undo,
    dismiss,
    sync,
    clearRejected,
    refreshStats,
  };
}
