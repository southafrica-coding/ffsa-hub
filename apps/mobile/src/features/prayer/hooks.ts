// Data hooks for the Prayer Room. Each one has the same states the screens
// draw: loading, error (with the error kept so 403 can read as "not on your
// account"), and ready. The week shows the saved copy first, then the network.

import * as Haptics from "expo-haptics";
import { useNetworkState } from "expo-network";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";

import { useSession } from "@/auth/session-provider";

import { prayerFetch } from "./api-client";
import {
  getCommitments,
  getPendingSeatRequests,
  getPracticeWeek,
  getSet,
  getWallMeta,
  getWeek,
  type Commitments,
  type PracticeWeek,
  type PrayerSet,
  type SeatRequest,
  type WallMeta,
  type WeekPayload,
} from "./api";
import { loadSavedWeek, saveWeek } from "./cache";
import { friendlyError, isSignedOutError, weekDays, weekStart } from "./logic";

export function useUserId(): string | null {
  const s = useSession();
  return s.status === "signedIn" ? s.session.user.id : null;
}

/** false only when the OS says there's no connection; unknown counts as online. */
export function useOnline(): boolean {
  const net = useNetworkState();
  return net.isConnected !== false && net.isInternetReachable !== false;
}

export type Loadable<T> =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "ready"; data: T };

// ── The week ────────────────────────────────────────────────────────────────

export type WeekState =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | {
      status: "ready";
      data: WeekPayload;
      savedAt: string | null;
      /** Showing the saved copy: the refresh failed (or hasn't finished yet). */
      stale: boolean;
      /** Why the refresh failed, if it did. Null while still trying. */
      refreshError: unknown;
    };

export function useWeek(anchor: string): WeekState & { refreshing: boolean; refresh: () => Promise<void> } {
  const userId = useUserId();
  const start = weekStart(anchor);
  const [state, setState] = useState<WeekState>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  // Which week the latest request is for, so a slow answer for last week
  // never lands on top of this one.
  const current = useRef(start);

  const fetchFresh = useCallback(async () => {
    const days = weekDays(start);
    try {
      const data = await getWeek(prayerFetch, days[0], days[6]);
      const savedAt = new Date().toISOString();
      if (userId) await saveWeek(userId, start, data, savedAt);
      if (current.current === start) setState({ status: "ready", data, savedAt, stale: false, refreshError: null });
    } catch (error) {
      if (current.current !== start || isSignedOutError(error)) return;
      setState((prev) => (prev.status === "ready" ? { ...prev, stale: true, refreshError: error } : { status: "error", error }));
    }
  }, [start, userId]);

  // A different week: back to loading (during render, not in an effect).
  const [shownWeek, setShownWeek] = useState(start);
  if (shownWeek !== start) {
    setShownWeek(start);
    setState({ status: "loading" });
  }

  useEffect(() => {
    current.current = start;
    let alive = true;
    (async () => {
      const saved = userId ? await loadSavedWeek(userId, start) : null;
      if (saved && alive && current.current === start) {
        setState({ status: "ready", data: saved.data, savedAt: saved.savedAt, stale: true, refreshError: null });
      }
      await fetchFresh();
    })();
    return () => {
      alive = false;
    };
  }, [start, userId, fetchFresh]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setState((prev) => (prev.status === "error" ? { status: "loading" } : prev));
    await fetchFresh();
    setRefreshing(false);
  }, [fetchFresh]);

  return { ...state, refreshing, refresh };
}

// ── Simple network loads (no offline copy) ──────────────────────────────────

function useLoad<T>(key: string | null, load: () => Promise<T>) {
  const [state, setState] = useState<Loadable<T>>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef(load);
  useEffect(() => {
    latest.current = load;
  });
  const current = useRef(key);

  const run = useCallback(async (k: string | null) => {
    try {
      const data = await latest.current();
      if (current.current === k) setState({ status: "ready", data });
    } catch (error) {
      if (current.current === k && !isSignedOutError(error)) setState({ status: "error", error });
    }
  }, []);

  // A different thing to load: back to loading (during render, not in an effect).
  const [shownKey, setShownKey] = useState(key);
  if (shownKey !== key) {
    setShownKey(key);
    setState({ status: "loading" });
  }

  useEffect(() => {
    current.current = key;
    if (key === null) return;
    void run(key);
  }, [key, run]);

  /** Re-fetch without blanking the screen (after an action, or pull-to-refresh). */
  const reload = useCallback(async () => {
    setRefreshing(true);
    await run(current.current);
    setRefreshing(false);
  }, [run]);

  const retry = useCallback(async () => {
    setState({ status: "loading" });
    await run(current.current);
  }, [run]);

  return { state, refreshing, reload, retry };
}

export type SetDetail = { set: PrayerSet; requests: SeatRequest[] };

export function useSetDetail(setId: string | null) {
  return useLoad<SetDetail>(setId, async () => {
    const [set, requests] = await Promise.all([
      getSet(prayerFetch, setId!),
      // An empty inbox if this can't be read (the web does the same).
      getPendingSeatRequests(prayerFetch, setId!).catch(() => [] as SeatRequest[]),
    ]);
    return { set, requests };
  });
}

export function useCommitments(active: boolean) {
  return useLoad<Commitments>(active ? "mine" : null, () => getCommitments(prayerFetch));
}

/** Seat vocabulary + bands, for sheets opened outside the week view. Empty on failure, like the web. */
export function useWallMeta(active: boolean) {
  return useLoad<WallMeta>(active ? "meta" : null, () =>
    getWallMeta(prayerFetch).catch(() => ({ seatTypes: [], bands: [] }) as WallMeta),
  );
}

export function usePracticeWeek(anchor: string | null) {
  return useLoad<PracticeWeek>(anchor ? weekStart(anchor) : null, () => getPracticeWeek(prayerFetch, anchor!));
}

// ── Actions: confirm, run, haptic, then reload ──────────────────────────────

export type ConfirmSpec = { title: string; body: string; confirm: string; cancel: string; destructive?: boolean };

/** A native two-button confirmation. Resolves true if they confirmed. */
export function confirmAction(spec: ConfirmSpec): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      spec.title,
      spec.body,
      [
        { text: spec.cancel, style: "cancel", onPress: () => resolve(false) },
        { text: spec.confirm, style: spec.destructive ? "destructive" : "default", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

/**
 * Runs one write. No optimistic update: none of these is safely reversible
 * (an accepted seat emails the lead), so the screen waits for the server and
 * then reloads. Success gets a light haptic; failure keeps the server's words.
 */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(
    async (id: string, spec: ConfirmSpec | null, work: () => Promise<void>, success: string): Promise<ActionResult | null> => {
      if (spec && !(await confirmAction(spec))) return null;
      setBusy(id);
      try {
        await work();
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
        return { ok: true, message: success };
      } catch (err) {
        if (isSignedOutError(err)) return null;
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
        return { ok: false, message: friendlyError(err) };
      } finally {
        setBusy(null);
      }
    },
    [],
  );
  return { busy, run };
}
