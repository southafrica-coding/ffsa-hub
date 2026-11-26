// Face ID lock: the pure rules (no React, no native calls), so they can be
// tested on their own.
//
// - Off by default. Turned on in Me › Settings, stored on this phone only.
// - When on: the app locks on a cold start, and when it comes back after
//   5 minutes or more in the background. Coming back sooner doesn't lock.
// - Off, or signed out: never locks.

import type { AuthenticationType } from "expo-local-authentication";

/** How long the app may sit in the background before it locks. */
export const LOCK_AFTER_MS = 5 * 60 * 1000;

export type LockState = {
  /** The lock screen is showing. */
  locked: boolean;
  /** When the app last went to the background (ms), or null while in front. */
  backgroundedAt: number | null;
};

export type LockEvent =
  /** The saved choice has been read at launch. */
  | { type: "launch"; enabled: boolean }
  /** The app went to the background. */
  | { type: "background"; at: number }
  /** The app came back to the front. */
  | { type: "active"; at: number; enabled: boolean }
  /** Face ID (or the phone's passcode) said yes. */
  | { type: "unlocked" }
  /** Switched off, or signed out: nothing to lock any more. */
  | { type: "reset" };

export const INITIAL_LOCK_STATE: LockState = { locked: false, backgroundedAt: null };

/** True when the app has been away long enough to lock. */
export function awayLongEnough(backgroundedAt: number | null, now: number, lockAfterMs = LOCK_AFTER_MS): boolean {
  if (backgroundedAt === null) return false;
  return now - backgroundedAt >= lockAfterMs;
}

export function lockReducer(state: LockState, event: LockEvent): LockState {
  switch (event.type) {
    case "launch":
      // A cold start while signed in locks (the gate only shows it when signed in).
      return { locked: event.enabled, backgroundedAt: null };
    case "background":
      // Keep the first time it left: a second "background" doesn't restart the clock.
      return { ...state, backgroundedAt: state.backgroundedAt ?? event.at };
    case "active":
      return {
        locked: state.locked || (event.enabled && awayLongEnough(state.backgroundedAt, event.at)),
        backgroundedAt: null,
      };
    case "unlocked":
      return { ...state, locked: false };
    case "reset":
      return INITIAL_LOCK_STATE;
  }
}

// ---------------------------------------------------------------------------
// What the phone calls it
// ---------------------------------------------------------------------------

export type BiometricKind = "faceId" | "touchId" | "fingerprint" | "faceUnlock" | "iris";

// Values of expo-local-authentication's AuthenticationType enum (kept as
// numbers here so this file never loads the native module).
const FINGERPRINT = 1 as AuthenticationType;
const FACIAL_RECOGNITION = 2 as AuthenticationType;
const IRIS = 3 as AuthenticationType;

/**
 * The name to use for the phone's biometrics, from the types it reports.
 * iPhone: Face ID or Touch ID. Android: Fingerprint first (the one most
 * phones have), then Face unlock, then Iris.
 */
export function biometricKind(types: readonly AuthenticationType[], os: string): BiometricKind {
  const has = (t: AuthenticationType) => types.includes(t);
  if (os === "ios") return has(FACIAL_RECOGNITION) || !has(FINGERPRINT) ? "faceId" : "touchId";
  if (has(FINGERPRINT)) return "fingerprint";
  if (has(FACIAL_RECOGNITION)) return "faceUnlock";
  if (has(IRIS)) return "iris";
  return "fingerprint";
}

export type Availability =
  | { status: "checking" }
  | { status: "unavailable" }
  | { status: "available"; kind: BiometricKind };

/** The phone can do it only with the hardware AND something enrolled. */
export function availability(hasHardware: boolean, enrolled: boolean, kind: BiometricKind): Availability {
  return hasHardware && enrolled ? { status: "available", kind } : { status: "unavailable" };
}

// ---------------------------------------------------------------------------
// Unlock answers
// ---------------------------------------------------------------------------

export type UnlockOutcome = "unlocked" | "cancelled" | "unavailable" | "failed";

/**
 * What an authenticateAsync answer means for the screen. A cancel (by the
 * person, the system or the app) is quiet: the screen waits for Unlock.
 */
export function unlockOutcome(result: { success: true } | { success: false; error: string }): UnlockOutcome {
  if (result.success) return "unlocked";
  switch (result.error) {
    case "user_cancel":
    case "system_cancel":
    case "app_cancel":
    case "user_fallback":
      return "cancelled";
    case "not_enrolled":
    case "not_available":
    case "passcode_not_set":
      return "unavailable";
    default:
      return "failed";
  }
}
