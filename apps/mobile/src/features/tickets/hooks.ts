// Small hooks for the Tickets slice. Who the person is comes from the
// shell's shared useMe() ("@/features/shell"), not from here.

import * as Brightness from "expo-brightness";
import { useNetworkState } from "expo-network";
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

import { ApiError } from "@/lib/api";
import { apiFetch } from "@/lib/api-client";
import { supabase } from "@/lib/supabase";

import { getMyTickets, type MyTickets } from "./api";
import { loadCachedTickets, saveCachedTickets } from "./ticket-cache";

/** True for 401/403-deactivated: apiFetch already signed out; the auth gate takes over. */
export function isSignedOutError(err: unknown) {
  return err instanceof ApiError && (err.kind === "unauthenticated" || err.kind === "deactivated");
}

// ── Session user id (for per-user storage keys) ─────────────────────────────

export async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

// ── Online ──────────────────────────────────────────────────────────────────

/** false only when the OS says there's no connection; unknown counts as online. */
export function useOnline(): boolean {
  const net = useNetworkState();
  if (net.isConnected === false) return false;
  if (net.isInternetReachable === false) return false;
  return true;
}

// ── Brightness boost for the QR ─────────────────────────────────────────────

/**
 * Full brightness while the QR is on screen, so a door scanner reads it in
 * sun or a dark hall. Restored on leave: Android hands control back to the
 * system setting; iOS gets the previous level back (iOS also resets it
 * itself when the phone locks).
 */
export function useBrightnessBoost(active: boolean) {
  useEffect(() => {
    if (!active) return;
    let previous: number | null = null;
    let cancelled = false;
    (async () => {
      try {
        previous = await Brightness.getBrightnessAsync();
        if (!cancelled) await Brightness.setBrightnessAsync(1);
      } catch {
        // Not available (simulator, some tablets): the QR still shows.
      }
    })();
    return () => {
      cancelled = true;
      (async () => {
        try {
          if (Platform.OS === "android") await Brightness.restoreSystemBrightnessAsync();
          else if (previous !== null) await Brightness.setBrightnessAsync(previous);
        } catch {
          // Nothing more we can do; iOS restores on lock anyway.
        }
      })();
    };
  }, [active]);
}

// ── My tickets: saved copy first, then the network ──────────────────────────

export type MyTicketsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      data: MyTickets;
      savedAt: string | null;
      /** Showing the saved copy because the refresh failed. */
      stale: boolean;
      refreshError: ApiError | null;
    };

export function useMyTickets(): MyTicketsState & { refreshing: boolean; refresh: () => Promise<void> } {
  const [state, setState] = useState<MyTicketsState>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);
  const userId = useRef<string | null>(null);

  const fetchFresh = useCallback(async () => {
    try {
      const data = await getMyTickets(apiFetch);
      const savedAt = new Date().toISOString();
      if (userId.current) await saveCachedTickets(userId.current, data, savedAt);
      if (mounted.current) setState({ status: "ready", data, savedAt, stale: false, refreshError: null });
    } catch (err) {
      if (!mounted.current || isSignedOutError(err)) return;
      const apiErr = err instanceof ApiError ? err : null;
      setState((prev) =>
        prev.status === "ready"
          ? { ...prev, stale: true, refreshError: apiErr }
          : { status: "error", message: apiErr?.message ?? "Something went wrong loading your tickets." },
      );
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    (async () => {
      userId.current = await currentUserId();
      const cached = userId.current ? await loadCachedTickets(userId.current) : null;
      if (cached && mounted.current) {
        setState({ status: "ready", data: cached.data, savedAt: cached.savedAt, stale: true, refreshError: null });
      }
      await fetchFresh();
    })();
    return () => {
      mounted.current = false;
    };
  }, [fetchFresh]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setState((prev) => (prev.status === "error" ? { status: "loading" } : prev));
    await fetchFresh();
    if (mounted.current) setRefreshing(false);
  }, [fetchFresh]);

  return { ...state, refreshing, refresh };
}
