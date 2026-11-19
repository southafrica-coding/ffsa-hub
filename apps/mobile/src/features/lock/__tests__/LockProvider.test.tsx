import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, render, screen } from "@testing-library/react-native";
import * as LocalAuthentication from "expo-local-authentication";
import { useEffect } from "react";
import { AppState, Text } from "react-native";

import type { SessionState } from "@/auth/session-provider";

import { LockProvider, useLock, type LockContextValue } from "../LockProvider";
import { LOCK_STORAGE_KEY } from "../storage";

let mockSession: SessionState = { status: "signedIn", session: { user: { id: "u1" } } } as unknown as SessionState;
const mockListeners = new Set<() => void>();
function setSession(next: SessionState) {
  mockSession = next;
  mockListeners.forEach((l) => l());
}
jest.mock("@/auth/session-provider", () => {
  const { useSyncExternalStore } = jest.requireActual("react");
  return {
    useSession: () =>
      useSyncExternalStore(
        (l: () => void) => {
          mockListeners.add(l);
          return () => mockListeners.delete(l);
        },
        () => mockSession,
      ),
  };
});

const SIGNED_IN = { status: "signedIn", session: { user: { id: "u1" } } } as unknown as SessionState;
const auth = LocalAuthentication.authenticateAsync as jest.Mock;
const hasHardware = LocalAuthentication.hasHardwareAsync as jest.Mock;
const enrolled = LocalAuthentication.isEnrolledAsync as jest.Mock;
const types = LocalAuthentication.supportedAuthenticationTypesAsync as jest.Mock;

// jest-expo's AppState.addEventListener is a jest.fn: read the handlers it
// was given rather than spying on it (spying breaks later tests).
const addListener = AppState.addEventListener as unknown as jest.Mock;
let callsBefore = 0;
function emit(next: "active" | "background" | "inactive") {
  addListener.mock.calls.slice(callsBefore).forEach(([type, handler]) => {
    if (type === "change") handler(next);
  });
}

// The latest context value, for calling unlock / setEnabled from the test.
const hook: { current: LockContextValue | null } = { current: null };
function Probe() {
  const lock = useLock();
  useEffect(() => {
    hook.current = lock;
  });
  return <Text testID="probe">{`${lock.ready}|${lock.enabled}|${lock.locked}|${lock.covered}`}</Text>;
}
const latestOf = () => hook.current as LockContextValue;
const probe = () => screen.getByTestId("probe").props.children as string;

async function mount() {
  await render(
    <LockProvider>
      <Probe />
    </LockProvider>,
  );
}

let now = 1_000_000;
beforeEach(async () => {
  await AsyncStorage.clear();
  mockSession = SIGNED_IN;
  callsBefore = addListener.mock.calls.length;
  hasHardware.mockResolvedValue(true);
  enrolled.mockResolvedValue(true);
  types.mockResolvedValue([2]);
  auth.mockReset();
  jest.spyOn(Date, "now").mockImplementation(() => now);
});

afterEach(() => {
  (Date.now as jest.Mock).mockRestore();
});

describe("LockProvider", () => {
  it("off by default: ready, nothing locked", async () => {
    await mount();
    expect(probe()).toBe("true|false|false|false");
    expect(latestOf().biometrics).toEqual({ status: "available", kind: "faceId" });
  });

  it("cold start with the lock on: locked before anything shows", async () => {
    await AsyncStorage.setItem(LOCK_STORAGE_KEY, "on");
    await mount();
    expect(probe()).toBe("true|true|true|false");
  });

  it("not ready while the session is still being restored", async () => {
    mockSession = { status: "loading", session: null };
    await mount();
    expect(latestOf().ready).toBe(false);
  });

  it("background: covered for the app switcher; back within 5 minutes doesn't lock", async () => {
    await AsyncStorage.setItem(LOCK_STORAGE_KEY, "on");
    await mount();
    auth.mockResolvedValueOnce({ success: true });
    await act(async () => void (await latestOf().unlock()));
    expect(latestOf().locked).toBe(false);

    await act(async () => emit("background"));
    expect(latestOf().covered).toBe(true);
    now += 4 * 60 * 1000;
    await act(async () => emit("active"));
    expect(probe()).toBe("true|true|false|false");
  });

  it("back after 5 minutes: locked", async () => {
    await AsyncStorage.setItem(LOCK_STORAGE_KEY, "on");
    await mount();
    auth.mockResolvedValueOnce({ success: true });
    await act(async () => void (await latestOf().unlock()));
    await act(async () => emit("background"));
    now += 5 * 60 * 1000;
    await act(async () => emit("active"));
    expect(latestOf().locked).toBe(true);
  });

  it("off: never covered, never locked, however long away", async () => {
    await mount();
    await act(async () => emit("background"));
    expect(latestOf().covered).toBe(false);
    now += 60 * 60 * 1000;
    await act(async () => emit("active"));
    expect(latestOf().locked).toBe(false);
  });

  it("unlock asks with the phone's passcode as the fallback", async () => {
    await AsyncStorage.setItem(LOCK_STORAGE_KEY, "on");
    await mount();
    auth.mockResolvedValueOnce({ success: false, error: "user_cancel" });
    let outcome = "";
    await act(async () => void (outcome = await latestOf().unlock()));
    expect(outcome).toBe("cancelled");
    expect(latestOf().locked).toBe(true);
    expect(auth).toHaveBeenCalledWith(expect.objectContaining({ disableDeviceFallback: false, promptMessage: "Unlock FFSA Hub" }));
  });

  it("turning on asks for Face ID once and saves on yes", async () => {
    await mount();
    auth.mockResolvedValueOnce({ success: true });
    let result = "";
    await act(async () => void (result = await latestOf().setEnabled(true)));
    expect(result).toBe("on");
    expect(auth).toHaveBeenCalledTimes(1);
    expect(auth).toHaveBeenCalledWith(expect.objectContaining({ promptMessage: "Turn on Face ID lock" }));
    expect(await AsyncStorage.getItem(LOCK_STORAGE_KEY)).toBe("on");
    // Turning it on doesn't lock you out there and then.
    expect(probe()).toBe("true|true|false|false");
  });

  it("turning on: a cancel or a failure leaves it off and saves nothing", async () => {
    await mount();
    auth.mockResolvedValueOnce({ success: false, error: "user_cancel" });
    let result = "";
    await act(async () => void (result = await latestOf().setEnabled(true)));
    expect(result).toBe("cancelled");
    auth.mockResolvedValueOnce({ success: false, error: "authentication_failed" });
    await act(async () => void (result = await latestOf().setEnabled(true)));
    expect(result).toBe("failed");
    expect(latestOf().enabled).toBe(false);
    expect(await AsyncStorage.getItem(LOCK_STORAGE_KEY)).toBeNull();
  });

  it("turning off needs no Face ID and forgets the choice", async () => {
    await AsyncStorage.setItem(LOCK_STORAGE_KEY, "on");
    await mount();
    auth.mockResolvedValueOnce({ success: true });
    await act(async () => void (await latestOf().unlock()));
    auth.mockClear();
    await act(async () => void (await latestOf().setEnabled(false)));
    expect(auth).not.toHaveBeenCalled();
    expect(latestOf().enabled).toBe(false);
    expect(await AsyncStorage.getItem(LOCK_STORAGE_KEY)).toBeNull();
  });

  it("signing out (any way) forgets the choice on this phone", async () => {
    await AsyncStorage.setItem(LOCK_STORAGE_KEY, "on");
    await mount();
    expect(latestOf().locked).toBe(true);
    await act(async () => setSession({ status: "signedOut", session: null }));
    expect(probe()).toBe("true|false|false|false");
    expect(await AsyncStorage.getItem(LOCK_STORAGE_KEY)).toBeNull();
    // The next person to sign in starts with it off.
    await act(async () => setSession(SIGNED_IN));
    expect(probe()).toBe("true|false|false|false");
  });

  it("a phone with no biometrics enrolled reports unavailable", async () => {
    enrolled.mockResolvedValue(false);
    await mount();
    expect(latestOf().biometrics).toEqual({ status: "unavailable" });
  });
});
