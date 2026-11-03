import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderRouter, screen } from "expo-router/testing-library";
import * as SplashScreen from "expo-splash-screen";
import * as SystemUI from "expo-system-ui";
import { colorScheme } from "nativewind";

import { colors } from "@/theme/tokens";

import AuthLayout from "../(auth)/_layout";
import SignInScreen from "../(auth)/sign-in";
import RootLayout from "../_layout";

// The root applies the saved Appearance choice before the splash hides and
// keeps the native root view's background on the theme (no white flash).

jest.mock("nativewind", () => ({ ...jest.requireActual("nativewind"), colorScheme: { set: jest.fn() } }));
jest.mock("expo-system-ui", () => ({ setBackgroundColorAsync: jest.fn(() => Promise.resolve()) }));
jest.mock("expo-splash-screen", () => ({
  preventAutoHideAsync: jest.fn(() => Promise.resolve()),
  hideAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock("expo-font", () => ({ useFonts: () => [true, null] }));
jest.mock("@/auth/session-provider", () => ({
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
  useSession: () => ({ status: "signedOut", session: null }),
}));
jest.mock("@/lib/supabase", () => ({ supabase: { auth: { signInWithPassword: jest.fn() } } }));

const routes = { _layout: RootLayout, "(auth)/_layout": AuthLayout, "(auth)/sign-in": SignInScreen };

beforeEach(async () => {
  await AsyncStorage.clear();
  (colorScheme.set as jest.Mock).mockReset();
  (SplashScreen.hideAsync as jest.Mock).mockClear();
});

describe("root layout + Appearance", () => {
  it("keeps the splash up until the saved choice is read, then applies it first", async () => {
    await AsyncStorage.setItem("ffsa:appearance:v1", "dark");
    let release: (v: string | null) => void = () => {};
    (AsyncStorage.getItem as jest.Mock).mockImplementationOnce(() => new Promise<string | null>((r) => (release = r)));

    await renderRouter(routes, { initialUrl: "/sign-in" });
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
    expect(SplashScreen.hideAsync).not.toHaveBeenCalled();

    await act(async () => release("dark"));
    expect(colorScheme.set).toHaveBeenCalledWith("dark");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(SplashScreen.hideAsync).toHaveBeenCalled();
  });

  it("match phone (nothing saved): no override, and the root view follows the theme background", async () => {
    await renderRouter(routes, { initialUrl: "/sign-in" });
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(colorScheme.set).not.toHaveBeenCalled();
    // Jest's phone is light; on a device the same effect re-runs with the dark bg.
    expect(SystemUI.setBackgroundColorAsync).toHaveBeenLastCalledWith(colors.light.bg);
  });
});
