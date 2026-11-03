import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  applyPreference,
  DEFAULT_PREFERENCE,
  readPreference,
  writePreference,
  type AppearancePreference,
} from "./preference";

export type AppearanceState = {
  /** False until the saved choice has been read and applied (the splash stays up). */
  ready: boolean;
  preference: AppearancePreference;
  /** Applies at once; resolves false if the phone couldn't save it. */
  setPreference: (pref: AppearancePreference) => Promise<boolean>;
};

const AppearanceContext = createContext<AppearanceState | null>(null);

/**
 * Root of the app (app/_layout.tsx). Reads the saved Appearance choice and
 * applies it before the splash screen hides, so there's no flash of the
 * wrong scheme.
 */
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [preference, setPref] = useState<AppearancePreference>(DEFAULT_PREFERENCE);

  useEffect(() => {
    let alive = true;
    void readPreference().then((saved) => {
      if (!alive) return;
      // "system" is the native default: only override when there's a choice.
      if (saved !== DEFAULT_PREFERENCE) applyPreference(saved);
      setPref(saved);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const setPreference = useCallback(async (next: AppearancePreference) => {
    applyPreference(next);
    setPref(next);
    try {
      await writePreference(next);
      return true;
    } catch {
      return false;
    }
  }, []);

  const value = useMemo(() => ({ ready, preference, setPreference }), [ready, preference, setPreference]);
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

// Outside the provider (screens rendered alone in tests): the phone's own
// setting, and choosing does nothing.
const OUTSIDE_PROVIDER: AppearanceState = {
  ready: true,
  preference: DEFAULT_PREFERENCE,
  setPreference: async () => false,
};

export function useAppearance(): AppearanceState {
  return useContext(AppearanceContext) ?? OUTSIDE_PROVIDER;
}
