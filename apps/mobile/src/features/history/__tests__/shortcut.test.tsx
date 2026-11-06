// The "My History" shortcut on Home: shown to every signed-in person (the
// website's /my-history has no role gate), and it opens the history route.

import { fireEvent, render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import HomeScreen from "../../../../app/(app)/index";
import { strings } from "../strings";

const mockRouter = { push: jest.fn(), back: jest.fn(), navigate: jest.fn() };
jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));
jest.mock("@/lib/supabase", () => ({ supabase: {} }));
jest.mock("@/auth/session-provider", () => ({ useSession: () => ({ status: "signedIn", session: { user: { id: "user-1" } } }) }));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));
// A person with no roles at all: the shortcut doesn't depend on any.
jest.mock("@/features/shell", () => ({
  ...jest.requireActual("@/features/shell"),
  useMe: () => ({ status: "ready", me: null, error: null, refresh: jest.fn() }),
}));
jest.mock("@/features/schools/shortcut", () => ({ useSchoolsShortcut: () => false }));
jest.mock("@/features/home/use-feed", () => ({
  useFeed: () => ({ status: "ready", items: [], asOf: 0, savedAt: null, notice: null, error: null, refreshing: false, refresh: jest.fn(), retry: jest.fn(), markRead: jest.fn() }),
}));

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

it("every signed-in person gets a My History shortcut that opens /history", async () => {
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <HomeScreen />
    </SafeAreaProvider>,
  );
  const row = screen.getByRole("button", { name: new RegExp(strings.shortcut.title) });
  await fireEvent.press(row);
  expect(mockRouter.navigate).toHaveBeenCalledWith("/history");
});
