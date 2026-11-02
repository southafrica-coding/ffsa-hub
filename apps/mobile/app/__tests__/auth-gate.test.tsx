import { act, renderRouter, screen } from "expo-router/testing-library";

import type { SessionState } from "@/auth/session-provider";

import AppLayout from "../(app)/_layout";
import HomeScreen from "../(app)/index";
import AuthLayout from "../(auth)/_layout";
import SignInScreen from "../(auth)/sign-in";
import RootLayout from "../_layout";

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

const routes = {
  _layout: RootLayout,
  "(auth)/_layout": AuthLayout,
  "(auth)/sign-in": SignInScreen,
  "(app)/_layout": AppLayout,
  "(app)/index": HomeScreen,
};

const signedIn = { status: "signedIn", session: { access_token: "t" } } as unknown as SessionState;

describe("auth gate (app/_layout.tsx)", () => {
  it("renders nothing while the stored session is being restored (splash stays up)", async () => {
    mockSession = { status: "loading", session: null };
    await renderRouter(routes, { initialUrl: "/" });
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });

  it("sends a signed-out user to sign-in, even when opening Home", async () => {
    mockSession = { status: "signedOut", session: null };
    await renderRouter(routes, { initialUrl: "/" });
    expect(screen).toHavePathname("/sign-in");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });

  it("keeps a signed-in user out of sign-in", async () => {
    mockSession = signedIn;
    await renderRouter(routes, { initialUrl: "/sign-in" });
    expect(screen).toHavePathname("/");
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
    expect(screen.queryByLabelText("Password")).toBeNull();
  });

  it("returns to sign-in when the session ends while the app is open (e.g. a 401)", async () => {
    setSession(signedIn);
    await renderRouter(routes, { initialUrl: "/" });
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
    await act(async () => setSession({ status: "signedOut", session: null }));
    expect(screen).toHavePathname("/sign-in");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  });
});
