import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { setTabBadge } from "@/features/shell/badges";
import { ApiError } from "@/lib/api";
import { apiFetch } from "@/lib/api-client";

import { getFeed, markRead as postMarkRead, type FeedItem } from "./api";
import { readFeedCache, writeFeedCache } from "./feed-cache";
import { markKeysRead, unreadCount } from "./feed-logic";

// The Home feed: saved copy first (instant, works offline), then the live
// feed from GET /api/notifications. Read state is optimistic: the row flips
// at once and POST /api/notifications/read runs behind it, like the web.

export type FeedNotice = { kind: "offline" } | { kind: "stale"; message: string } | null;

export type FeedState = {
  /** loading: nothing to show yet. ready: items (maybe empty). error: nothing saved and the fetch failed. */
  status: "loading" | "ready" | "error" | "forbidden";
  items: FeedItem[];
  /** When the shown items were saved, if they came from the device. */
  savedAt: string | null;
  /** Why the shown items may be out of date. */
  notice: FeedNotice;
  error: string | null;
  refreshing: boolean;
  /** When this state was produced (for "5m ago" labels without reading the clock in render). */
  asOf: number;
};

const INITIAL: FeedState = {
  status: "loading",
  items: [],
  savedAt: null,
  notice: null,
  error: null,
  refreshing: false,
  asOf: 0,
};

const REFRESH_ON_RESUME_AFTER_MS = 60_000;

export function useFeed(userId: string | null) {
  const [state, setState] = useState<FeedState>(INITIAL);
  // Latest state for callbacks (markRead) without re-creating them.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const requestId = useRef(0);
  const lastSuccess = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const fetchLive = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const feed = await getFeed(apiFetch);
      if (!mounted.current || id !== requestId.current) return;
      lastSuccess.current = Date.now();
      setState({
        status: "ready",
        items: feed.items,
        savedAt: null,
        notice: null,
        error: null,
        refreshing: false,
        asOf: Date.now(),
      });
      if (userId) void writeFeedCache(userId, feed.items);
    } catch (err) {
      if (!mounted.current || id !== requestId.current) return;
      if (err instanceof ApiError && (err.kind === "unauthenticated" || err.kind === "deactivated")) {
        // Signed out already; the auth gate takes over.
        setState((s) => ({ ...s, refreshing: false }));
        return;
      }
      if (err instanceof ApiError && err.kind === "forbidden") {
        setState({ ...INITIAL, status: "forbidden" });
        return;
      }
      const message = err instanceof ApiError ? err.message : "Something went wrong. Try again.";
      const offline = err instanceof ApiError && (err.kind === "network" || err.kind === "timeout");
      setState((s) =>
        s.items.length > 0 || s.status === "ready"
          ? {
              ...s,
              status: "ready",
              notice: offline ? { kind: "offline" } : { kind: "stale", message },
              refreshing: false,
              asOf: Date.now(),
            }
          : { ...INITIAL, status: "error", error: message, asOf: Date.now() },
      );
    }
  }, [userId]);

  // Saved copy first, then live.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (userId) {
        const cached = await readFeedCache(userId);
        if (!cancelled && cached && stateRef.current.status === "loading") {
          setState({
            status: "ready",
            items: cached.items,
            savedAt: cached.savedAt,
            notice: null,
            error: null,
            refreshing: false,
            asOf: Date.now(),
          });
        }
      }
      if (!cancelled) await fetchLive();
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, fetchLive]);

  // Back from the background: refresh if it's been a while.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active" && Date.now() - lastSuccess.current > REFRESH_ON_RESUME_AFTER_MS) void fetchLive();
    });
    return () => sub.remove();
  }, [fetchLive]);

  // Unread count on the Home tab.
  const unread = unreadCount(state.items);
  useEffect(() => {
    setTabBadge("home", unread);
  }, [unread]);

  /** Pull-to-refresh. */
  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, refreshing: true }));
    await fetchLive();
  }, [fetchLive]);

  /** "Try again" from the error state. */
  const retry = useCallback(() => {
    setState(INITIAL);
    void fetchLive();
  }, [fetchLive]);

  const markRead = useCallback(
    (keys: string[]) => {
      const unreadKeys = keys.filter((k) => stateRef.current.items.some((i) => i.key === k && !i.read));
      if (unreadKeys.length === 0) return;
      const next = markKeysRead(stateRef.current.items, unreadKeys);
      setState((s) => ({ ...s, items: markKeysRead(s.items, unreadKeys) }));
      if (userId) void writeFeedCache(userId, next);
      // Fire and forget, like the web: if it fails the item is unread again
      // next refresh, which is harmless.
      postMarkRead(apiFetch, unreadKeys).catch(() => {});
    },
    [userId],
  );

  return { ...state, unread, refresh, retry, markRead };
}
