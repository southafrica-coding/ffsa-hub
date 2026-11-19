import { act, fireEvent, renderRouter, screen } from "expo-router/testing-library";
import { Stack } from "expo-router";
import { useRef } from "react";
import { Text } from "react-native";

import { useScrollToTopOnTabPress } from "@/components";
import type { Outbox } from "@/features/finance/outbox/runner";
import { apiFetch } from "@/lib/api-client";

import { makeOutbox } from "../../src/features/finance/__fixtures__/outbox-harness";
import { apiRoutes, makeMe } from "../../test/fixtures";
import AppLayout from "../(app)/_layout";

// Re-tapping the active tab (spec §9, normal iPhone behaviour): the first tap
// scrolls the screen to the top; at the top, the next tap pops to the tab's
// root. Real tab navigator and stacks; the scroll view is a stand-in whose
// offset the test sets, because the test renderer doesn't scroll.

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
let mockOutbox: Outbox;
jest.mock("@/features/finance/outbox/live", () => ({ getOutbox: () => mockOutbox }));

const mockFetch = apiFetch as unknown as jest.Mock;

// What each page's scroll view reports, and its scrollTo.
const offsets: Record<string, number> = {};
const scrollTo = jest.fn();

function Page({ name }: { name: string }) {
  const ref = useRef({ scrollTo: (o: unknown) => scrollTo(name, o) });
  useScrollToTopOnTabPress(ref, () => offsets[name] ?? 0);
  return <Text>{name}</Text>;
}

const TicketsLayout = () => <Stack screenOptions={{ headerShown: false }} />;
const tree = {
  "(app)/_layout": AppLayout,
  "(app)/index": () => <Page name="Home page" />,
  "(app)/me/index": () => <Page name="Me page" />,
  "(app)/tickets/_layout": TicketsLayout,
  "(app)/tickets/index": () => <Page name="Tickets root" />,
  "(app)/tickets/check-in/index": () => <Page name="Door page" />,
};

beforeEach(() => {
  mockOutbox = makeOutbox().outbox;
  mockFetch.mockReset();
  mockFetch.mockImplementation(apiRoutes({ "/api/me": makeMe(), "/api/notifications": { items: [] } }));
  scrollTo.mockReset();
  for (const k of Object.keys(offsets)) delete offsets[k];
});

// The stack pops (and scrolls) in the next frame; renderRouter uses fake timers, so move them on.
const nextFrame = () =>
  act(() => {
    jest.advanceTimersByTime(50);
  });

describe("re-tapping the active tab", () => {
  it("on a pushed screen at the top: pops to the tab root", async () => {
    await renderRouter(tree, { initialUrl: "/tickets" });
    await fireEvent.press(screen.getByRole("tab", { name: "Tickets" }));
    expect(await screen.findByText("Tickets root")).toBeTruthy();
    const { router } = jest.requireActual<typeof import("expo-router")>("expo-router");
    router.push("/tickets/check-in");
    expect(await screen.findByText("Door page")).toBeTruthy();
    expect(screen).toHavePathname("/tickets/check-in");

    await fireEvent.press(screen.getByRole("tab", { name: "Tickets" }));
    await nextFrame();
    expect(screen).toHavePathname("/tickets");
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("on a pushed screen scrolled down: the first tap scrolls to the top, the second pops", async () => {
    await renderRouter(tree, { initialUrl: "/tickets" });
    const { router } = jest.requireActual<typeof import("expo-router")>("expo-router");
    router.push("/tickets/check-in");
    expect(await screen.findByText("Door page")).toBeTruthy();
    offsets["Door page"] = 600;

    await fireEvent.press(screen.getByRole("tab", { name: "Tickets" }));
    await nextFrame();
    expect(scrollTo).toHaveBeenCalledWith("Door page", { y: 0, animated: true });
    expect(screen).toHavePathname("/tickets/check-in");

    offsets["Door page"] = 0; // the scroll has landed at the top
    await fireEvent.press(screen.getByRole("tab", { name: "Tickets" }));
    await nextFrame();
    expect(screen).toHavePathname("/tickets");
  });

  it("on a tab root scrolled down: scrolls to the top and stays", async () => {
    await renderRouter(tree, { initialUrl: "/" });
    expect(await screen.findByText("Home page")).toBeTruthy();
    offsets["Home page"] = 300;
    await fireEvent.press(screen.getByRole("tab", { name: "Home" }));
    await nextFrame();
    expect(scrollTo).toHaveBeenCalledWith("Home page", { y: 0, animated: true });
    expect(screen).toHavePathname("/");
  });

  it("only the focused tab's screen reacts; switching tabs never scrolls", async () => {
    await renderRouter(tree, { initialUrl: "/" });
    expect(await screen.findByText("Home page")).toBeTruthy();
    offsets["Home page"] = 300;
    await fireEvent.press(screen.getByRole("tab", { name: "Me" }));
    await nextFrame();
    expect(screen).toHavePathname("/me");
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
