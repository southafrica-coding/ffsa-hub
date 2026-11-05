// The volunteer door (/scan/<token>) is the one route outside the auth gate:
// it opens signed out AND signed in, while everything else keeps the gate.

import { act, renderRouter, screen } from "expo-router/testing-library";

import type { SessionState } from "@/auth/session-provider";
import type { Outbox } from "@/features/finance/outbox/runner";

import AppLayout from "../(app)/_layout";
import HomeScreen from "../(app)/index";
import AuthLayout from "../(auth)/_layout";
import SignInScreen from "../(auth)/sign-in";
import RootLayout from "../_layout";
import ScanLayout from "../scan/_layout";
import ScanRoute from "../scan/[token]";
import { makeOutbox } from "../../src/features/finance/__fixtures__/outbox-harness";

const TOKEN = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718";

let mockSession: SessionState = { status: "signedOut", session: null };
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
  supabase: { auth: { signInWithPassword: jest.fn(), signOut: jest.fn(), getSession: async () => ({ data: { session: null } }) } },
}));
jest.mock("@/lib/api-client", () => ({ apiFetch: jest.fn(() => new Promise(() => {})) }));
// The door's own (session-free) fetch: keep the link "being checked".
const mockPublicFetch = jest.fn((..._args: unknown[]) => new Promise(() => {}));
jest.mock("@/features/public-scan/client", () => ({ publicFetch: (...args: unknown[]) => mockPublicFetch(...args) }));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));
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
  "scan/_layout": ScanLayout,
  "scan/[token]": ScanRoute,
};

const signedIn = { status: "signedIn", session: { access_token: "t", user: { id: "u1" } } } as unknown as SessionState;

beforeEach(() => {
  mockOutbox = makeOutbox().outbox;
  mockPublicFetch.mockClear();
});

describe("/scan/[token] is outside the auth gate", () => {
  it("opens for someone with no account (no bounce to sign-in)", async () => {
    mockSession = { status: "signedOut", session: null };
    await renderRouter(routes, { initialUrl: `/scan/${TOKEN}` });
    expect(screen).toHavePathname(`/scan/${TOKEN}`);
    expect(screen.getByRole("progressbar", { name: "Opening the door scanner" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
    expect(mockPublicFetch).toHaveBeenCalledWith(`/api/scan/${TOKEN}?stats=1`, expect.anything());
  });

  it("opens for a signed-in person too, without the tab bar", async () => {
    mockSession = signedIn;
    await renderRouter(routes, { initialUrl: `/scan/${TOKEN}` });
    expect(screen).toHavePathname(`/scan/${TOKEN}`);
    expect(screen.getByRole("progressbar", { name: "Opening the door scanner" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Home" })).toBeNull();
  });

  it("stays open when the session ends while the door is in use", async () => {
    setSession(signedIn);
    await renderRouter(routes, { initialUrl: `/scan/${TOKEN}` });
    await act(async () => setSession({ status: "signedOut", session: null }));
    expect(screen).toHavePathname(`/scan/${TOKEN}`);
  });

  it("does not weaken the gate for anything else: signed out at Home still goes to sign-in", async () => {
    mockSession = { status: "signedOut", session: null };
    await renderRouter(routes, { initialUrl: "/" });
    expect(screen).toHavePathname("/sign-in");
    expect(screen.queryByRole("tab", { name: "Home" })).toBeNull();
  });
});
