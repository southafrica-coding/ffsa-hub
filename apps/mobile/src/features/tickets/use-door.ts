// The door controller: one hook that turns scans, typed codes and name-search
// taps into verdicts, keeps the tally fresh, holds the Undo window, and
// queues scans while offline. It talks to a DoorClient, so the Phase 2
// volunteer door (/api/scan/[token]) can reuse it with a different client.

import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AccessibilityInfo } from "react-native";

import { ApiError } from "@/lib/api";

import type { DoorClient, DoorStats } from "./api";
import { currentUserId, isSignedOutError } from "./hooks";
import { flushQueue, loadQueue, pendingFor, queueReducer, rejectedFor, saveQueue, type QueueAction } from "./offline-queue";
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

let idCounter = 0;
const newId = () => `${Date.now().toString(36)}-${(idCounter++).toString(36)}`;

export type DoorState = ReturnType<typeof useDoor>;

export function useDoor(eventId: string, door: DoorClient, online: boolean, now: () => number = Date.now) {
  const [stats, setStats] = useState<DoorStats | null>(null);
  const [statsFailed, setStatsFailed] = useState(false);
  const [denied, setDenied] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [undoOpen, setUndoOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [queue, dispatchRaw] = useReducer(queueReducer, []);

  const gate = useMemo(() => createScanGate(SAME_CODE_MS), []);
  const userId = useRef<string | null>(null);
  const queueLoaded = useRef(false);
  const queueRef = useRef(queue);
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);
  const busyRef = useRef(false);

  const dispatch = useCallback((a: QueueAction) => dispatchRaw(a), []);

  // ── Queue: load once, persist on every change ─────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      userId.current = await currentUserId();
      const stored = userId.current ? await loadQueue(userId.current) : [];
      if (cancelled) return;
      queueLoaded.current = true;
      dispatchRaw({ type: "load", items: stored });
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
        dispatch({ type: "enqueue", id: newId(), eventId, code, at: new Date(now()).toISOString() });
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
          dispatch({ type: "enqueue", id: newId(), eventId, code, at: new Date(now()).toISOString() });
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

  const sync = useCallback(async () => {
    if (syncing || !online) return;
    setSyncing(true);
    try {
      const answered = await flushQueue(queueRef.current, eventId, door, dispatch);
      if (answered > 0) void refreshStats();
    } finally {
      setSyncing(false);
    }
  }, [syncing, online, eventId, door, dispatch, refreshStats]);

  // Back online with scans waiting: send them.
  const pendingCount = pending.length;
  useEffect(() => {
    if (!online || pendingCount === 0) return;
    const t = setTimeout(() => void sync(), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when connectivity or the count changes
  }, [online, pendingCount]);

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
    onScanned,
    checkInCode,
    undo,
    dismiss,
    sync,
    clearRejected,
    refreshStats,
  };
}
