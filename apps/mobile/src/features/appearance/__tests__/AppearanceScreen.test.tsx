import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";
import { colorScheme } from "nativewind";
import type { ReactNode } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { apiFetch } from "@/lib/api-client";

import { AppearanceProvider, useAppearance } from "../AppearanceProvider";
import { AppearanceScreen } from "../AppearanceScreen";
import { STORAGE_KEY } from "../preference";

jest.mock("nativewind", () => ({ ...jest.requireActual("nativewind"), colorScheme: { set: jest.fn() } }));
jest.mock("expo-haptics", () => ({ selectionAsync: jest.fn(() => Promise.resolve()) }));
jest.mock("@/lib/api-client", () => ({ apiFetch: jest.fn() }));

const set = colorScheme.set as jest.Mock;
const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

function wrap(children: ReactNode) {
  return (
    <SafeAreaProvider initialMetrics={METRICS}>
      <AppearanceProvider>{children}</AppearanceProvider>
    </SafeAreaProvider>
  );
}

function checked(testID: string) {
  return screen.getByTestId(testID).props.accessibilityState?.checked;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  set.mockReset();
  (Haptics.selectionAsync as jest.Mock).mockClear();
});

describe("Appearance screen", () => {
  it("loading: a skeleton until the saved choice has been read", async () => {
    let release: (v: string | null) => void = () => {};
    // The storage mock's functions are jest.fn()s: queue one-off behaviour
    // with *Once rather than spyOn + mockRestore (which would wipe them).
    (AsyncStorage.getItem as jest.Mock).mockImplementationOnce(() => new Promise<string | null>((r) => (release = r)));
    await render(wrap(<AppearanceScreen />));
    expect(screen.getByTestId("skeleton")).toBeTruthy();
    expect(screen.queryByTestId("appearance-options")).toBeNull();
    await act(async () => release(null));
    expect(screen.getByTestId("appearance-options")).toBeTruthy();
  });

  it("success (nothing saved yet): three radios, Match phone chosen, no override applied", async () => {
    await render(wrap(<AppearanceScreen />));
    const group = await screen.findByTestId("appearance-options");
    expect(group.props).toMatchObject({ accessibilityRole: "radiogroup", accessibilityLabel: "Appearance" });
    expect(screen.getAllByRole("radio").map((r) => r.props.accessibilityLabel)).toEqual(["Match phone", "Light", "Dark"]);
    expect(checked("appearance-system")).toBe(true);
    expect(checked("appearance-light")).toBe(false);
    expect(checked("appearance-dark")).toBe(false);
    expect(screen.getByText("Uses your phone's light or dark setting. Now light.")).toBeTruthy();
    expect(screen.getByText("Saved on this phone only. It stays the same when you sign out.")).toBeTruthy();
    expect(set).not.toHaveBeenCalled();
  });

  it("choosing Dark applies it at once, app-wide, and saves it on the phone", async () => {
    await render(wrap(<AppearanceScreen />));
    await fireEvent.press(await screen.findByTestId("appearance-dark"));
    expect(set).toHaveBeenLastCalledWith("dark");
    expect(checked("appearance-dark")).toBe(true);
    expect(checked("appearance-system")).toBe(false);
    expect(screen.getByTestId("appearance-dark-mark", { includeHiddenElements: true })).toBeTruthy();
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBe("dark");
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("appearance-save-failed")).toBeNull();
  });

  it("choosing Match phone again removes the override", async () => {
    await AsyncStorage.setItem(STORAGE_KEY, "light");
    await render(wrap(<AppearanceScreen />));
    await fireEvent.press(await screen.findByTestId("appearance-system"));
    expect(set).toHaveBeenLastCalledWith("system");
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBe("system");
  });

  it("tapping the current choice does nothing (no haptic, no write)", async () => {
    await render(wrap(<AppearanceScreen />));
    await fireEvent.press(await screen.findByTestId("appearance-system"));
    expect(set).not.toHaveBeenCalled();
    expect(Haptics.selectionAsync).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("error: the phone couldn't save it -> says so plainly, the look still changes", async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error("full"));
    await render(wrap(<AppearanceScreen />));
    await fireEvent.press(await screen.findByTestId("appearance-light"));
    expect(set).toHaveBeenLastCalledWith("light");
    expect(screen.getByText("Couldn't save your choice")).toBeTruthy();
    expect(screen.getByText(/Try choosing it again/)).toBeTruthy();
    // Trying again clears the message.
    await fireEvent.press(screen.getByTestId("appearance-dark"));
    expect(screen.queryByTestId("appearance-save-failed")).toBeNull();
  });

  it("no access check: a device-only setting, open to everyone, never calls the server", async () => {
    // (There is no permission-denied state: nothing here is read from or sent to FFSA Hub.)
    await render(wrap(<AppearanceScreen />));
    await fireEvent.press(await screen.findByTestId("appearance-dark"));
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("every choice is a radio whose hint is its description (state comes from the role)", async () => {
    await render(wrap(<AppearanceScreen />));
    for (const r of await screen.findAllByRole("radio")) {
      expect(r.props.accessibilityHint).toBeTruthy();
    }
    expect(screen.getByTestId("appearance-light").props.accessibilityHint).toBe("Always light, whatever your phone is set to.");
    expect(screen.getByTestId("appearance-system").props.accessibilityState).toMatchObject({ checked: true });
  });
});

describe("AppearanceProvider", () => {
  it("restores a saved choice and applies it before reporting ready", async () => {
    await AsyncStorage.setItem(STORAGE_KEY, "dark");
    const seen: { ready: boolean; pref: string; setCalls: number }[] = [];
    function Spy() {
      const a = useAppearance();
      seen.push({ ready: a.ready, pref: a.preference, setCalls: set.mock.calls.length });
      return null;
    }
    await render(wrap(<Spy />));
    expect(seen[0]).toEqual({ ready: false, pref: "system", setCalls: 0 });
    const firstReady = seen.find((s) => s.ready)!;
    expect(firstReady.pref).toBe("dark");
    expect(firstReady.setCalls).toBe(1);
    expect(set).toHaveBeenCalledWith("dark");
  });

  it("outside the provider: the phone's setting, and choosing is a no-op", async () => {
    let state: ReturnType<typeof useAppearance> | null = null;
    function Spy() {
      state = useAppearance();
      return null;
    }
    await render(<Spy />);
    expect(state!.ready).toBe(true);
    expect(state!.preference).toBe("system");
    expect(await state!.setPreference("dark")).toBe(false);
    expect(set).not.toHaveBeenCalled();
  });
});
