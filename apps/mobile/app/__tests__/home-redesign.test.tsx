// Home after the redesign (mockup frames 2.1–2.7, 13.1, 13.4): the kit's
// header, one band, feed rows, shortcut group and each state's look, in
// light and dark. Behaviour is covered in home.test.tsx.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, render, screen, within } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";
import type { ReactElement } from "react";
import { StyleSheet } from "react-native";

import { MeProvider } from "@/features/shell";
import { ApiError } from "@/lib/api";
import { apiFetch } from "@/lib/api-client";
import { colors } from "@/theme/tokens";

import { apiRoutes, makeMe } from "../../test/fixtures";
import HomeScreen from "../(app)/index";

jest.mock("@/lib/api-client", () => ({ apiFetch: jest.fn() }));
jest.mock("@/auth/session-provider", () => ({
  useSession: () => ({ status: "signedIn", session: { user: { id: "u1" } } }),
}));
jest.mock("expo-router", () => ({ useRouter: () => ({ navigate: jest.fn(), push: jest.fn(), back: jest.fn() }) }));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn().mockResolvedValue({ type: "dismiss" }) }));
jest.mock("expo-haptics", () => ({ impactAsync: jest.fn(async () => {}), ImpactFeedbackStyle: { Light: "light" } }));
let mockShowSchools = false;
jest.mock("@/features/schools/shortcut", () => ({ useSchoolsShortcut: () => mockShowSchools }));
let mockScheme: "light" | "dark" = "light";
jest.mock("@/theme/use-theme", () => {
  const actual = jest.requireActual("@/theme/use-theme");
  return { ...actual, useTheme: () => actual.themeFor(mockScheme) };
});

const mockFetch = apiFetch as unknown as jest.Mock;
const flat = (style: unknown) => StyleSheet.flatten(style as never) ?? {};
const hidden = { includeHiddenElements: true };

type Host = { props: Record<string, unknown>; parent: Host | null };
/** The RefreshControl element handed to the scroll view that holds `el`. */
function refreshControlAround(el: Host) {
  for (let n: Host | null = el; n; n = n.parent) {
    const rc = n.props.refreshControl as ReactElement<{ tintColor: string; onRefresh: () => void }> | undefined;
    if (rc) return rc.props;
  }
  throw new Error("no RefreshControl above this element");
}

const NOW = Date.now();
const FEED = {
  items: [
    { key: "booking:1", kind: "booking", title: "New booking request", body: "Youth night", href: "/bookings/requests", read: false, createdAt: new Date(NOW - 2 * 3600_000).toISOString() },
    { key: "user:2", kind: "user", title: "Staff awaiting approval", body: "2 new accounts", href: "/users", read: false, createdAt: null },
    { key: "records:3", kind: "records", title: "Records awaiting match", body: "4 records", href: "/records", read: true, createdAt: null },
  ],
  unreadCount: 2,
};

function routes(feed: unknown, me = makeMe(), extra: Record<string, unknown> = {}) {
  return apiRoutes({ "/api/me": me, "/api/notifications": feed, "/api/mobile/ministries/access": { allowed: false }, ...extra });
}
const renderHome = () =>
  render(
    <MeProvider>
      <HomeScreen />
    </MeProvider>,
  );
const shortcutNames = () =>
  screen
    .getAllByRole("button")
    .map((b) => b.props.accessibilityLabel as string)
    .filter((n) => ["My Finance", "My Tickets", "Bookings", "My Schools", "My History", "OKRs", "Ministries", "Staff decisions", "Me"].includes(n));

beforeEach(async () => {
  mockFetch.mockReset();
  (Haptics.impactAsync as jest.Mock).mockClear();
  mockScheme = "light";
  mockShowSchools = false;
  await AsyncStorage.clear();
});

describe("Home (redesign)", () => {
  it("2.1 header: eyebrow with the tick and the greeting as the one page title", async () => {
    mockFetch.mockImplementation(routes(FEED));
    await renderHome();
    expect(await screen.findByRole("header", { name: "Hello, Sample" })).toBeTruthy();
    expect(screen.getByText("FFSA Hub · Home")).toBeTruthy();
    expect(screen.getByTestId("large-title-tick", hidden)).toBeTruthy();
  });

  it.each(["light", "dark"] as const)("2.1 band (%s): yellow fill, black text, count then the first unread title", async (scheme) => {
    mockScheme = scheme;
    mockFetch.mockImplementation(routes(FEED));
    await renderHome();
    const band = await screen.findByTestId("needs-you");
    expect(flat(band.props.style)).toMatchObject({ backgroundColor: colors[scheme].accent, borderRadius: 8 });
    expect(within(band).getByText("Needs you")).toBeTruthy();
    expect(within(band).getByText("2 things need you")).toBeTruthy();
    expect(within(band).getByText("New booking request")).toBeTruthy();
    expect(within(band).getByLabelText("Needs you. 2 things need you. New booking request")).toBeTruthy();
    for (const line of ["Needs you", "2 things need you", "New booking request"]) {
      expect(flat(within(band).getByText(line).props.style).color).toBe(colors[scheme].onAccent);
    }
    expect(screen.getAllByTestId("needs-you")).toHaveLength(1);
  });

  it.each(["light", "dark"] as const)("2.1 rows (%s): unread = filled tile and bold title; read = quiet; web items say so", async (scheme) => {
    mockScheme = scheme;
    mockFetch.mockImplementation(routes(FEED));
    await renderHome();
    const unread = await screen.findByTestId("notification-booking:1");
    const read = screen.getByTestId("notification-records:3");
    const c = colors[scheme];
    expect(flat(within(unread).getAllByText("New booking request")[0].props.style)).toMatchObject({ fontFamily: "Roboto_600SemiBold", color: c.text });
    expect(flat(within(read).getByText("Records awaiting match").props.style)).toMatchObject({ fontFamily: "Roboto_400Regular", color: c.textSecondary });
    // In words, never colour alone.
    expect(unread.props.accessibilityLabel).toMatch(/^Unread\. /);
    expect(within(read).getByText("Opens in browser")).toBeTruthy();
    expect(within(unread).queryByText("Opens in browser")).toBeNull();
    expect(within(unread).getByText("2h ago")).toBeTruthy();
  });

  it("2.1 shortcuts for a leader: fixed order, Ministries and Staff decisions in, My Schools out", async () => {
    const leader = makeMe({ roles: [{ name: "leadership_team", scopeType: null, scopeId: null }] });
    mockFetch.mockImplementation(routes(FEED, leader));
    await renderHome();
    await screen.findByTestId("shortcut-staff-decisions");
    expect(shortcutNames()).toEqual(["My Finance", "My Tickets", "Bookings", "My History", "OKRs", "Ministries", "Staff decisions", "Me"]);
  });

  it("2.1 shortcuts: admin alone gets Ministries but not Staff decisions", async () => {
    mockFetch.mockImplementation(routes(FEED, makeMe({ roles: [{ name: "admin", scopeType: null, scopeId: null }] })));
    await renderHome();
    expect(await screen.findByTestId("shortcut-ministries")).toBeTruthy();
    expect(screen.queryByTestId("shortcut-staff-decisions")).toBeNull();
  });

  it("2.2 nothing unread (student): Earlier only, no band, no caught-up card; My Schools in, leader rows out", async () => {
    mockShowSchools = true;
    mockFetch.mockImplementation(routes({ items: [FEED.items[2]] }));
    await renderHome();
    expect(await screen.findByRole("header", { name: "Earlier" })).toBeTruthy();
    expect(screen.queryByTestId("needs-you")).toBeNull();
    expect(screen.queryByTestId("feed-empty")).toBeNull();
    expect(screen.queryByRole("button", { name: /Mark all/ })).toBeNull();
    expect(shortcutNames()).toEqual(["My Finance", "My Tickets", "Bookings", "My Schools", "My History", "OKRs", "Me"]);
  });

  it("2.3 couldn't refresh: the saved items stay under a calm banner with the server's message; no button", async () => {
    await AsyncStorage.setItem("ffsa:home-feed:v1:u1", JSON.stringify({ savedAt: new Date(NOW).toISOString(), items: FEED.items }));
    mockFetch.mockImplementation(routes(new ApiError("http", "Something went wrong on the server (503). Try again.", 503)));
    await renderHome();
    const banner = await screen.findByTestId("stale-banner");
    expect(within(banner).getByText("Couldn't refresh")).toBeTruthy();
    expect(within(banner).getByText("Something went wrong on the server (503). Try again. Showing saved items.")).toBeTruthy();
    expect(within(banner).queryByRole("button")).toBeNull();
    expect(within(banner).queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("needs-you")).toBeTruthy();
  });

  it("2.5 empty feed: the caught-up card, and shortcuts still there", async () => {
    mockFetch.mockImplementation(routes({ items: [], unreadCount: 0 }));
    await renderHome();
    const card = await screen.findByTestId("feed-empty");
    expect(within(card).getByText("You're all caught up")).toBeTruthy();
    expect(within(card).getByText("Nothing needs you right now. Pull down to check again.")).toBeTruthy();
    expect(screen.queryByRole("header", { name: "Earlier" })).toBeNull();
    expect(screen.getByRole("button", { name: "My Finance" })).toBeTruthy();
  });

  it("2.6 offline: saved copy with how old it is, calm (not an alert)", async () => {
    await AsyncStorage.setItem(
      "ffsa:home-feed:v1:u1",
      JSON.stringify({ savedAt: new Date(NOW - 12 * 60_000).toISOString(), items: FEED.items }),
    );
    mockFetch.mockImplementation(routes(new ApiError("network", "Couldn't reach FFSA Hub.")));
    await renderHome();
    const banner = await screen.findByTestId("offline-banner");
    expect(within(banner).getByText("Offline")).toBeTruthy();
    expect(within(banner).getByText("Showing saved items from 12m ago.")).toBeTruthy();
    expect(within(banner).queryByRole("alert")).toBeNull();
  });

  it.each(["light", "dark"] as const)("2.7 couldn't load (%s): an alert with what to do and Try again; shortcuts still work", async (scheme) => {
    mockScheme = scheme;
    mockFetch.mockImplementation(routes(new ApiError("network", "Couldn't reach FFSA Hub. Check your connection and try again.")));
    await renderHome();
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Couldn't load your notifications")).toBeTruthy();
    expect(within(alert).getByText("Couldn't reach FFSA Hub. Check your connection and try again.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByTestId("needs-you")).toBeNull();
    expect(screen.getByRole("button", { name: "Bookings" })).toBeTruthy();
  });

  it("2.7 permission denied: explained in a card, no band, no retry", async () => {
    mockFetch.mockImplementation(routes(new ApiError("forbidden", "No access.", 403)));
    await renderHome();
    const card = await screen.findByTestId("feed-forbidden");
    expect(within(card).getByText("If you think that's wrong, ask an FFSA Hub admin to check your access.")).toBeTruthy();
    expect(screen.queryByTestId("needs-you")).toBeNull();
  });

  it("13.1 loading: one skeleton in the feed's layout, then it gives way to the feed", async () => {
    let resolveFeed: (v: unknown) => void = () => {};
    mockFetch.mockImplementation((path: string) =>
      path === "/api/notifications" ? new Promise((r) => (resolveFeed = r)) : routes(FEED)(path),
    );
    await renderHome();
    const skeleton = screen.getByTestId("home-skeleton");
    expect(skeleton.props.accessibilityLabel).toBe("Loading your notifications");
    expect(screen.getAllByRole("progressbar")).toHaveLength(1);
    expect(within(skeleton).getAllByTestId("skeleton-block", hidden).length).toBeGreaterThan(6);
    await act(async () => resolveFeed(FEED));
    expect(await screen.findByTestId("needs-you")).toBeTruthy();
    expect(screen.queryByTestId("home-skeleton")).toBeNull();
  });

  it.each(["light", "dark"] as const)("13.4 pull to refresh (%s): ink spinner, a light tap, and the feed is fetched again", async (scheme) => {
    mockScheme = scheme;
    mockFetch.mockImplementation(routes(FEED));
    await renderHome();
    const band = await screen.findByTestId("needs-you");
    const feedCalls = () => mockFetch.mock.calls.filter(([path]) => path === "/api/notifications").length;
    const before = feedCalls();
    const control = refreshControlAround(band as unknown as Host);
    expect(control.tintColor).toBe(colors[scheme].text);
    await act(async () => control.onRefresh());
    expect(Haptics.impactAsync).toHaveBeenCalledWith("light");
    expect(feedCalls()).toBe(before + 1);
  });
});
