// Me › Settings: the "Lock with Face ID" switch. Shown per hardware and
// enrolment; turning it on asks for Face ID once; cancel/failure leaves it off.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as LocalAuthentication from "expo-local-authentication";
import { AccessibilityInfo } from "react-native";

import { auditTappables } from "@/lib/a11y/testing";

import { LockProvider } from "../LockProvider";
import { LockSettingRow } from "../LockSettingRow";
import { LOCK_STORAGE_KEY } from "../storage";

jest.mock("@/auth/session-provider", () => ({ useSession: () => ({ status: "signedIn", session: { user: { id: "u1" } } }) }));
jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: "success", Error: "error" },
}));
jest.spyOn(AccessibilityInfo, "announceForAccessibilityWithOptions").mockImplementation(() => {});

const auth = LocalAuthentication.authenticateAsync as jest.Mock;
const hasHardware = LocalAuthentication.hasHardwareAsync as jest.Mock;
const enrolled = LocalAuthentication.isEnrolledAsync as jest.Mock;
const types = LocalAuthentication.supportedAuthenticationTypesAsync as jest.Mock;

function phone({ hardware = true, enrolledNow = true, kinds = [2] }: { hardware?: boolean; enrolledNow?: boolean; kinds?: number[] } = {}) {
  hasHardware.mockResolvedValue(hardware);
  enrolled.mockResolvedValue(enrolledNow);
  types.mockResolvedValue(kinds);
}

async function mount() {
  await render(
    <LockProvider>
      <LockSettingRow />
    </LockProvider>,
  );
}

const theSwitch = () => screen.getByTestId("lock-switch");

beforeEach(async () => {
  await AsyncStorage.clear();
  auth.mockReset();
  phone();
});

describe("Lock setting row", () => {
  it("Face ID phone: the switch, off by default, named and described", async () => {
    await mount();
    expect(theSwitch().props.accessibilityLabel).toBe("Lock with Face ID");
    expect(theSwitch().props.accessibilityHint).toBe(
      "Asks for Face ID when you open the app, and when you come back after 5 minutes away. Saved on this phone only.",
    );
    expect(theSwitch().props.value).toBe(false);
    expect(screen.getByText("Off", { includeHiddenElements: true })).toBeTruthy();
    expect(auditTappables(screen.container as never)).toEqual([]);
  });

  it.each([
    ["no hardware", { hardware: false }],
    ["nothing enrolled", { enrolledNow: false }],
  ])("%s: no row at all", async (_label, setup) => {
    phone(setup);
    await mount();
    expect(screen.queryByTestId("lock-setting")).toBeNull();
  });

  it("already on but Face ID since removed: the row stays, so it can be switched off", async () => {
    phone({ enrolledNow: false });
    await AsyncStorage.setItem(LOCK_STORAGE_KEY, "on");
    await mount();
    expect(theSwitch().props.value).toBe(true);
  });

  it("Touch ID iPhone: says Touch ID", async () => {
    phone({ kinds: [1] });
    await mount();
    expect(theSwitch().props.accessibilityLabel).toBe("Lock with Touch ID");
  });

  it("turning on: asks for Face ID once, then it's on and saved", async () => {
    await mount();
    auth.mockResolvedValueOnce({ success: true });
    await act(async () => fireEvent(theSwitch(), "valueChange", true));
    expect(auth).toHaveBeenCalledTimes(1);
    expect(theSwitch().props.value).toBe(true);
    expect(screen.getByText("On", { includeHiddenElements: true })).toBeTruthy();
    expect(await AsyncStorage.getItem(LOCK_STORAGE_KEY)).toBe("on");
  });

  it("turning on, cancelled: stays off, nothing to fix", async () => {
    await mount();
    auth.mockResolvedValueOnce({ success: false, error: "user_cancel" });
    await act(async () => fireEvent(theSwitch(), "valueChange", true));
    expect(theSwitch().props.value).toBe(false);
    expect(screen.queryByTestId("lock-setting-failed")).toBeNull();
    expect(await AsyncStorage.getItem(LOCK_STORAGE_KEY)).toBeNull();
  });

  it("turning on, failed: stays off and says to try again", async () => {
    await mount();
    auth.mockResolvedValueOnce({ success: false, error: "authentication_failed" });
    await act(async () => fireEvent(theSwitch(), "valueChange", true));
    expect(theSwitch().props.value).toBe(false);
    expect(screen.getByText("Couldn't turn it on")).toBeTruthy();
    expect(screen.getByText("Your phone didn't confirm it was you. Try the switch again.")).toBeTruthy();
  });

  it("turning off: no Face ID asked, off and forgotten", async () => {
    await AsyncStorage.setItem(LOCK_STORAGE_KEY, "on");
    await mount();
    await act(async () => fireEvent(theSwitch(), "valueChange", false));
    expect(auth).not.toHaveBeenCalled();
    expect(theSwitch().props.value).toBe(false);
    expect(await AsyncStorage.getItem(LOCK_STORAGE_KEY)).toBeNull();
  });
});
