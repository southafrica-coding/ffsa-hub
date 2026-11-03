import { useCallback, useEffect, useRef, useState } from "react";

import { readCache, writeCache } from "./cache";

export type LoadState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      data: T;
      /** When what's on screen was saved, if it's the saved copy (null when fresh). */
      staleSince: number | null;
      /** Set when a refresh failed and the saved copy is still showing. */
      refreshError: string | null;
    };

/**
 * Show the saved copy at once (if any), fetch a fresh one, save it.
 * A failed refresh keeps the saved copy on screen with a note and a retry;
 * with nothing saved it's a plain error state.
 *
 * `load` and `errorMessage` must be stable (useCallback / module functions).
 */
export function useCachedLoad<T>({
  userId,
  cacheName,
  load,
  errorMessage,
}: {
  userId: string | null;
  cacheName: string;
  load: () => Promise<T>;
  errorMessage: (err: unknown) => string;
}) {
  const [state, setState] = useState<LoadState<T>>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  // Bumped by each fetch, so only the newest answer lands.
  const runId = useRef(0);

  const fetchFresh = useCallback(
    (id: number, savedAt: number | null) =>
      load().then(
        (data) => {
          if (id !== runId.current) return;
          setState({ status: "ready", data, staleSince: null, refreshError: null });
          if (userId) void writeCache(userId, cacheName, data);
        },
        (err: unknown) => {
          if (id !== runId.current) return;
          const message = errorMessage(err);
          setState((prev) =>
            prev.status === "ready"
              ? { ...prev, staleSince: prev.staleSince ?? savedAt ?? Date.now(), refreshError: message }
              : { status: "error", message },
          );
        },
      ),
    [load, errorMessage, userId, cacheName],
  );

  useEffect(() => {
    const counter = runId;
    const id = ++counter.current;
    const cached = userId ? readCache<T>(userId, cacheName) : Promise.resolve(null);
    void cached
      .then((c) => {
        if (c && id === counter.current) {
          setState({ status: "ready", data: c.data, staleSince: c.savedAt, refreshError: null });
        }
        return fetchFresh(id, c?.savedAt ?? null);
      });
    return () => {
      counter.current++;
    };
  }, [userId, cacheName, fetchFresh]);

  const refresh = useCallback(async () => {
    const id = ++runId.current;
    setRefreshing(true);
    try {
      await fetchFresh(id, null);
    } finally {
      if (id === runId.current) setRefreshing(false);
    }
  }, [fetchFresh]);

  const retry = useCallback(() => {
    setState((prev) => (prev.status === "error" ? { status: "loading" } : prev));
    return refresh();
  }, [refresh]);

  return { state, refreshing, refresh, retry };
}
