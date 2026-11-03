import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, render, screen } from "@testing-library/react-native";
import * as WebBrowser from "expo-web-browser";
import type { ReactNode } from "react";

import { MeProvider } from "@/features/shell";
import { ApiError } from "@/lib/api";
import { apiFetch } from "@/lib/api-client";
import { supabase } from "@/lib/supabase";

import { apiRoutes, makeMe } from "../../test/fixtures";
import EditProfileScreen from "../(app)/me/edit";
import MeScreen from "../(app)/me/index";
import NotificationPrefsScreen from "../(app)/me/notifications";

jest.mock("@/lib/api-client", () => ({ apiFetch: jest.fn() }));
jest.mock("@/auth/session-provider", () => ({
  useSession: () => ({ status: "signedIn", session: { user: { id: "u1" } } }),
}));
const mockRouter = { navigate: jest.fn(), push: jest.fn(), back: jest.fn() };
jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn().mockResolvedValue({ type: "dismiss" }) }));
jest.mock("expo-constants", () => ({ __esModule: true, default: { expoConfig: { version: "1.2.3" } } }));

const mockProfileRow = { current: { data: { first_name: "Johanna", last_name: "Smit", phone: "+27 82 000 0000" }, error: null as unknown } };
jest.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { signOut: jest.fn().mockResolvedValue({ error: null }) },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => mockProfileRow.current }) }),
    }),
  },
}));

const mockFetch = apiFetch as unknown as jest.Mock;
const openBrowser = WebBrowser.openBrowserAsync as jest.Mock;
const wrap = (ui: ReactNode) => <MeProvider>{ui}</MeProvider>;

beforeEach(() => {
  mockFetch.mockReset();
  openBrowser.mockClear();
  Object.values(mockRouter).forEach((f) => f.mockClear());
  (supabase.auth.signOut as jest.Mock).mockClear();
  mockProfileRow.current = { data: { first_name: "Johanna", last_name: "Smit", phone: "+27 82 000 0000" }, error: null };
});

describe("Me", () => {
  const ME = makeMe({
    roles: [
      { name: "staff", scopeType: null, scopeId: null },
      { name: "team_leader", scopeType: "outreach_team", scopeId: "t1" },
    ],
  });

  it("loading: skeleton until /api/me answers", async () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));
    await render(wrap(<MeScreen />));
    expect(screen.getByLabelText("Loading your profile")).toBeTruthy();
  });

  it("success: name, email, readable roles, version", async () => {
    mockFetch.mockImplementation(apiRoutes({ "/api/me": ME }));
    await render(wrap(<MeScreen />));
    expect(await screen.findByRole("header", { name: "Johanna Smit" })).toBeTruthy();
    expect(screen.getByText("jo@example.org")).toBeTruthy();
    expect(screen.getByText("Staff · Team leader")).toBeTruthy();
    expect(screen.getByLabelText("App version: 1.2.3")).toBeTruthy();
    expect(screen.getByLabelText(/^Appearance: Follows your phone's setting/)).toBeTruthy();
  });

  it("empty: someone with no roles yet", async () => {
    mockFetch.mockImplementation(apiRoutes({ "/api/me": makeMe({ roles: [] }) }));
    await render(wrap(<MeScreen />));
    expect(await screen.findByText("No roles yet")).toBeTruthy();
  });

  it("error: plain message and retry", async () => {
    mockFetch.mockRejectedValueOnce(new ApiError("network", "Couldn't reach FFSA Hub. Check your connection and try again."));
    mockFetch.mockImplementation(apiRoutes({ "/api/me": ME }));
    await render(wrap(<MeScreen />));
    expect(await screen.findByText("Couldn't load your profile")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("header", { name: "Johanna Smit" })).toBeTruthy();
  });

  it("permission denied on /api/me: says so, with retry", async () => {
    mockFetch.mockRejectedValue(new ApiError("forbidden", "You don't have access to this.", 403));
    await render(wrap(<MeScreen />));
    expect(await screen.findByText("You don't have access to this.")).toBeTruthy();
  });

  it("web links open in the in-app browser and say so", async () => {
    mockFetch.mockImplementation(apiRoutes({ "/api/me": ME }));
    await render(wrap(<MeScreen />));
    await fireEvent.press(await screen.findByRole("link", { name: "Open full profile on the web. Opens in browser" }));
    await fireEvent.press(screen.getByRole("link", { name: "Privacy policy. Opens in browser" }));
    expect(openBrowser.mock.calls.map((c) => c[0])).toEqual([
      "https://hub.example.test/profile",
      "https://hub.example.test/legal/consent?kind=privacy",
    ]);
  });

  it("account deletion opens the in-app request screen", async () => {
    mockFetch.mockImplementation(apiRoutes({ "/api/me": ME }));
    await render(wrap(<MeScreen />));
    const row = await screen.findByTestId("request-deletion");
    expect(row.props.accessibilityState).toMatchObject({ disabled: false });
    await fireEvent.press(screen.getByRole("button", { name: "Request account deletion" }));
    expect(mockRouter.push).toHaveBeenCalledWith("/me/delete-account");
  });

  it("settings rows push their screens", async () => {
    mockFetch.mockImplementation(apiRoutes({ "/api/me": ME }));
    await render(wrap(<MeScreen />));
    await fireEvent.press(await screen.findByRole("button", { name: "Edit name and phone" }));
    await fireEvent.press(screen.getByRole("button", { name: "Notification settings" }));
    expect(mockRouter.push.mock.calls).toEqual([["/me/edit"], ["/me/notifications"]]);
  });

  it("sign out: this device only, and the saved Home feed is wiped", async () => {
    await AsyncStorage.setItem("ffsa:home-feed:v1:u1", JSON.stringify({ savedAt: "x", items: [] }));
    mockFetch.mockImplementation(apiRoutes({ "/api/me": ME }));
    await render(wrap(<MeScreen />));
    await fireEvent.press(await screen.findByRole("button", { name: "Sign out" }));
    expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(await AsyncStorage.getItem("ffsa:home-feed:v1:u1")).toBeNull();
  });
});

describe("Edit profile", () => {
  it("loads the current values, validates, and saves through PUT /api/profile/update", async () => {
    const saved: unknown[] = [];
    mockFetch.mockImplementation(
      apiRoutes({
        "/api/me": makeMe(),
        "/api/profile/update": (init?: { method?: string; body?: unknown }) => {
          saved.push(init);
          return { success: true };
        },
      }),
    );
    await render(wrap(<EditProfileScreen />));
    const first = await screen.findByLabelText("First name");
    expect(first.props.value).toBe("Johanna");

    await fireEvent.changeText(first, "  ");
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Enter your first name.")).toBeTruthy();
    expect(saved).toHaveLength(0);

    await fireEvent.changeText(screen.getByLabelText("First name"), "Jo ");
    await fireEvent.changeText(screen.getByLabelText("Phone"), "");
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    expect(saved).toEqual([{ method: "PUT", body: { first_name: "Jo", last_name: "Smit", phone: null } }]);
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it("rejects a phone number with letters before calling the server", async () => {
    mockFetch.mockImplementation(apiRoutes({ "/api/me": makeMe() }));
    await render(wrap(<EditProfileScreen />));
    await fireEvent.changeText(await screen.findByLabelText("Phone"), "call me");
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText(/Enter a phone number/)).toBeTruthy();
  });

  it("shows a plain error when saving fails, and stays on the screen", async () => {
    mockFetch.mockImplementation(
      apiRoutes({ "/api/me": makeMe(), "/api/profile/update": new ApiError("http", "Something went wrong on the server (400). Try again.", 400) }),
    );
    await render(wrap(<EditProfileScreen />));
    await screen.findByLabelText("First name");
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Couldn't save your changes. Check your details and try again.")).toBeTruthy();
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  it("load error with retry", async () => {
    mockFetch.mockImplementation(apiRoutes({ "/api/me": makeMe() }));
    mockProfileRow.current = { data: null as never, error: { message: "offline" } };
    await render(wrap(<EditProfileScreen />));
    expect(await screen.findByText(/Couldn't load your details/)).toBeTruthy();
    mockProfileRow.current = { data: { first_name: "A", last_name: "B", phone: "" }, error: null };
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect((await screen.findByLabelText("First name")).props.value).toBe("A");
  });
});

describe("Notification settings", () => {
  const PREFS = {
    modules: [{ key: "prayer_room", label: "Prayer Room", description: "Block-outs and devo set relocations." }],
    mutedModules: [],
  };

  it("loading", async () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));
    await render(<NotificationPrefsScreen />);
    expect(screen.getByLabelText("Loading your notification settings")).toBeTruthy();
  });

  it("success: a labelled switch per group; turning one off saves the mute", async () => {
    const puts: unknown[] = [];
    mockFetch.mockImplementation(
      apiRoutes({
        "/api/profile/notification-preferences": (init?: { method?: string; body?: unknown }) => {
          if (init?.method === "PUT") {
            puts.push(init.body);
            return { ok: true };
          }
          return PREFS;
        },
      }),
    );
    await render(<NotificationPrefsScreen />);
    const sw = await screen.findByRole("switch", { name: "Prayer Room" });
    expect(sw.props.value).toBe(true);
    expect(screen.getByText("On")).toBeTruthy();
    await fireEvent(sw, "valueChange", false);
    expect(puts).toEqual([{ mutedModules: ["prayer_room"] }]);
    expect(await screen.findByText("Off")).toBeTruthy();
  });

  it("a failed save puts the switch back and explains", async () => {
    mockFetch.mockImplementation(
      apiRoutes({
        "/api/profile/notification-preferences": (init?: { method?: string }) =>
          init?.method === "PUT" ? new ApiError("network", "x") : PREFS,
      }),
    );
    await render(<NotificationPrefsScreen />);
    await fireEvent(await screen.findByRole("switch", { name: "Prayer Room" }), "valueChange", false);
    expect(await screen.findByText(/Couldn't save that change/)).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Prayer Room" }).props.value).toBe(true);
  });

  it("empty: nothing to turn off", async () => {
    mockFetch.mockImplementation(apiRoutes({ "/api/profile/notification-preferences": { modules: [], mutedModules: [] } }));
    await render(<NotificationPrefsScreen />);
    expect(await screen.findByText("Nothing to turn off")).toBeTruthy();
  });

  it("error with retry", async () => {
    let n = 0;
    mockFetch.mockImplementation(
      apiRoutes({ "/api/profile/notification-preferences": () => (++n === 1 ? new ApiError("timeout", "The server took too long to answer. Try again.") : PREFS) }),
    );
    await render(<NotificationPrefsScreen />);
    expect(await screen.findByText("The server took too long to answer. Try again.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("switch", { name: "Prayer Room" })).toBeTruthy();
  });

  it("permission denied", async () => {
    mockFetch.mockImplementation(
      apiRoutes({ "/api/profile/notification-preferences": new ApiError("forbidden", "You don't have access to this.", 403) }),
    );
    await render(<NotificationPrefsScreen />);
    expect(await screen.findByText("Not available on your account")).toBeTruthy();
  });
});
