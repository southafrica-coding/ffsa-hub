// Accessibility checks for sign-in and the Me screens: named controls,
// headers, switches with state, and announcements for async results.

import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { AccessibilityInfo } from "react-native";

import { MeProvider } from "@/features/shell";
import { auditTappables } from "@/lib/a11y/testing";
import { ApiError } from "@/lib/api";
import { apiFetch } from "@/lib/api-client";
import { supabase } from "@/lib/supabase";

import { apiRoutes, makeMe } from "../../test/fixtures";
import SignInScreen from "../(auth)/sign-in";
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
jest.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { signOut: jest.fn().mockResolvedValue({ error: null }), signInWithPassword: jest.fn() },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { first_name: "Sample", last_name: "Person", phone: "" }, error: null }) }),
      }),
    }),
  },
}));

const mockFetch = apiFetch as unknown as jest.Mock;
const signIn = supabase.auth.signInWithPassword as jest.Mock;
const wrap = (ui: ReactNode) => <MeProvider>{ui}</MeProvider>;
const audit = () => auditTappables(screen.container as never);

// announce() queues on iOS (the test platform) through this call.
const spoken = jest.spyOn(AccessibilityInfo, "announceForAccessibilityWithOptions").mockImplementation(() => {});

beforeEach(() => {
  mockFetch.mockReset();
  signIn.mockReset();
  spoken.mockClear();
  Object.values(mockRouter).forEach((f) => f.mockClear());
});

describe("Sign-in", () => {
  it("names every control once; the brand tick is hidden; the wordmark is a labelled image", async () => {
    await render(<SignInScreen />);
    expect(screen.getByRole("header", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByLabelText("Fire and Fragrance").props.accessibilityRole).toBe("image");
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show password" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Forgot password/ })).toBeTruthy();
    expect(audit()).toEqual([]);
  });

  it("announces the first field to fix", async () => {
    await render(<SignInScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
    expect(spoken).toHaveBeenCalledWith("Enter your email address.", { queue: true });
  });

  it("announces a failed sign-in", async () => {
    signIn.mockResolvedValue({ data: {}, error: { status: 400, message: "Invalid login credentials" } });
    await render(<SignInScreen />);
    await fireEvent.changeText(screen.getByLabelText("Email"), "jo@example.org");
    await fireEvent.changeText(screen.getByLabelText("Password"), "nope");
    await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(spoken).toHaveBeenCalledWith(expect.stringMatching(/./), { queue: true });
  });
});

describe("Me", () => {
  it("success: email and roles read as label + value; every row named", async () => {
    mockFetch.mockImplementation(apiRoutes({ "/api/me": makeMe() }));
    await render(wrap(<MeScreen />));
    expect(await screen.findByLabelText("Email: jo@example.org")).toBeTruthy();
    expect(screen.getByLabelText(/^Roles: /)).toBeTruthy();
    for (const name of ["Profile", "Settings", "About"]) expect(screen.getByRole("header", { name })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit name and phone" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Appearance" }).props.accessibilityHint).toMatch(/Match phone/);
    expect(screen.getByRole("button", { name: "Sign out" }).props.accessibilityHint).toMatch(/this phone only/);
    expect(audit()).toEqual([]);
  });

  it("error: announced, retry is a named button", async () => {
    mockFetch.mockRejectedValue(new ApiError("network", "Couldn't reach FFSA Hub. Check your connection and try again."));
    await render(wrap(<MeScreen />));
    expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy();
    // Spoken once, by the danger Banner (title + message).
    expect(spoken).toHaveBeenCalledTimes(1);
    expect(spoken).toHaveBeenCalledWith(expect.stringContaining("Couldn't reach FFSA Hub. Check your connection and try again"), { queue: true });
    expect(audit()).toEqual([]);
  });
});

describe("Edit profile", () => {
  it("announces the first error, then 'Profile saved' on success", async () => {
    mockFetch.mockImplementation(apiRoutes({ "/api/me": makeMe(), "/api/profile/update": { ok: true } }));
    await render(wrap(<EditProfileScreen />));
    const first = await screen.findByLabelText("First name");
    expect(audit()).toEqual([]);
    await fireEvent.changeText(first, "");
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    expect(spoken).toHaveBeenCalledWith("Enter your first name.", { queue: true });
    await fireEvent.changeText(screen.getByLabelText("First name"), "Jo");
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    expect(spoken).toHaveBeenCalledWith("Profile saved.", { queue: true });
  });

  it("announces a save failure", async () => {
    mockFetch.mockImplementation(
      apiRoutes({ "/api/me": makeMe(), "/api/profile/update": new ApiError("http", "Something went wrong on the server (400). Try again.", 400) }),
    );
    await render(wrap(<EditProfileScreen />));
    await screen.findByLabelText("First name");
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    // Spoken once, by the danger Banner (title + message).
    expect(spoken).toHaveBeenCalledTimes(1);
    expect(spoken).toHaveBeenCalledWith(expect.stringContaining("Couldn't save your changes. Check your details and try again"), { queue: true });
  });
});

describe("Notification settings", () => {
  const PREFS = {
    modules: [{ key: "prayer_room", label: "Prayer Room", description: "Block-outs and devo set relocations." }],
    mutedModules: [],
  };

  it("each switch has the group's name, its description as the hint, and its state", async () => {
    mockFetch.mockImplementation(apiRoutes({ "/api/profile/notification-preferences": PREFS }));
    await render(<NotificationPrefsScreen />);
    const sw = await screen.findByRole("switch", { name: "Prayer Room" });
    expect(sw.props.accessibilityHint).toBe("Block-outs and devo set relocations.");
    expect(sw.props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByText("On")).toBeTruthy();
    expect(audit()).toEqual([]);
  });

  it("a failed save is announced", async () => {
    mockFetch.mockImplementation(
      apiRoutes({
        "/api/profile/notification-preferences": (init?: { method?: string }) =>
          init?.method === "PUT" ? new ApiError("network", "x") : PREFS,
      }),
    );
    await render(<NotificationPrefsScreen />);
    await fireEvent(await screen.findByRole("switch", { name: "Prayer Room" }), "valueChange", false);
    // Spoken once, by the danger Banner (title + message).
    expect(spoken).toHaveBeenCalledTimes(1);
    expect(spoken).toHaveBeenCalledWith(expect.stringContaining("Couldn't save that change. Check your connection and try again"), { queue: true });
  });

  it("permission denied and empty: headers, nothing unnamed", async () => {
    mockFetch.mockImplementation(apiRoutes({ "/api/profile/notification-preferences": new ApiError("forbidden", "x", 403) }));
    await render(<NotificationPrefsScreen />);
    expect(await screen.findByRole("header", { name: "Not available on your account" })).toBeTruthy();
    expect(audit()).toEqual([]);
  });
});
