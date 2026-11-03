import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Linking } from "react-native";

import { MeProvider } from "@/features/shell";
import { ApiError } from "@/lib/api";
import { apiFetch } from "@/lib/api-client";
import { supabase } from "@/lib/supabase";

import MeScreen from "../../../../app/(app)/me/index";
import NotificationPrefsScreen from "../../../../app/(app)/me/notifications";
import { apiRoutes, makeMe } from "../../../../test/fixtures";
import { mockPhone } from "../__fixtures__/native-mocks";
import { PushProvider } from "../provider";
import { readPushState, setRegistration, updatePerson } from "../store";

// Me > Notification settings, push section, on the real screen inside the
// real providers: every state a person can meet, plus sign-out revoking the
// phone before the session goes.

jest.mock("expo-notifications", () => jest.requireActual("../__fixtures__/native-mocks").notificationsModule);
jest.mock("expo-device", () => jest.requireActual("../__fixtures__/native-mocks").deviceModule);
jest.mock("expo-constants", () => jest.requireActual("../__fixtures__/native-mocks").constantsModule);
jest.mock("@/lib/api-client", () => ({ apiFetch: jest.fn() }));
const mockOrder: string[] = [];
jest.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      signOut: jest.fn(async () => {
        mockOrder.push("signOut");
        return { error: null };
      }),
    },
  },
}));
jest.mock("@/auth/session-provider", () => ({
  useSession: () => ({ status: "signedIn", session: { user: { id: "u1" } } }),
}));
const mockRouter = { navigate: jest.fn(), push: jest.fn(), back: jest.fn() };
jest.mock("expo-router", () => ({ useRouter: () => mockRouter, usePathname: () => "/me/notifications" }));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn().mockResolvedValue({ type: "dismiss" }) }));
jest.mock("react-native-safe-area-context", () => {
  const actual = jest.requireActual("react-native-safe-area-context");
  return { ...actual, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

const mockFetch = apiFetch as unknown as jest.Mock;

const CATEGORIES = [
  { key: "booking_requests", label: "Booking requests to approve", description: "When someone asks to book a space you approve." },
  { key: "booking_updates", label: "Your bookings", description: "When a booking you asked for is approved or declined." },
];

type Init = { method?: string; body?: unknown };
let devices: unknown;
let prefsGet: unknown;
let prefsPut: unknown;
let puts: unknown[];

function routes() {
  return apiRoutes({
    "/api/me": makeMe(),
    "/api/profile/notification-preferences": { modules: [], mutedModules: [] },
    "/api/devices": (init?: Init) => {
      mockOrder.push(`devices:${init?.method}`);
      return devices;
    },
    "/api/devices/preferences": (init?: Init) => {
      if (init?.method === "PUT") {
        puts.push(init.body);
        return prefsPut;
      }
      return prefsGet;
    },
  });
}

const wrap = (ui: ReactNode) => (
  <MeProvider>
    <PushProvider>{ui}</PushProvider>
  </MeProvider>
);

async function renderPrefs() {
  await render(wrap(<NotificationPrefsScreen />));
}

beforeEach(async () => {
  await AsyncStorage.clear();
  mockPhone.reset();
  mockFetch.mockReset();
  mockFetch.mockImplementation(routes());
  devices = { ok: true };
  prefsGet = { categories: CATEGORIES, muted: ["booking_updates"] };
  prefsPut = { ok: true };
  puts = [];
  mockOrder.length = 0;
});

async function pushOn() {
  await updatePerson("u1", { enabled: true });
  mockPhone.permission = "granted";
}

describe("Me > Notifications: push section", () => {
  it("loading: says it's checking this phone", async () => {
    mockPhone.permissionHangs = true;
    await renderPrefs();
    expect(screen.getByTestId("push-status").props.children).toBe("Checking this phone");
    expect(screen.getByRole("switch", { name: "Push notifications on this phone" }).props.accessibilityState).toMatchObject({
      disabled: true,
      busy: true,
    });
  });

  it("on: master switch on, status in words, category switches from the server", async () => {
    await pushOn();
    await renderPrefs();
    await waitFor(() => expect(screen.getByTestId("push-status").props.children).toBe("On"));
    const master = screen.getByRole("switch", { name: "Push notifications on this phone" });
    expect(master.props.accessibilityState).toMatchObject({ checked: true });
    const requests = await screen.findByRole("switch", { name: "Booking requests to approve" });
    expect(requests.props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByRole("switch", { name: "Your bookings" }).props.accessibilityState).toMatchObject({ checked: false });
    // The Slack settings keep their own section below.
    expect(screen.getByText("Slack messages")).toBeTruthy();
  });

  it("toggling a category saves the whole list (PUT /api/devices/preferences)", async () => {
    await pushOn();
    await renderPrefs();
    await fireEvent(await screen.findByRole("switch", { name: "Booking requests to approve" }), "valueChange", false);
    await waitFor(() => expect(puts).toEqual([{ muted: ["booking_updates", "booking_requests"] }]));
    await fireEvent(screen.getByRole("switch", { name: "Your bookings" }), "valueChange", true);
    await waitFor(() => expect(puts[1]).toEqual({ muted: ["booking_requests"] }));
  });

  it("a failed save puts the switch back and says why", async () => {
    await pushOn();
    prefsPut = new ApiError("network", "Couldn't reach FFSA Hub.");
    await renderPrefs();
    const sw = await screen.findByRole("switch", { name: "Booking requests to approve" });
    await fireEvent(sw, "valueChange", false);
    expect(await screen.findByText("Couldn't save that change. Check your connection and try again.")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Booking requests to approve" }).props.accessibilityState).toMatchObject({
      checked: true,
    });
  });

  it("categories fail to load: error with a retry", async () => {
    await pushOn();
    prefsGet = new ApiError("network", "Couldn't reach FFSA Hub.");
    await renderPrefs();
    expect(await screen.findByText("Couldn't load your choices. Check your connection and try again.")).toBeTruthy();
    prefsGet = { categories: CATEGORIES, muted: [] };
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("switch", { name: "Your bookings" })).toBeTruthy();
  });

  it("off (never turned on): switch off, no categories, nothing asked of the phone", async () => {
    await renderPrefs();
    await waitFor(() => expect(screen.getByTestId("push-status").props.children).toBe("Off"));
    expect(screen.getByRole("switch", { name: "Push notifications on this phone" }).props.accessibilityState).toMatchObject({
      checked: false,
    });
    expect(screen.queryByRole("switch", { name: "Your bookings" })).toBeNull();
    expect(mockPhone.asked).toBe(0);
  });

  it("turning the switch on explains first, then asks the phone", async () => {
    await renderPrefs();
    await waitFor(() => expect(screen.getByTestId("push-status").props.children).toBe("Off"));
    await fireEvent(screen.getByRole("switch", { name: "Push notifications on this phone" }), "valueChange", true);
    expect(await screen.findByText("Turn on notifications?")).toBeTruthy();
    expect(mockPhone.asked).toBe(0);
    await fireEvent.press(screen.getByRole("button", { name: "Turn on notifications" }));
    await waitFor(() => expect(screen.getByTestId("push-status").props.children).toBe("On"));
    expect(mockPhone.asked).toBe(1);
  });

  it("permission denied in phone Settings: says so, with Open Settings", async () => {
    await updatePerson("u1", { enabled: true });
    mockPhone.permission = "denied";
    const openSettings = jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);
    await renderPrefs();
    await waitFor(() => expect(screen.getByTestId("push-status").props.children).toBe("Off in your phone's Settings"));
    await fireEvent.press(screen.getByRole("button", { name: "Open Settings" }));
    expect(openSettings).toHaveBeenCalled();
  });

  it("not switched on for this build (no Expo project id): plain message, no switch", async () => {
    mockPhone.projectId = null;
    await renderPrefs();
    expect(await screen.findByText("Notifications are not switched on for this build yet")).toBeTruthy();
    expect(screen.queryByRole("switch", { name: "Push notifications on this phone" })).toBeNull();
  });

  it("server not ready yet (503): plain message, no switch", async () => {
    await pushOn();
    devices = new ApiError("http", "Something went wrong on the server (503). Try again.", 503);
    await renderPrefs();
    expect(await screen.findByText("Notifications are not switched on for FFSA Hub yet")).toBeTruthy();
    expect(screen.queryByRole("switch", { name: "Push notifications on this phone" })).toBeNull();
  });

  it("registration error: says so, with Try again", async () => {
    await pushOn();
    devices = new ApiError("network", "Couldn't reach FFSA Hub.");
    await renderPrefs();
    expect(await screen.findByText("Check your connection and try again.")).toBeTruthy();
    devices = { ok: true };
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByTestId("push-status").props.children).toBe("On"));
  });
});

describe("Me > Sign out", () => {
  it("revokes this phone with the server BEFORE the session is cleared", async () => {
    await setRegistration({ token: "ExponentPushToken[phone-one-0001]", appVersion: "1.0.0", userId: "u1" });
    await render(wrap(<MeScreen />));
    await fireEvent.press(await screen.findByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(supabase.auth.signOut).toHaveBeenCalled());
    expect(mockOrder.filter((o) => o !== "devices:POST")).toEqual(["devices:DELETE", "signOut"]);
    expect((await readPushState()).registration).toBeNull();
  });

  it("still signs out if the server can't be reached", async () => {
    await setRegistration({ token: "ExponentPushToken[phone-one-0001]", appVersion: "1.0.0", userId: "u1" });
    devices = new ApiError("network", "Couldn't reach FFSA Hub.");
    await render(wrap(<MeScreen />));
    await fireEvent.press(await screen.findByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: "local" }));
  });
});
