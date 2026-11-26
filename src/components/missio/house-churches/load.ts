"use client";

import { useEffect, useState } from "react";

export type LoadState<T> =
  | { phase: "loading" }
  | { phase: "error"; error: unknown }
  | { phase: "ready"; data: T };

export function useMissioLoad<T>(load: () => Promise<T>, deps: readonly unknown[]): {
  state: LoadState<T>;
  retry: () => void;
} {
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<LoadState<T>>({ phase: "loading" });

  useEffect(() => {
    let active = true;
    setState({ phase: "loading" });
    load().then(
      (data) => {
        if (active) setState({ phase: "ready", data });
      },
      (error: unknown) => {
        if (active) setState({ phase: "error", error });
      }
    );
    return () => {
      active = false;
    };
    // `load` closes over the deps listed by the caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);

  return {
    state,
    retry: () => setTick((n) => n + 1),
  };
}
