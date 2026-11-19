// The Face ID lock wired through the real layouts (app/_layout.tsx and
// app/(app)/_layout.tsx): a cold start with the lock on opens on the lock
// screen (no tab bar to reach), Unlock reveals the app, "Sign out instead"
// does the same cleanup as Me › Sign out, and the Me settings row.

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as LocalAuthentication from "expo-local-authentication";
import { act, fireEvent, renderRouter, screen } from "expo-router/testing-library";

import type { SessionState } from "@/auth/session-provider";
import type { Outbox } from "@/features/finance/outbox/runner";
import { LOCK_STORAGE_KEY } from "@/features/lock/storage";
import { unregisterPushOnSignOut } from "@/features/push";
import { apiFetch } from "@/lib/api-client";
import { supabase } from "@/lib/supabase";

import AppLayout from "../(app)/_layout";
import FinancePlaceholder from "../(app)/finance/index";
import HomeScreen from "../(app)/index";
import MeLayout from "../(app)/me/_layout";
import MeScreen from "../(app)/me/index";
import TicketsPlaceholder from "../(app)/tickets/index";
import AuthLayout from "../(auth)/_layout";
import SignInScreen from "../(auth)/sign-in";
import RootLayout from "../_layout";
import { apiRoutes, makeMe } from "../../test/fixtures";
import { makeOutbox } from "../../src/features/finance/__fixtures__/outbox-harness";

let mockSession: SessionState = { status: "loading", session: null };
const mockListeners = new Set<() => void>();
function setSession(next: SessionState) {
  mockSession = next;
  mockListeners.forEach((l) => l());
}
jest.mock("@/auth/session-provider", () => {
  const { useSyncExternalStore } = jest.requireActual("react");
  return {
    SessionProvider: ({ children }: { children: React.ReactNode }) => children,
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
jest.mock("expo-font", () => ({ useFonts: () => [true, null] }));
jest.mock("@/lib/supabase", () => ({
  supabase: { auth: { signInWithPassword: jest.fn(), signOut: jest.fn(async () => ({ error: null })) } },
}));
jest.mock("@/lib/api-client", () => ({ apiFetch: jest.fn() }));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));
jest.mock("@/features/push", () => ({
  ...jest.requireActual("@/features/push"),
  unregisterPushOnSignOut: jest.fn(async () => {}),
}));
let mockOutbox: Outbox;
jest.mock("@/features/finance/outbox/live", () => ({ getOutbox: () => mockOutbox }));
jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: { fetch: async () => ({ isConnected: true }), addEventListener: () => () => {} },
}));

const routes = {
  _layout: RootLayout,
  "(auth)/_layout": AuthLayout,
  "(auth)/sign-in": SignInScreen,
  "(app)/_layout": AppLayout,
  "(app)/index": HomeScreen,
  "(app)/finance/index": FinancePlaceholder,
  "(app)/tickets/index": TicketsPlaceholder,
  "(app)/me/_layout": MeLayout,
  "(app)/me/index": MeScreen,
};

const signedIn = {
  status: "signedIn",
  session: { access_token: "t", user: { id: "u1", email: "sample@example.org" } },
} as unknown as SessionState;
const auth = LocalAuthentication.authenticateAsync as jest.Mock;
const mockFetch = apiFetch as unknown as jest.Mock;

beforeEach(async () => {
  mockOutbox = makeOutbox().outbox;
  await AsyncStorage.clear();
  mockSession = signedIn;
  auth.mockReset();
  auth.mockResolvedValue({ success: false, error: "user_cancel" });
  (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(true);
  (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(true);
  (LocalAuthentication.supportedAuthenticationTypesAsync as jest.Mock).mockResolvedValue([2]);
  mockFetch.mockReset();
  mockFetch.mockImplementation(apiRoutes({ "/api/me": makeMe({ roles: [] }) }));
});

describe("Face ID lock gate", () => {
  it("off: the app opens as before, no lock screen", async () => {
    await renderRouter(routes, { initialUrl: "/" });
    expect(screen.getByRole("tab", { name: "Home" })).toBeTruthy();
    expect(screen.queryByTestId("lock-screen")).toBeNull();
    expect(auth).not.toHaveBeenCalled();
  });

  it("on: a cold start opens on the lock screen, asks once, and nothing underneath is reachable", async () => {
    await AsyncStorage.setItem(LOCK_STORAGE_KEY, "on");
    await renderRouter(routes, { initialUrl: "/" });
    expect(await screen.findByRole("header", { name: "FFSA Hub is locked" })).toBeTruthy();
    expect(auth).toHaveBeenCalledTimes(1);
    // The tab bar and Home are covered and hidden from screen readers.
    expect(screen.queryByRole("tab", { name: "Home" })).toBeNull();
    expect(screen.getByText("Sample · sample@example.org")).toBeTruthy();
  });

  it("Unlock: Face ID says yes, the app is back where it was", async () => {
    await AsyncStorage.setItem(LOCK_STORAGE_KEY, "on");
    await renderRouter(routes, { initialUrl: "/" });
    await screen.findByTestId("lock-screen");
    auth.mockResolvedValueOnce({ success: true });
    await act(async () => fireEvent.press(screen.getByRole("button", { name: "Unlock with Face ID" })));
    expect(screen.queryByTestId("lock-screen")).toBeNull();
    expect(screen.getByRole("tab", { name: "Home" })).toBeTruthy();
  });

  it("Sign out instead: the same cleanup as Me › Sign out, and the choice is forgotten", async () => {
    await AsyncStorage.setItem(LOCK_STORAGE_KEY, "on");
    await renderRouter(routes, { initialUrl: "/" });
    await screen.findByTestId("lock-screen");
    await act(async () => fireEvent.press(screen.getByRole("button", { name: "Sign out instead" })));
    expect(unregisterPushOnSignOut).toHaveBeenCalled();
    expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    await act(async () => setSession({ status: "signedOut", session: null }));
    expect(screen).toHavePathname("/sign-in");
    expect(screen.queryByTestId("lock-screen")).toBeNull();
    expect(await AsyncStorage.getItem(LOCK_STORAGE_KEY)).toBeNull();
  });

  it("Me › Settings shows the switch on a Face ID phone", async () => {
    await renderRouter(routes, { initialUrl: "/me" });
    expect(await screen.findByTestId("lock-switch")).toBeTruthy();
    expect(screen.getByTestId("lock-switch").props.accessibilityLabel).toBe("Lock with Face ID");
  });
});
