import type { AuthenticationType } from "expo-local-authentication";

import {
  availability,
  awayLongEnough,
  biometricKind,
  INITIAL_LOCK_STATE,
  LOCK_AFTER_MS,
  lockReducer,
  unlockOutcome,
  type LockEvent,
  type LockState,
} from "../logic";

const run = (events: LockEvent[], from: LockState = INITIAL_LOCK_STATE) => events.reduce(lockReducer, from);
const T0 = 1_000_000;
const MIN = 60 * 1000;

describe("lock timing", () => {
  it("locks after 5 minutes in the background", () => {
    expect(LOCK_AFTER_MS).toBe(5 * MIN);
    const s = run([{ type: "launch", enabled: false }, { type: "background", at: T0 }, { type: "active", at: T0 + 5 * MIN, enabled: true }]);
    expect(s.locked).toBe(true);
  });

  it("doesn't lock when back before 5 minutes", () => {
    const s = run([{ type: "background", at: T0 }, { type: "active", at: T0 + 5 * MIN - 1, enabled: true }]);
    expect(s).toEqual({ locked: false, backgroundedAt: null });
  });

  it("a cold start locks when the lock is on", () => {
    expect(run([{ type: "launch", enabled: true }]).locked).toBe(true);
  });

  it("off never locks: not on a cold start, not after hours away", () => {
    expect(run([{ type: "launch", enabled: false }]).locked).toBe(false);
    const s = run([{ type: "background", at: T0 }, { type: "active", at: T0 + 10 * 60 * MIN, enabled: false }]);
    expect(s.locked).toBe(false);
  });

  it("the clock starts the first time it left (a second background doesn't restart it)", () => {
    const s = run([
      { type: "background", at: T0 },
      { type: "background", at: T0 + 4 * MIN },
      { type: "active", at: T0 + 5 * MIN, enabled: true },
    ]);
    expect(s.locked).toBe(true);
  });

  it("an active with no background first (a Face ID prompt, Control Centre) doesn't lock", () => {
    expect(run([{ type: "active", at: T0 + 99 * MIN, enabled: true }]).locked).toBe(false);
  });

  it("stays locked when back quickly after a cancelled unlock; unlocks on yes; reset clears", () => {
    const locked = run([{ type: "launch", enabled: true }, { type: "background", at: T0 }, { type: "active", at: T0 + MIN, enabled: true }]);
    expect(locked.locked).toBe(true);
    expect(lockReducer(locked, { type: "unlocked" }).locked).toBe(false);
    expect(lockReducer(locked, { type: "reset" })).toEqual(INITIAL_LOCK_STATE);
  });

  it("awayLongEnough: nothing recorded is never long enough", () => {
    expect(awayLongEnough(null, T0)).toBe(false);
    expect(awayLongEnough(T0, T0 + LOCK_AFTER_MS)).toBe(true);
  });
});

describe("what the phone calls it", () => {
  const t = (...n: number[]) => n as AuthenticationType[];
  it("iPhone: Face ID or Touch ID", () => {
    expect(biometricKind(t(2), "ios")).toBe("faceId");
    expect(biometricKind(t(1), "ios")).toBe("touchId");
  });
  it("Android: Fingerprint first, then Face unlock, then Iris", () => {
    expect(biometricKind(t(1, 2, 3), "android")).toBe("fingerprint");
    expect(biometricKind(t(2), "android")).toBe("faceUnlock");
    expect(biometricKind(t(3), "android")).toBe("iris");
  });
  it("available only with hardware AND something enrolled", () => {
    expect(availability(true, true, "faceId")).toEqual({ status: "available", kind: "faceId" });
    expect(availability(true, false, "faceId")).toEqual({ status: "unavailable" });
    expect(availability(false, true, "faceId")).toEqual({ status: "unavailable" });
  });
});

describe("unlock answers", () => {
  it.each([
    [{ success: true } as const, "unlocked"],
    [{ success: false, error: "user_cancel" } as const, "cancelled"],
    [{ success: false, error: "system_cancel" } as const, "cancelled"],
    [{ success: false, error: "app_cancel" } as const, "cancelled"],
    [{ success: false, error: "not_enrolled" } as const, "unavailable"],
    [{ success: false, error: "passcode_not_set" } as const, "unavailable"],
    [{ success: false, error: "lockout" } as const, "failed"],
    [{ success: false, error: "authentication_failed" } as const, "failed"],
  ])("%j → %s", (result, outcome) => {
    expect(unlockOutcome(result)).toBe(outcome);
  });
});
