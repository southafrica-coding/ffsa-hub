import { fireEvent, renderRouter, screen } from "expo-router/testing-library";
import { Stack } from "expo-router";
import { Text } from "react-native";

import { apiFetch } from "@/lib/api-client";

import { apiRoutes, makeMe } from "../../test/fixtures";
import AppLayout from "../(app)/_layout";
import HomeScreen from "../(app)/index";
import MeLayout from "../(app)/me/_layout";
import MeScreen from "../(app)/me/index";

// The real tab layout under expo-router. Auth is out of the picture here
// (app/_layout.tsx's gate has its own test): these routes are the signed-in area.

jest.mock("@/lib/api-client", () => ({ apiFetch: jest.fn() }));
jest.mock("@/auth/session-provider", () => ({
  useSession: () => ({ status: "signedIn", session: { user: { id: "u1" } } }),
}));
jest.mock("@/lib/supabase", () => ({ supabase: { auth: { signOut: jest.fn() } } }));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));

const mockFetch = apiFetch as unknown as jest.Mock;

// Slices 2 and 3 replaced the finance and tickets placeholders with the real screens, so the "before" tree uses a stand-in.
const FinancePlaceholder = () => <Text>Coming soon</Text>;
const TicketsPlaceholder = () => <Text>Coming soon</Text>;

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockImplementation(apiRoutes({ "/api/me": makeMe(), "/api/notifications": { items: [] } }));
  // "No route named finance": expected until slices 2/3 add their _layout.tsx.
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => (console.warn as jest.Mock).mockRestore());

// Today's tree: bare placeholders at finance/index and tickets/index.
const placeholderTree = {
  "(app)/_layout": AppLayout,
  "(app)/index": HomeScreen,
  "(app)/finance/index": FinancePlaceholder,
  "(app)/tickets/index": TicketsPlaceholder,
  "(app)/me/_layout": MeLayout,
  "(app)/me/index": MeScreen,
};

// After slices 2 and 3 land: each folder has its own _layout.tsx (+ check-in).
const FinanceLayout = () => <Stack screenOptions={{ headerShown: false }} />;
const TicketsLayout = () => <Stack screenOptions={{ headerShown: false }} />;
const landedTree = {
  ...placeholderTree,
  "(app)/finance/_layout": FinanceLayout,
  "(app)/finance/index": () => <Text>Real finance</Text>,
  "(app)/tickets/_layout": TicketsLayout,
  "(app)/tickets/index": () => <Text>Real tickets</Text>,
  "(app)/tickets/check-in/index": () => <Text>Door check-in</Text>,
};

describe("tab layout", () => {
  it.each([
    ["placeholders", placeholderTree, "Coming soon"],
    ["slices landed", landedTree, "Real finance"],
  ])("with %s: four tabs in order, Home first, each one reachable", async (_name, tree, financeText) => {
    await renderRouter(tree, { initialUrl: "/" });
    expect(screen.getAllByRole("tab").map((t) => t.props.accessibilityLabel)).toEqual(["Home", "Finance", "Tickets", "Me"]);
    expect(screen.getByRole("tab", { name: "Home" }).props.accessibilityState).toMatchObject({ selected: true });

    await fireEvent.press(screen.getByRole("tab", { name: "Finance" }));
    expect(screen).toHavePathname("/finance");
    expect(await screen.findByText(new RegExp(financeText))).toBeTruthy();

    await fireEvent.press(screen.getByRole("tab", { name: "Me" }));
    expect(screen).toHavePathname("/me");
    expect(screen.getByRole("tab", { name: "Me" }).props.accessibilityState).toMatchObject({ selected: true });
  });

  it("a nested route (tickets/check-in) keeps the Tickets tab selected", async () => {
    await renderRouter(landedTree, { initialUrl: "/tickets/check-in" });
    expect(await screen.findByText("Door check-in")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Tickets" }).props.accessibilityState).toMatchObject({ selected: true });
  });
});
