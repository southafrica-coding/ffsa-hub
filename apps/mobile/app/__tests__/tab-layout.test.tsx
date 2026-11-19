import { fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { Stack } from "expo-router";
import { Text } from "react-native";

import type { Outbox } from "@/features/finance/outbox/runner";
import { useOutbox } from "@/features/finance/outbox/provider";
import { apiFetch } from "@/lib/api-client";

import { expenseItem } from "../../src/features/finance/__fixtures__/fixtures";
import { makeOutbox } from "../../src/features/finance/__fixtures__/outbox-harness";
import { apiRoutes, makeMe } from "../../test/fixtures";
import AppLayout from "../(app)/_layout";
import HomeScreen from "../(app)/index";
import MeLayout from "../(app)/me/_layout";
import MeScreen from "../(app)/me/index";

// The real tab layout under expo-router. Auth is out of the picture here
// (app/_layout.tsx's gate has its own test): these routes are the signed-in area.

// expo-router's testing library swaps Reanimated for its official mock, which can't load under this SDK.
jest.mock("react-native-reanimated/mock", () => jest.requireActual("../../test/reanimated-mock"));
jest.mock("@/lib/api-client", () => ({ apiFetch: jest.fn() }));
jest.mock("@/auth/session-provider", () => ({
  useSession: () => ({ status: "signedIn", session: { user: { id: "u1" } } }),
}));
jest.mock("@/lib/supabase", () => ({ supabase: { auth: { signOut: jest.fn() } } }));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));
jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: { fetch: async () => ({ isConnected: true }), addEventListener: () => () => {} },
}));
// The app's one outbox, with fake I/O (the real one writes to the documents folder).
let mockOutbox: Outbox;
jest.mock("@/features/finance/outbox/live", () => ({ getOutbox: () => mockOutbox }));

const mockFetch = apiFetch as unknown as jest.Mock;

// Slices 2 and 3 replaced the finance and tickets placeholders with the real screens, so the "before" tree uses a stand-in.
const FinancePlaceholder = () => <Text>Coming soon</Text>;
const TicketsPlaceholder = () => <Text>Coming soon</Text>;

beforeEach(() => {
  mockOutbox = makeOutbox().outbox;
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

// Phase 2: the Prayer tab's own folder.
const PrayerLayout = () => <Stack screenOptions={{ headerShown: false }} />;
const withPrayer = {
  ...landedTree,
  "(app)/prayer/_layout": PrayerLayout,
  "(app)/prayer/index": () => <Text>Prayer room</Text>,
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

    await fireEvent.press(screen.getByRole("tab", { name: "Tickets" }));
    expect(screen).toHavePathname("/tickets");
    expect(screen.getByRole("tab", { name: "Tickets" }).props.accessibilityState).toMatchObject({ selected: true });

    await fireEvent.press(screen.getByRole("tab", { name: "Me" }));
    expect(screen).toHavePathname("/me");
    expect(screen.getByRole("tab", { name: "Me" }).props.accessibilityState).toMatchObject({ selected: true });
  });

  it("with the Prayer slice: five tabs, Prayer third, reachable", async () => {
    await renderRouter(withPrayer, { initialUrl: "/" });
    expect(screen.getAllByRole("tab").map((t) => t.props.accessibilityLabel)).toEqual([
      "Home",
      "Finance",
      "Prayer",
      "Tickets",
      "Me",
    ]);
    await fireEvent.press(screen.getByRole("tab", { name: "Prayer" }));
    expect(screen).toHavePathname("/prayer");
    expect(await screen.findByText("Prayer room")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Prayer" }).props.accessibilityState).toMatchObject({ selected: true });
  });

  it("a nested route (tickets/check-in) keeps the Tickets tab selected", async () => {
    await renderRouter(landedTree, { initialUrl: "/tickets/check-in" });
    expect(await screen.findByText("Door check-in")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Tickets" }).props.accessibilityState).toMatchObject({ selected: true });
  });
});

describe("app-wide receipt outbox", () => {
  it("starts sending at app start, before Finance is ever opened", async () => {
    const { outbox, deps } = makeOutbox([expenseItem()]);
    mockOutbox = outbox;
    await renderRouter(landedTree, { initialUrl: "/" });
    expect(await screen.findAllByRole("tab")).toHaveLength(4);
    expect(screen).toHavePathname("/");
    // OutboxProvider sends on mount; the finance stack hasn't been mounted.
    await waitFor(() => expect(deps.createExpense).toHaveBeenCalled());
    expect(screen.queryByText("Real finance")).toBeNull();
  });

  it("is available to every tab, not just Finance", async () => {
    const OutboxProbe = () => {
      const { items } = useOutbox();
      return <Text>{`Outbox: ${items.length}`}</Text>;
    };
    // A failed item stays put until the person removes it, so the count is stable.
    mockOutbox = makeOutbox([expenseItem({ status: "failed", lastError: "no" })]).outbox;
    await renderRouter({ ...landedTree, "(app)/tickets/index": OutboxProbe }, { initialUrl: "/tickets" });
    expect(await screen.findByText("Outbox: 1")).toBeTruthy();
  });
});
