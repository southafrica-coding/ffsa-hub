// Accessibility checks for Home (docs/accessibility.md): every tappable has a
// role and a name, headings are headings, and status is in words.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { render, screen } from "@testing-library/react-native";

import { MeProvider } from "@/features/shell";
import { ApiError } from "@/lib/api";
import { auditTappables } from "@/lib/a11y/testing";
import { apiFetch } from "@/lib/api-client";

import { apiRoutes, makeMe } from "../../test/fixtures";
import HomeScreen from "../(app)/index";

jest.mock("@/lib/api-client", () => ({ apiFetch: jest.fn() }));
jest.mock("@/auth/session-provider", () => ({
  useSession: () => ({ status: "signedIn", session: { user: { id: "u1" } } }),
}));
jest.mock("expo-router", () => ({ useRouter: () => ({ navigate: jest.fn(), push: jest.fn(), back: jest.fn() }) }));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn().mockResolvedValue({ type: "dismiss" }) }));
jest.mock("@/features/schools/shortcut", () => ({ useSchoolsShortcut: () => true }));

const mockFetch = apiFetch as unknown as jest.Mock;

const FEED = {
  items: [
    { key: "booking:1", kind: "booking", title: "New booking request", body: "Youth night", href: "/bookings/requests", read: false, createdAt: null },
    { key: "practice:4", kind: "practice", title: "Practice room request", body: "Keys", href: "/prayer-room?tab=practice", read: true, createdAt: null },
  ],
  unreadCount: 1,
};

const renderHome = () =>
  render(
    <MeProvider>
      <HomeScreen />
    </MeProvider>,
  );
const noProblems = () => expect(auditTappables(screen.container as never)).toEqual([]);

beforeEach(async () => {
  mockFetch.mockReset();
  await AsyncStorage.clear();
});

describe("Home accessibility", () => {
  it("loading: one labelled progress element, shortcuts still named", async () => {
    mockFetch.mockImplementation((path: string) => (path === "/api/me" ? Promise.resolve(makeMe()) : new Promise(() => {})));
    await renderHome();
    expect(screen.getByRole("progressbar", { name: "Loading your notifications" })).toBeTruthy();
    expect(screen.getByRole("header", { name: "Shortcuts" })).toBeTruthy();
    noProblems();
  });

  it("success: headings, the band's Open names its item, rows say read state and browser cue in words", async () => {
    mockFetch.mockImplementation(apiRoutes({ "/api/me": makeMe(), "/api/notifications": FEED }));
    await renderHome();
    expect(await screen.findByRole("header", { name: "Hello, Sample" })).toBeTruthy();
    expect(screen.getByRole("header", { name: "Needs you (1)" })).toBeTruthy();
    expect(screen.getByRole("header", { name: "Earlier" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open: New booking request" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mark all 1 as read" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Unread\. New booking request/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /^Practice room request\..*Opens in browser$/ })).toBeTruthy();
    for (const name of ["My Finance", "My Tickets", "Bookings", "Me"]) {
      expect(screen.getByRole("button", { name }).props.accessibilityHint).toBeTruthy();
    }
    noProblems();
  });

  it("empty: the message is a heading", async () => {
    mockFetch.mockImplementation(apiRoutes({ "/api/me": makeMe(), "/api/notifications": { items: [], unreadCount: 0 } }));
    await renderHome();
    expect(await screen.findByRole("header", { name: "You're all caught up" })).toBeTruthy();
    noProblems();
  });

  it("error: a named retry button", async () => {
    mockFetch.mockImplementation(
      apiRoutes({ "/api/me": makeMe(), "/api/notifications": new ApiError("network", "Couldn't reach FFSA Hub.") }),
    );
    await renderHome();
    expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy();
    noProblems();
  });

  it("permission denied: explained under a heading", async () => {
    mockFetch.mockImplementation(
      apiRoutes({ "/api/me": makeMe(), "/api/notifications": new ApiError("forbidden", "No access.", 403) }),
    );
    await renderHome();
    expect(await screen.findByRole("header", { name: "Notifications aren't available on your account" })).toBeTruthy();
    noProblems();
  });
});
