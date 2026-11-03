import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as WebBrowser from "expo-web-browser";

import { getTabBadge, MeProvider } from "@/features/shell";
import { ApiError } from "@/lib/api";
import { apiFetch } from "@/lib/api-client";

import { apiRoutes, makeMe } from "../../test/fixtures";
import HomeScreen from "../(app)/index";

jest.mock("@/lib/api-client", () => ({ apiFetch: jest.fn() }));
jest.mock("@/auth/session-provider", () => ({
  useSession: () => ({ status: "signedIn", session: { user: { id: "u1" } } }),
}));
const mockRouter = { navigate: jest.fn(), push: jest.fn(), back: jest.fn() };
jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn().mockResolvedValue({ type: "dismiss" }) }));

const mockFetch = apiFetch as unknown as jest.Mock;
const openBrowser = WebBrowser.openBrowserAsync as jest.Mock;

const NOW = Date.now();
const FEED = {
  items: [
    {
      key: "booking:1",
      kind: "booking",
      title: "New booking request",
      body: "Youth night · Main hall · 4 Nov",
      href: "/bookings/requests",
      read: false,
      createdAt: new Date(NOW - 2 * 3600_000).toISOString(),
    },
    {
      key: "user:2",
      kind: "user",
      title: "Staff awaiting approval",
      body: "Ben B · b@x",
      href: "/my-finance",
      read: false,
      createdAt: null,
    },
    {
      key: "vehicle:3",
      kind: "vehicle",
      title: "Vehicle request awaiting approval",
      body: "Quantum · 5 Nov",
      href: "/bookings/vehicles/requests",
      read: true,
      createdAt: new Date(NOW - 3 * 86_400_000).toISOString(),
    },
    {
      key: "practice:4",
      kind: "practice",
      title: "Practice room request",
      body: "Keys · Wed 16:00",
      href: "/prayer-room?tab=practice",
      read: true,
      createdAt: new Date(NOW - 4 * 86_400_000).toISOString(),
    },
  ],
  unreadCount: 2,
};

const markReadCalls: unknown[] = [];
function routes(feed: unknown) {
  return apiRoutes({
    "/api/me": makeMe(),
    "/api/notifications": feed,
    "/api/notifications/read": (init?: { body?: unknown }) => {
      markReadCalls.push(init?.body);
      return { ok: true };
    },
  });
}

async function renderHome() {
  return render(
    <MeProvider>
      <HomeScreen />
    </MeProvider>,
  );
}

beforeEach(async () => {
  mockFetch.mockReset();
  openBrowser.mockClear();
  mockRouter.navigate.mockClear();
  markReadCalls.length = 0;
  await AsyncStorage.clear();
});

describe("Home", () => {
  it("loading: shows a skeleton while nothing is saved yet", async () => {
    mockFetch.mockImplementation((path: string) => (path === "/api/me" ? Promise.resolve(makeMe()) : new Promise(() => {})));
    await renderHome();
    expect(screen.getByLabelText("Loading your notifications")).toBeTruthy();
    expect(screen.queryByTestId("needs-you")).toBeNull();
  });

  it("success: greets by name, one yellow band, grouped list, unread badge", async () => {
    mockFetch.mockImplementation(routes(FEED));
    await renderHome();
    expect(await screen.findByRole("header", { name: "Hello, Jo" })).toBeTruthy();
    expect(await screen.findByText("2 things need you")).toBeTruthy();
    expect(screen.getAllByTestId("needs-you")).toHaveLength(1);
    expect(screen.getByText("Needs you (2)")).toBeTruthy();
    expect(screen.getByText("Earlier")).toBeTruthy();
    expect(screen.getByText("2h ago")).toBeTruthy();
    // Items that open the website say so (text cue, not just an icon).
    expect(screen.getByLabelText(/^Practice room request\. .*Opens in browser$/)).toBeTruthy();
    // Booking requests have a screen in the app now.
    expect(screen.getByLabelText(/^Unread\. New booking request\. .*2h ago$/)).toBeTruthy();
    expect(getTabBadge("home")).toBe(2);
  });

  it("success: saves the feed on the device for next time", async () => {
    mockFetch.mockImplementation(routes(FEED));
    await renderHome();
    await screen.findByText("2 things need you");
    await waitFor(async () => expect(await AsyncStorage.getItem("ffsa:home-feed:v1:u1")).toContain("booking:1"));
  });

  it("empty: all caught up, and no yellow band", async () => {
    mockFetch.mockImplementation(routes({ items: [], unreadCount: 0 }));
    await renderHome();
    expect(await screen.findByText("You're all caught up")).toBeTruthy();
    expect(screen.queryByTestId("needs-you")).toBeNull();
    expect(getTabBadge("home")).toBe(0);
  });

  it("everything read: list under Earlier, no band", async () => {
    mockFetch.mockImplementation(routes({ items: [{ ...FEED.items[2] }] }));
    await renderHome();
    expect(await screen.findByText("Vehicle request awaiting approval")).toBeTruthy();
    expect(screen.queryByTestId("needs-you")).toBeNull();
  });

  it("error: plain message and a working retry", async () => {
    let calls = 0;
    mockFetch.mockImplementation(
      routes(() => (++calls === 1 ? new ApiError("network", "Couldn't reach FFSA Hub. Check your connection and try again.") : FEED)),
    );
    await renderHome();
    expect(await screen.findByText("Couldn't reach FFSA Hub. Check your connection and try again.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("2 things need you")).toBeTruthy();
  });

  it("permission denied: explains, no retry loop", async () => {
    mockFetch.mockImplementation(routes(new ApiError("forbidden", "You don't have access to this.", 403)));
    await renderHome();
    expect(await screen.findByText("Notifications aren't available on your account")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("offline: opens with the saved items and says so", async () => {
    await AsyncStorage.setItem(
      "ffsa:home-feed:v1:u1",
      JSON.stringify({ savedAt: new Date(NOW - 10 * 60_000).toISOString(), items: FEED.items }),
    );
    mockFetch.mockImplementation(routes(new ApiError("network", "Couldn't reach FFSA Hub.")));
    await renderHome();
    expect(await screen.findByText("Offline")).toBeTruthy();
    expect(screen.getByText("Showing saved items from 10m ago.")).toBeTruthy();
    expect(screen.getByTestId("notification-booking:1")).toBeTruthy();
  });

  it("server error with saved items: keeps them and says it couldn't refresh", async () => {
    await AsyncStorage.setItem("ffsa:home-feed:v1:u1", JSON.stringify({ savedAt: new Date(NOW).toISOString(), items: FEED.items }));
    mockFetch.mockImplementation(routes(new ApiError("http", "Something went wrong on the server (500). Try again.", 500)));
    await renderHome();
    expect(await screen.findByText("Couldn't refresh")).toBeTruthy();
    expect(screen.getByTestId("notification-booking:1")).toBeTruthy();
  });

  it("signed out by the API: no error shown (the auth gate takes over)", async () => {
    mockFetch.mockImplementation(routes(new ApiError("unauthenticated", "x", 401)));
    await renderHome();
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText("Couldn't load your notifications")).toBeNull();
  });

  it("tapping an item marks it read and opens its screen (booking requests: the in-app approvals)", async () => {
    mockFetch.mockImplementation(routes(FEED));
    await renderHome();
    await fireEvent.press(await screen.findByTestId("notification-booking:1"));
    expect(markReadCalls).toEqual([{ keys: ["booking:1"] }]);
    expect(mockRouter.navigate).toHaveBeenCalledWith("/bookings/approvals");
    expect(openBrowser).not.toHaveBeenCalled();
    expect(await screen.findByText("1 thing needs you")).toBeTruthy();
  });

  it("items with no screen in the app open the website page in the in-app browser", async () => {
    mockFetch.mockImplementation(routes(FEED));
    await renderHome();
    await fireEvent.press(await screen.findByTestId("notification-practice:4"));
    expect(openBrowser).toHaveBeenCalledWith("https://hub.example.test/prayer-room?tab=practice", expect.any(Object));
  });

  it("items whose page exists in the app open inside the app", async () => {
    mockFetch.mockImplementation(routes(FEED));
    await renderHome();
    await fireEvent.press(await screen.findByTestId("notification-user:2"));
    expect(mockRouter.navigate).toHaveBeenCalledWith("/finance");
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it("the band's Open goes to the top unread item", async () => {
    mockFetch.mockImplementation(routes(FEED));
    await renderHome();
    await fireEvent.press(await screen.findByRole("button", { name: "Open: New booking request" }));
    expect(mockRouter.navigate).toHaveBeenCalledWith("/bookings/approvals");
  });

  it("mark all read: one request, band gone, badge cleared", async () => {
    mockFetch.mockImplementation(routes(FEED));
    await renderHome();
    await fireEvent.press(await screen.findByRole("button", { name: "Mark all 2 as read" }));
    expect(markReadCalls).toEqual([{ keys: ["booking:1", "user:2"] }]);
    expect(screen.queryByTestId("needs-you")).toBeNull();
    expect(getTabBadge("home")).toBe(0);
  });

  it("shortcuts go to Finance, Tickets, Bookings and Me", async () => {
    mockFetch.mockImplementation(routes({ items: [] }));
    await renderHome();
    await fireEvent.press(await screen.findByRole("button", { name: "My Finance" }));
    await fireEvent.press(screen.getByRole("button", { name: "My Tickets" }));
    await fireEvent.press(screen.getByRole("button", { name: "Bookings" }));
    await fireEvent.press(screen.getByRole("button", { name: "Me" }));
    expect(mockRouter.navigate.mock.calls).toEqual([["/finance"], ["/tickets"], ["/bookings"], ["/me"]]);
  });
});
