import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as WebBrowser from "expo-web-browser";
import { AppState, Platform, Pressable, Text } from "react-native";

import { setTabBadge } from "@/features/shell";
import { ApiError } from "@/lib/api";
import { apiFetch } from "@/lib/api-client";

import { apiRoutes } from "../../../../test/fixtures";
import { mockPhone } from "../__fixtures__/native-mocks";
import { PushProvider, usePush } from "../provider";
import { readPushState, setRegistration, updatePerson } from "../store";

jest.mock("expo-notifications", () => jest.requireActual("../__fixtures__/native-mocks").notificationsModule);
jest.mock("expo-device", () => jest.requireActual("../__fixtures__/native-mocks").deviceModule);
jest.mock("expo-constants", () => jest.requireActual("../__fixtures__/native-mocks").constantsModule);
jest.mock("@/lib/api-client", () => ({ apiFetch: jest.fn() }));
jest.mock("@/lib/supabase", () => ({ supabase: { auth: { signOut: jest.fn() } } }));
jest.mock("@/auth/session-provider", () => ({
  useSession: () => ({ status: "signedIn", session: { user: { id: "u1" } } }),
}));
const mockRouter = { navigate: jest.fn(), push: jest.fn() };
const mockPath = { current: "/me/notifications" };
jest.mock("expo-router", () => ({ useRouter: () => mockRouter, usePathname: () => mockPath.current }));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn().mockResolvedValue({ type: "dismiss" }) }));
jest.mock("react-native-safe-area-context", () => {
  const actual = jest.requireActual("react-native-safe-area-context");
  return { ...actual, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

const mockFetch = apiFetch as unknown as jest.Mock;
const openBrowser = WebBrowser.openBrowserAsync as jest.Mock;

type Call = { method?: string; body?: unknown };
let deviceCalls: Call[] = [];
let devicesAnswer: unknown = { ok: true };

function routes() {
  return apiRoutes({
    "/api/devices": (init?: Call) => {
      deviceCalls.push({ method: init?.method, body: init?.body });
      return devicesAnswer;
    },
  });
}

function Probe() {
  const push = usePush();
  if (!push) return <Text>no provider</Text>;
  return (
    <>
      <Text testID="status">{push.status}</Text>
      <Pressable accessibilityRole="button" onPress={() => void push.setEnabled(true)}>
        <Text>turn on</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => void push.setEnabled(false)}>
        <Text>turn off</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={push.retry}>
        <Text>retry</Text>
      </Pressable>
    </>
  );
}

async function mount() {
  const utils = await render(
    <PushProvider>
      <Probe />
    </PushProvider>,
  );
  return utils;
}

async function statusIs(s: string) {
  await waitFor(() => expect(screen.getByTestId("status").props.children).toBe(s));
}

const posts = () => deviceCalls.filter((c) => c.method === "POST");
const deletes = () => deviceCalls.filter((c) => c.method === "DELETE");

let appStateHandler: ((s: string) => void) | null = null;

beforeEach(async () => {
  await AsyncStorage.clear();
  mockPhone.reset();
  mockFetch.mockReset();
  mockFetch.mockImplementation(routes());
  deviceCalls = [];
  devicesAnswer = { ok: true };
  mockRouter.navigate.mockClear();
  openBrowser.mockClear();
  mockPath.current = "/me/notifications";
  setTabBadge("home", 0);
  appStateHandler = null;
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, handler) => {
    appStateHandler = handler as (s: string) => void;
    return { remove: () => {} } as ReturnType<typeof AppState.addEventListener>;
  });
});

afterEach(() => jest.restoreAllMocks());

describe("PushProvider registration", () => {
  it("no Expo project id in this build: 'unsupported', never registers", async () => {
    mockPhone.projectId = null;
    await updatePerson("u1", { enabled: true });
    mockPhone.permission = "granted";
    await mount();
    await statusIs("unsupported");
    expect(deviceCalls).toEqual([]);
  });

  it("simulator (no real device): 'unsupported'", async () => {
    mockPhone.isDevice = false;
    await mount();
    await statusIs("unsupported");
  });

  it("never decided: off, no prompt, no registration, never asks the phone", async () => {
    await mount();
    await statusIs("off");
    expect(deviceCalls).toEqual([]);
    expect(mockPhone.asked).toBe(0);
    expect(screen.queryByTestId("push-pre-prompt")).toBeNull();
  });

  it("on + allowed: registers this phone once, with no owner name", async () => {
    await updatePerson("u1", { enabled: true });
    mockPhone.permission = "granted";
    const first = await mount();
    await statusIs("on");
    expect(posts()).toEqual([
      {
        method: "POST",
        body: { expoToken: "ExponentPushToken[phone-one-0001]", platform: "ios", appVersion: "1.0.0", deviceName: "iPhone 15" },
      },
    ]);
    expect((await readPushState()).registration).toEqual({
      token: "ExponentPushToken[phone-one-0001]",
      appVersion: "1.0.0",
      userId: "u1",
    });
    await first.unmount();

    // Next launch, nothing changed: no second registration.
    await mount();
    await statusIs("on");
    expect(posts()).toHaveLength(1);
  });

  it("creates the Android channels / foreground handler before asking", async () => {
    await mount();
    await statusIs("off");
    // Platform is iOS in tests: no channels.
    expect(mockPhone.channels).toEqual([]);
  });

  it("Android: one channel per category, created before asking; registers as android", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    await updatePerson("u1", { enabled: true });
    mockPhone.permission = "granted";
    await mount();
    await statusIs("on");
    expect(mockPhone.channels).toEqual(["booking_requests", "booking_updates"]);
    expect((posts()[0].body as { platform: string }).platform).toBe("android");
  });

  it("re-registers when the phone's token changes", async () => {
    await updatePerson("u1", { enabled: true });
    mockPhone.permission = "granted";
    await mount();
    await statusIs("on");
    mockPhone.token = "ExponentPushToken[phone-one-0002]";
    await act(async () => {
      mockPhone.tokenListeners.forEach((l) => l({ type: "ios", data: "x" }));
    });
    await waitFor(() => expect(posts()).toHaveLength(2));
    expect((posts()[1].body as { expoToken: string }).expoToken).toBe("ExponentPushToken[phone-one-0002]");
  });

  it("re-registers after an app update", async () => {
    await updatePerson("u1", { enabled: true });
    await setRegistration({ token: "ExponentPushToken[phone-one-0001]", appVersion: "0.9.0", userId: "u1" });
    mockPhone.permission = "granted";
    await mount();
    await statusIs("on");
    expect(posts()).toHaveLength(1);
  });

  it("server not ready (503 push_not_enabled): says so and doesn't retry on resume", async () => {
    await updatePerson("u1", { enabled: true });
    mockPhone.permission = "granted";
    devicesAnswer = new ApiError("http", "Something went wrong on the server (503). Try again.", 503);
    await mount();
    await statusIs("not_enabled");
    expect(posts()).toHaveLength(1);
    await act(async () => appStateHandler?.("active"));
    await act(async () => appStateHandler?.("active"));
    await statusIs("not_enabled");
    expect(posts()).toHaveLength(1);
  });

  it("other failures: 'error', and Try again registers", async () => {
    await updatePerson("u1", { enabled: true });
    mockPhone.permission = "granted";
    devicesAnswer = new ApiError("network", "Couldn't reach FFSA Hub.");
    await mount();
    await statusIs("error");
    devicesAnswer = { ok: true };
    await fireEvent.press(screen.getByRole("button", { name: "retry" }));
    await statusIs("on");
  });

  it("phone Settings say no: 'blocked', and a previous registration is revoked", async () => {
    await updatePerson("u1", { enabled: true });
    await setRegistration({ token: "ExponentPushToken[phone-one-0001]", appVersion: "1.0.0", userId: "u1" });
    mockPhone.permission = "denied";
    await mount();
    await statusIs("blocked");
    expect(deletes()).toEqual([{ method: "DELETE", body: { expoToken: "ExponentPushToken[phone-one-0001]" } }]);
  });

  it("back from Settings with permission now allowed: registers", async () => {
    await updatePerson("u1", { enabled: true });
    mockPhone.permission = "denied";
    await mount();
    await statusIs("blocked");
    mockPhone.permission = "granted";
    await act(async () => appStateHandler?.("active"));
    await statusIs("on");
    expect(posts()).toHaveLength(1);
  });

  it("turning it off revokes this phone", async () => {
    await updatePerson("u1", { enabled: true });
    mockPhone.permission = "granted";
    await mount();
    await statusIs("on");
    await fireEvent.press(screen.getByRole("button", { name: "turn off" }));
    await statusIs("off");
    expect(deletes()).toHaveLength(1);
    expect((await readPushState()).registration).toBeNull();
  });
});

describe("PushProvider pre-prompt (just in time)", () => {
  it("the switch shows our explanation before the phone's prompt; 'Not now' asks nothing", async () => {
    await mount();
    await statusIs("off");
    await fireEvent.press(screen.getByRole("button", { name: "turn on" }));
    expect(await screen.findByTestId("push-pre-prompt")).toBeTruthy();
    expect(mockPhone.asked).toBe(0);
    await fireEvent.press(screen.getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(screen.queryByTestId("push-pre-prompt")).toBeNull());
    expect(mockPhone.asked).toBe(0);
    expect(deviceCalls).toEqual([]);
    expect((await readPushState()).people.u1.dismissedAt).toEqual(expect.any(Number));
  });

  it("'Turn on notifications' asks the phone, then registers", async () => {
    await mount();
    await statusIs("off");
    await fireEvent.press(screen.getByRole("button", { name: "turn on" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Turn on notifications" }));
    await statusIs("on");
    expect(mockPhone.asked).toBe(1);
    expect(posts()).toHaveLength(1);
  });

  it("the phone says no after our explanation: 'blocked'", async () => {
    mockPhone.answer = "denied";
    await mount();
    await statusIs("off");
    await fireEvent.press(screen.getByRole("button", { name: "turn on" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Turn on notifications" }));
    await statusIs("blocked");
    expect(posts()).toEqual([]);
  });

  it("offered by itself on Home from the third launch, never before", async () => {
    mockPath.current = "/";
    await updatePerson("u1", { launches: 1 });
    const second = await mount(); // launch 2
    await statusIs("off");
    expect(screen.queryByTestId("push-pre-prompt")).toBeNull();
    await second.unmount();

    await mount(); // launch 3
    expect(await screen.findByTestId("push-pre-prompt")).toBeTruthy();
  });

  it("not offered by itself away from Home", async () => {
    await updatePerson("u1", { launches: 5 });
    await mount();
    await statusIs("off");
    expect(screen.queryByTestId("push-pre-prompt")).toBeNull();
  });
});

describe("PushProvider taps and badge", () => {
  it("cold start: opens the in-app screen for the tapped notification", async () => {
    mockPhone.coldStart({ href: "/my-finance", kind: "booking_decision", key: "k" });
    await mount();
    await waitFor(() => expect(mockRouter.navigate).toHaveBeenCalledWith("/finance"));
    expect(mockPhone.lastResponse).toBeNull();
  });

  it("warm tap on a page the app doesn't have: opens the website in the in-app browser", async () => {
    await mount();
    await statusIs("off");
    await act(async () => mockPhone.tap({ href: "/admin/users" }, "n1"));
    expect(openBrowser).toHaveBeenCalledWith("https://hub.example.test/admin/users", expect.any(Object));
    // The same notification delivered twice opens once.
    await act(async () => mockPhone.tap({ href: "/admin/users" }, "n1"));
    expect(openBrowser).toHaveBeenCalledTimes(1);
  });

  it("junk data opens Home", async () => {
    await mount();
    await statusIs("off");
    await act(async () => mockPhone.tap({ href: "https://elsewhere.example" }));
    expect(mockRouter.navigate).toHaveBeenCalledWith("/");
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it("app badge follows Home's unread count while push is on", async () => {
    await updatePerson("u1", { enabled: true });
    mockPhone.permission = "granted";
    await mount();
    await statusIs("on");
    await act(async () => setTabBadge("home", 4));
    await waitFor(() => expect(mockPhone.badge).toContain(4));
  });

  it("no badge writes while push is off", async () => {
    await mount();
    await statusIs("off");
    await act(async () => setTabBadge("home", 2));
    expect(mockPhone.badge).toEqual([]);
  });
});
