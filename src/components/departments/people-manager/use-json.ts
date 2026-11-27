"use client";

import { useCallback, useEffect, useState } from "react";
import { requestJson } from "./client";

export type JsonState<T> = {
  data: T | null;
  /** Failure code of the last read (never the server's text). */
  code: string | null;
  status: number;
  loading: boolean;
  reload: () => void;
};

/** GET a JSON url (null = don't load). Keeps the last good data while reloading. */
export function useJson<T>(url: string | null): JsonState<T> {
  const [state, setState] = useState<Omit<JsonState<T>, "reload">>({ data: null, code: null, status: 0, loading: url !== null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (url === null) return;
    const ac = new AbortController();
    setState((s) => ({ ...s, loading: true }));
    void requestJson<T>(url, { signal: ac.signal }).then((r) => {
      if (ac.signal.aborted) return;
      setState((s) =>
        r.ok ? { data: r.data, code: null, status: 200, loading: false } : { data: s.data, code: r.code ?? "error", status: r.status, loading: false }
      );
    });
    return () => ac.abort();
  }, [url, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}
