// Frame 1.6: the lock screen. Auto-prompt once, Unlock, Sign out instead,
// what it says when unlocking fails, a11y, largest text, light and dark.

import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { AccessibilityInfo, StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { auditTappables, largeTextProblems, tappableSizes } from "@/lib/a11y/testing";
import { colors } from "@/theme/tokens";

import { LockScreen, PrivacyCover, type LockScreenProps } from "../LockScreen";
import type { UnlockOutcome } from "../logic";

let mockScheme: "light" | "dark" = "light";
jest.mock("@/theme/use-theme", () => ({
  ...jest.requireActual("@/theme/use-theme"),
  useTheme: () => jest.requireActual("@/theme/use-theme").themeFor(mockScheme),
}));
jest.spyOn(AccessibilityInfo, "announceForAccessibilityWithOptions").mockImplementation(() => {});

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const show = (ui: ReactElement) => render(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
const audit = () => auditTappables(screen.container as never);

function props(over: Partial<LockScreenProps> = {}): LockScreenProps {
  return {
    name: "Gabriël",
    email: "gabriel@example.com",
    kind: "faceId",
    onUnlock: jest.fn(async (): Promise<UnlockOutcome> => "cancelled"),
    onSignOut: jest.fn(async () => {}),
    ...over,
  };
}

beforeEach(() => {
  mockScheme = "light";
});

describe("Lock screen", () => {
  it("shows the mark, who is signed in, Unlock and Sign out instead", async () => {
    await show(<LockScreen {...props()} />);
    expect(screen.getByRole("header", { name: "FFSA Hub is locked" })).toBeTruthy();
    expect(screen.getByText("Gabriël · gabriel@example.com")).toBeTruthy();
    expect(screen.getByLabelText("Signed in as Gabriël, gabriel@example.com")).toBeTruthy();
    // The mark is decoration: hidden from screen readers.
    expect(screen.queryByTestId("lock-mark")).toBeNull();
    expect(screen.getByTestId("lock-mark", { includeHiddenElements: true })).toBeTruthy();
    const unlock = screen.getByRole("button", { name: "Unlock with Face ID" });
    expect(unlock.props.accessibilityHint).toBe("Your phone's passcode works too.");
    expect(screen.getByText("Unlock")).toBeTruthy();
    const signOut = screen.getByRole("button", { name: "Sign out instead" });
    expect(signOut.props.accessibilityHint).toBe("Signs you out on this phone only. You stay signed in on the website.");
    expect(screen.getByTestId("lock-screen").props.accessibilityViewIsModal).toBe(true);
    expect(audit()).toEqual([]);
  });

  it("before /api/me answers: the email alone", async () => {
    await show(<LockScreen {...props({ name: null })} />);
    expect(screen.getByText("gabriel@example.com")).toBeTruthy();
  });

  it("asks for Face ID once as it appears; after a cancel it waits for Unlock", async () => {
    const p = props();
    await show(<LockScreen {...p} />);
    expect(p.onUnlock).toHaveBeenCalledTimes(1);
    // Nothing to fix after a cancel: no banner, Unlock is ready.
    expect(screen.queryByTestId("lock-failed")).toBeNull();
    await act(async () => {});
    expect(p.onUnlock).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByRole("button", { name: "Unlock with Face ID" }));
    expect(p.onUnlock).toHaveBeenCalledTimes(2);
  });

  it("Unlock: busy while the phone asks", async () => {
    let answer: (o: UnlockOutcome) => void = () => {};
    const onUnlock = jest.fn(() => new Promise<UnlockOutcome>((r) => (answer = r)));
    await show(<LockScreen {...props({ onUnlock })} />);
    expect(screen.getByRole("button", { name: "Unlock with Face ID" }).props.accessibilityState).toMatchObject({ busy: true });
    await act(async () => answer("cancelled"));
    expect(screen.getByRole("button", { name: "Unlock with Face ID" }).props.accessibilityState).toMatchObject({ busy: false });
  });

  it("a failure says so and how to try again", async () => {
    await show(<LockScreen {...props({ onUnlock: jest.fn(async (): Promise<UnlockOutcome> => "failed") })} />);
    expect(await screen.findByText("Couldn't unlock")).toBeTruthy();
    expect(screen.getByText("Tap Unlock to try again.")).toBeTruthy();
  });

  it("biometrics and passcode gone from the phone: says to sign out and in again", async () => {
    await show(<LockScreen {...props({ onUnlock: jest.fn(async (): Promise<UnlockOutcome> => "unavailable") })} />);
    expect(await screen.findByText("Can't unlock with this phone")).toBeTruthy();
  });

  it("Sign out instead runs the sign-out", async () => {
    const p = props();
    await show(<LockScreen {...p} />);
    await fireEvent.press(screen.getByRole("button", { name: "Sign out instead" }));
    expect(p.onSignOut).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["touchId", "Touch ID"],
    ["fingerprint", "Fingerprint"],
    ["faceUnlock", "Face unlock"],
  ] as const)("names the phone's own biometrics: %s", async (kind, word) => {
    await show(<LockScreen {...props({ kind })} />);
    expect(screen.getByRole("button", { name: `Unlock with ${word}` })).toBeTruthy();
  });

  it("targets are at least 44pt", async () => {
    await show(<LockScreen {...props()} />);
    for (const t of tappableSizes(screen.container as never, StyleSheet.flatten as never)) {
      expect(t.minHeight ?? 0).toBeGreaterThanOrEqual(44);
    }
  });

  it.each(["light", "dark"] as const)("%s: page and tile from the theme (yellow is a fill, ink on it)", async (scheme) => {
    mockScheme = scheme;
    await show(<LockScreen {...props()} />);
    const page = StyleSheet.flatten(screen.getByTestId("lock-screen").props.style);
    expect(page.backgroundColor).toBe(colors[scheme].bg);
    const tile = StyleSheet.flatten(screen.getByTestId("lock-mark", { includeHiddenElements: true }).props.style);
    expect(tile.backgroundColor).toBe(colors[scheme].accent);
    expect(screen.toJSON()).toMatchSnapshot();
  });

  it("largest text on a 360pt phone: nothing capped or clipped", async () => {
    const dims = jest
      .spyOn(jest.requireActual<typeof import("react-native")>("react-native"), "useWindowDimensions")
      .mockReturnValue({ width: 360, height: 780, scale: 3, fontScale: 3.1 });
    await show(<LockScreen {...props()} />);
    expect(largeTextProblems(screen.container as never)).toEqual([]);
    expect(audit()).toEqual([]);
    dims.mockRestore();
  });
});

describe("Privacy cover", () => {
  it("shows only the mark, hidden from screen readers", async () => {
    await show(<PrivacyCover />);
    expect(screen.queryByText("FFSA Hub is locked")).toBeNull();
    expect(screen.getByTestId("lock-cover", { includeHiddenElements: true })).toBeTruthy();
    expect(audit()).toEqual([]);
  });
});
