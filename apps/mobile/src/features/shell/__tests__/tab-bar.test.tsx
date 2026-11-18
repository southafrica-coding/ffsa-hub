import type { BottomTabBarProps } from "expo-router/js-tabs";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";
import type { ReactNode } from "react";
import { StyleSheet } from "react-native";

import { apiFetch } from "@/lib/api-client";
import { colors, palette } from "@/theme/tokens";

import { apiRoutes, makeMe } from "../../../../test/fixtures";
import { setTabBadge } from "../badges";
import { MeProvider } from "../me-context";
import { TabBar } from "../TabBar";

// The redesigned tab bar (spec §5) with 5 tabs (everyone) and 6 (Training
// staff), in light and dark.

jest.mock("@/lib/api-client", () => ({ apiFetch: jest.fn() }));
jest.mock("expo-haptics", () => ({ selectionAsync: jest.fn(async () => {}) }));
let mockScheme: "light" | "dark" = "light";
jest.mock("@/theme/use-theme", () => {
  const actual = jest.requireActual("@/theme/use-theme");
  return { ...actual, useTheme: () => actual.themeFor(mockScheme) };
});
const mockFetch = apiFetch as unknown as jest.Mock;
const wrapper = ({ children }: { children: ReactNode }) => <MeProvider>{children}</MeProvider>;
const flat = (style: unknown) => StyleSheet.flatten(style as never) ?? {};

const ALL_ROUTES = ["index", "training", "finance", "prayer", "tickets", "me", "bookings", "schools", "history", "okrs", "ministries", "staff-decisions"];
type Nested = { index: number; routes: { name: string }[] };

function barProps(focused: string, nested?: Nested, descriptors: Record<string, unknown> = {}) {
  const routes = ALL_ROUTES.map((name) => ({ key: `${name}-key`, name, ...(name === focused && nested ? { state: nested } : {}) }));
  const navigateToTab = jest.fn();
  const emit = jest.fn(() => ({ defaultPrevented: false }));
  return {
    props: {
      state: { index: ALL_ROUTES.indexOf(focused), routes },
      descriptors,
      emitter: { emit },
      navigateToTab,
      insets: { top: 0, bottom: 34, left: 0, right: 0 },
    } as unknown as BottomTabBarProps,
    navigateToTab,
  };
}

const everyone = makeMe();
const trainingStaff = makeMe({ training: { walkingWith: 1, programStaff: 0 } });

afterEach(() => act(() => setTabBadge("home", 0)));

describe.each(["light", "dark"] as const)("tab bar (%s)", (scheme) => {
  const c = colors[scheme];
  beforeEach(() => {
    mockScheme = scheme;
    mockFetch.mockReset();
  });

  it.each([
    ["5 tabs", everyone, ["Home", "Finance", "Prayer", "Tickets", "Me"]],
    ["6 tabs", trainingStaff, ["Home", "Training", "Finance", "Prayer", "Tickets", "Me"]],
  ] as const)("%s: labelled, in order, sentence case, never truncated by the bar", async (_n, me, labels) => {
    mockFetch.mockImplementation(apiRoutes({ "/api/me": me }));
    await render(<TabBar {...barProps("finance").props} />, { wrapper });
    await screen.findByText(labels[labels.length - 1]);
    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((t) => t.props.accessibilityLabel)).toEqual(labels);
    expect(tabs[1].props.accessibilityHint).toBe(`Tab 2 of ${labels.length}`);
    for (const label of labels) {
      const el = screen.getByText(label);
      expect(flat(el.props.style).textTransform).toBeUndefined();
      expect(el.props.numberOfLines).toBe(1);
      expect(el.props.adjustsFontSizeToFit).toBeUndefined();
    }
  });

  it("active = 3pt yellow tick on the top edge + 800 label + heavier icon; inactive = 500 secondary", async () => {
    mockFetch.mockImplementation(apiRoutes({ "/api/me": trainingStaff }));
    await render(<TabBar {...barProps("prayer").props} />, { wrapper });
    await screen.findByText("Training");
    expect(screen.getByRole("tab", { name: "Prayer" }).props.accessibilityState).toMatchObject({ selected: true });
    const tick = screen.getByTestId("tab-tick-prayer", { includeHiddenElements: true });
    expect(flat(tick.props.style)).toMatchObject({ height: 3, backgroundColor: palette.yellow });
    expect(screen.queryByTestId("tab-tick-home", { includeHiddenElements: true })).toBeNull();
    expect(flat(screen.getByText("Prayer").props.style)).toMatchObject({ fontFamily: "Roboto_800ExtraBold", color: c.text });
    expect(flat(screen.getByText("Home").props.style)).toMatchObject({ fontFamily: "Roboto_500Medium", color: c.textSecondary });
    expect(screen.getByText("Prayer").props.maxFontSizeMultiplier).toBeCloseTo(13 / 11);
  });

  it("is 48pt tall plus the home-indicator inset", async () => {
    mockFetch.mockImplementation(apiRoutes({ "/api/me": everyone }));
    await render(<TabBar {...barProps("index").props} />, { wrapper });
    const tab = await screen.findByTestId("tab-me");
    const s = typeof tab.props.style === "function" ? tab.props.style({ pressed: false }) : tab.props.style;
    expect(flat(s).minHeight).toBe(48);
    expect(flat(screen.getByTestId("tab-bar").props.style)).toMatchObject({ paddingBottom: 34, borderTopWidth: 1, borderTopColor: c.rule });
  });

  it("the Home badge is an ink pill (cream in dark), capped at 99+, and spoken", async () => {
    mockFetch.mockImplementation(apiRoutes({ "/api/me": everyone }));
    await render(<TabBar {...barProps("me").props} />, { wrapper });
    await act(async () => setTabBadge("home", 150));
    const badge = screen.getByTestId("tab-badge-home", { includeHiddenElements: true });
    expect(badge).toHaveTextContent("99+");
    expect(flat(badge.props.style).backgroundColor).toBe(c.inverse);
    expect(c.inverse).toBe(scheme === "dark" ? palette.paper : palette.ink);
    expect(screen.getByRole("tab", { name: "Home, 150 unread" })).toBeTruthy();
  });

  it("hidden routes (Bookings …) mark Home active, and Home takes you back to its root", async () => {
    mockFetch.mockImplementation(apiRoutes({ "/api/me": everyone }));
    const { props, navigateToTab } = barProps("bookings");
    await render(<TabBar {...props} />, { wrapper });
    expect((await screen.findByRole("tab", { name: "Home" })).props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getAllByRole("tab")).toHaveLength(5);
    await fireEvent.press(screen.getByRole("tab", { name: "Home" }));
    expect(navigateToTab).toHaveBeenCalledWith("index-key");
    expect(Haptics.selectionAsync).toHaveBeenCalled();
  });

  it.each([
    ["the ticket QR", "tickets", { index: 1, routes: [{ name: "index" }, { name: "ticket/[id]" }] }],
    ["the door scanner", "tickets", { index: 1, routes: [{ name: "check-in/index" }, { name: "check-in/[eventId]" }] }],
    ["Add expense", "finance", { index: 1, routes: [{ name: "[teamId]/index" }, { name: "[teamId]/new" }] }],
    ["a vehicle check", "bookings", { index: 1, routes: [{ name: "index" }, { name: "vehicle/[id]/[kind]" }] }],
    ["Edit profile", "me", { index: 1, routes: [{ name: "index" }, { name: "edit" }] }],
  ] as const)("hides on %s", async (_what, tab, nested) => {
    mockFetch.mockImplementation(apiRoutes({ "/api/me": everyone }));
    await render(<TabBar {...barProps(tab, nested as Nested).props} />, { wrapper });
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("stays on tab roots and ordinary pushed screens, and hides when a screen sets tabBarStyle display:none", async () => {
    mockFetch.mockImplementation(apiRoutes({ "/api/me": everyone }));
    const shown = await render(<TabBar {...barProps("tickets", { index: 1, routes: [{ name: "index" }, { name: "check-in/index" }] }).props} />, {
      wrapper,
    });
    expect(await screen.findAllByRole("tab")).toHaveLength(5);
    await shown.unmount();
    await render(<TabBar {...barProps("prayer", undefined, { "prayer-key": { options: { tabBarStyle: { display: "none" } } } }).props} />, {
      wrapper,
    });
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });
});
