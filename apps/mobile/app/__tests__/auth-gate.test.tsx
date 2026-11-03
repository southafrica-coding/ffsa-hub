import { act, renderRouter, screen } from "expo-router/testing-library";

import type { SessionState } from "@/auth/session-provider";
import type { Outbox } from "@/features/finance/outbox/runner";

import AppLayout from "../(app)/_layout";
import FinancePlaceholder from "../(app)/finance/index";
import HomeScreen from "../(app)/index";
import MeLayout from "../(app)/me/_layout";
import MeScreen from "../(app)/me/index";
import TicketsPlaceholder from "../(app)/tickets/index";
import AuthLayout from "../(auth)/_layout";
import SignInScreen from "../(auth)/sign-in";
import RootLayout from "../_layout";
import { makeOutbox } from "../../src/features/finance/__fixtures__/outbox-harness";

beforeEach(() => {
  mockOutbox = makeOutbox().outbox;
});

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
jest.mock("@/lib/supabase", () => ({ supabase: { auth: { signInWithPassword: jest.fn(), signOut: jest.fn() } } }));
jest.mock("@/lib/api-client", () => ({ apiFetch: jest.fn(() => new Promise(() => {})) }));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));
// The signed-in area mounts the receipt outbox; give it fake I/O.
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

const signedIn = { status: "signedIn", session: { access_token: "t" } } as unknown as SessionState;

describe("auth gate (app/_layout.tsx)", () => {
  it("renders nothing while the stored session is being restored (splash stays up)", async () => {
    mockSession = { status: "loading", session: null };
    await renderRouter(routes, { initialUrl: "/" });
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Home" })).toBeNull();
  });

  it("sends a signed-out user to sign-in, even when opening Home", async () => {
    mockSession = { status: "signedOut", session: null };
    await renderRouter(routes, { initialUrl: "/" });
    expect(screen).toHavePathname("/sign-in");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Home" })).toBeNull();
  });

  it("keeps a signed-in user out of sign-in", async () => {
    mockSession = signedIn;
    await renderRouter(routes, { initialUrl: "/sign-in" });
    expect(screen).toHavePathname("/");
    expect(screen.getByRole("tab", { name: "Home" })).toBeTruthy();
    expect(screen.queryByLabelText("Password")).toBeNull();
  });

  it("returns to sign-in when the session ends while the app is open (e.g. a 401)", async () => {
    setSession(signedIn);
    await renderRouter(routes, { initialUrl: "/" });
    expect(screen.getByRole("tab", { name: "Home" })).toBeTruthy();
    await act(async () => setSession({ status: "signedOut", session: null }));
    expect(screen).toHavePathname("/sign-in");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  });
});
