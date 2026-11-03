import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";

import { ApiError, getMe, type Me } from "@/lib/api";
import { apiFetch } from "@/lib/api-client";

import { can, hasRole } from "./access";

// One GET /api/me for the whole signed-in area, refreshed when the app comes
// back to the foreground (roles can change on the web while the phone sleeps).
// Mounted by app/(app)/_layout.tsx, so it only exists while signed in.

export type MeState = {
  status: "loading" | "ready" | "error";
  me: Me | null;
  /** Plain-English reason when status is "error". */
  error: string | null;
  refresh: () => void;
};

const REFRESH_ON_RESUME_AFTER_MS = 5 * 60_000;

const MeContext = createContext<MeState | null>(null);

export function MeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<MeState, "refresh">>({ status: "loading", me: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const lastLoaded = useRef(0);

  const refresh = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    getMe(apiFetch, { signal: controller.signal }).then(
      (me) => {
        lastLoaded.current = Date.now();
        setState({ status: "ready", me, error: null });
      },
      (err: unknown) => {
        if (controller.signal.aborted) return;
        // 401/403-deactivated have already signed the user out; the auth gate takes over.
        if (err instanceof ApiError && (err.kind === "unauthenticated" || err.kind === "deactivated")) return;
        // Keep what we had: a failed refresh shouldn't hide tabs that were showing.
        setState((prev) => ({
          status: prev.me ? "ready" : "error",
          me: prev.me,
          error: err instanceof ApiError ? err.message : "Something went wrong loading your account.",
        }));
      },
    );
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active" && Date.now() - lastLoaded.current > REFRESH_ON_RESUME_AFTER_MS) refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const value = useMemo(() => ({ ...state, refresh }), [state, refresh]);
  return <MeContext.Provider value={value}>{children}</MeContext.Provider>;
}

/** The signed-in person (GET /api/me). Use inside the signed-in area only. */
export function useMe(): MeState {
  const ctx = useContext(MeContext);
  if (!ctx) throw new Error("useMe() must be used inside <MeProvider> (app/(app)/_layout.tsx).");
  return ctx;
}

/** UX gate only: true if the person holds `permission` (or is an admin). False while loading. */
export function useCan(permission: string): boolean {
  return can(useMe().me, permission);
}

/** UX gate only: true if the person holds the role `name` (any scope). */
export function useHasRole(name: string): boolean {
  return hasRole(useMe().me, name);
}
