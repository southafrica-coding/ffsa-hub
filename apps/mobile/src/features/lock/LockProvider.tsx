import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";

import { useSession } from "@/auth/session-provider";

import { authenticate, checkBiometrics } from "./biometrics";
import { INITIAL_LOCK_STATE, lockReducer, type Availability, type UnlockOutcome } from "./logic";
import { clearLockEnabled, readLockEnabled, writeLockEnabled } from "./storage";
import { lockStrings as s } from "./strings";

export type EnableResult = "on" | "off" | "cancelled" | "failed" | "saveFailed";

export type LockContextValue = {
  /** False until the saved choice has been read (the splash stays up). */
  ready: boolean;
  /** The person turned the lock on (Me › Settings). */
  enabled: boolean;
  /** The lock screen is showing. */
  locked: boolean;
  /** In the background with the lock on: content is hidden from the app switcher. */
  covered: boolean;
  /** What this phone can do, and what it calls it. */
  biometrics: Availability;
  /** Ask for Face ID (or the passcode); unlocks on yes. */
  unlock: () => Promise<UnlockOutcome>;
  /** Turning on asks for Face ID first; a cancel or failure leaves it off. */
  setEnabled: (next: boolean) => Promise<EnableResult>;
};

const LockContext = createContext<LockContextValue | null>(null);

/**
 * Root of the app (app/_layout.tsx), inside SessionProvider. Reads the saved
 * choice before the splash hides (so a cold start never flashes content),
 * follows the app going to the background and back, and forgets the choice
 * when the person signs out, however that happens (Me › Sign out, the lock
 * screen, a deactivated account).
 */
export function LockProvider({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const [readDone, setReadDone] = useState(false);
  const [enabled, setEnabledState] = useState(false);
  const [state, dispatch] = useReducer(lockReducer, INITIAL_LOCK_STATE);
  const [inBackground, setInBackground] = useState(false);
  const [biometrics, setBiometrics] = useState<Availability>({ status: "checking" });
  const prompting = useRef<Promise<UnlockOutcome> | null>(null);

  // Signed out (any way at all): forget the choice in memory at once...
  const [prevStatus, setPrevStatus] = useState(status);
  if (status !== prevStatus) {
    setPrevStatus(status);
    if (status === "signedOut") {
      setEnabledState(false);
      setReadDone(false);
      dispatch({ type: "reset" });
    }
  }

  useEffect(() => {
    // ...and on the phone.
    if (status === "signedOut") void clearLockEnabled();
    if (status !== "signedIn") return;
    let alive = true;
    void readLockEnabled().then((saved) => {
      if (!alive) return;
      setEnabledState(saved);
      dispatch({ type: "launch", enabled: saved });
      setReadDone(true);
    });
    return () => {
      alive = false;
    };
  }, [status]);

  const refreshBiometrics = useCallback(() => {
    void checkBiometrics().then(setBiometrics);
  }, []);

  useEffect(() => {
    refreshBiometrics();
    const sub = AppState.addEventListener("change", (next) => {
      setInBackground(next === "background");
      // Face ID may have been set up (or removed) in the phone's Settings.
      if (next === "active") refreshBiometrics();
    });
    return () => sub.remove();
  }, [refreshBiometrics]);

  // The AppState listener reads the latest choice without resubscribing.
  const enabledRef = useRef(enabled);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "background") dispatch({ type: "background", at: Date.now() });
      if (next === "active") dispatch({ type: "active", at: Date.now(), enabled: enabledRef.current });
    });
    return () => sub.remove();
  }, []);

  const prompt = useCallback((message: string) => {
    // One system prompt at a time (an auto-prompt and a tap can't stack).
    if (!prompting.current) {
      prompting.current = authenticate(message, s.cancel).finally(() => {
        prompting.current = null;
      });
    }
    return prompting.current;
  }, []);

  const unlock = useCallback(async () => {
    const outcome = await prompt(s.promptMessage);
    if (outcome === "unlocked") dispatch({ type: "unlocked" });
    return outcome;
  }, [prompt]);

  const setEnabled = useCallback(
    async (next: boolean): Promise<EnableResult> => {
      if (next) {
        const kind = biometrics.status === "available" ? biometrics.kind : "faceId";
        const outcome = await prompt(s.setting.confirmPrompt(kind));
        if (outcome === "cancelled") return "cancelled";
        if (outcome !== "unlocked") return "failed";
      }
      try {
        await writeLockEnabled(next);
      } catch {
        return "saveFailed";
      }
      setEnabledState(next);
      if (!next) dispatch({ type: "reset" });
      return next ? "on" : "off";
    },
    [biometrics, prompt],
  );

  const value = useMemo<LockContextValue>(
    () => ({
      ready: status === "signedOut" || readDone,
      enabled,
      locked: enabled && state.locked,
      covered: enabled && inBackground,
      biometrics,
      unlock,
      setEnabled,
    }),
    [status, readDone, enabled, state.locked, inBackground, biometrics, unlock, setEnabled],
  );
  return <LockContext.Provider value={value}>{children}</LockContext.Provider>;
}

// Outside the provider (screens rendered alone in tests): never locked, and
// the switch does nothing.
const OUTSIDE_PROVIDER: LockContextValue = {
  ready: true,
  enabled: false,
  locked: false,
  covered: false,
  biometrics: { status: "unavailable" },
  unlock: async () => "unavailable",
  setEnabled: async () => "failed",
};

export function useLock(): LockContextValue {
  return useContext(LockContext) ?? OUTSIDE_PROVIDER;
}
