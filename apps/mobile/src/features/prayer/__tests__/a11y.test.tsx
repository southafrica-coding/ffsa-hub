// Accessibility checks for the Prayer tab (docs/accessibility.md): roles,
// names and states of the main controls, 48dp targets, and no unnamed
// tappables in every state. Same mocks as prayer-screen.test.tsx.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, render, screen, within } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";
import type { ReactNode } from "react";
import { AccessibilityInfo, Alert, Platform, StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { MeProvider } from "@/features/shell";
import { ApiError } from "@/lib/api";
import { apiFetch } from "@/lib/api-client";
import { auditTappables, tappableSizes } from "@/lib/a11y/testing";
import { makeMe } from "../../../../test/fixtures";

import { prayerFetch } from "../api-client";
import { PrayerScreen, type Section } from "../screens/PrayerScreen";
import { strings } from "../strings";
import { BLOCKOUT, NOW, UNLED, WALL_META, practiceWeek, prayerSet, person } from "../__fixtures__/fixtures";

let mockNet = { isConnected: true, isInternetReachable: true };

jest.mock("expo-network", () => ({ useNetworkState: () => mockNet }));
jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn(async () => undefined),
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(async () => ({ type: "opened" })) }));
jest.mock("@/lib/api-client", () => ({ apiFetch: jest.fn() }));
jest.mock("@/features/prayer/api-client", () => ({ prayerFetch: jest.fn() }));
jest.mock("@/auth/session-provider", () => ({
  useSession: () => ({ status: "signedIn", session: { user: { id: "u1" } } }),
}));
jest.mock("@/lib/supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }));

const meFetch = apiFetch as unknown as jest.Mock;
const roomFetch = prayerFetch as unknown as jest.Mock;

type Handler = unknown | ((init?: { method?: string; body?: unknown }) => unknown);

/** Route the mocked prayerFetch: longest matching key (path or path prefix) wins. */
function room(handlers: Record<string, Handler>) {
  roomFetch.mockImplementation(async (path: string, init?: { method?: string; body?: unknown; schema?: { parse: (v: unknown) => unknown } }) => {
    const key = Object.keys(handlers)
      .filter((k) => path === k || path.startsWith(k))
      .sort((a, b) => b.length - a.length)[0];
    if (!key) throw new ApiError("http", `No mock for ${path}`, 404);
    const h = handlers[key];
    const value = typeof h === "function" ? await (h as (i?: unknown) => unknown)(init) : await h;
    if (value instanceof Error) throw value;
    return init?.schema ? init.schema.parse(value) : value;
  });
}

const WEEK = {
  "/api/prayer-room/sets?dateFrom": [prayerSet(), UNLED],
  "/api/prayer-room/blockouts": [BLOCKOUT],
  "/api/prayer-room/wall-meta": WALL_META,
  "/api/prayer-room/sets?id=s1": prayerSet(),
  "/api/prayer-room/sets?id=s2": UNLED,
  "/api/prayer-room/requests?kind=seat&setId": [],
};

/** Press the confirm (second) button of the next native alert. */
function confirmNextAlert(choice: "confirm" | "cancel" = "confirm") {
  jest.spyOn(Alert, "alert").mockImplementationOnce((_t, _b, buttons) => {
    const b = buttons?.[choice === "confirm" ? 1 : 0];
    b?.onPress?.();
  });
}

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <SafeAreaProvider initialMetrics={METRICS}>
      <MeProvider>{children}</MeProvider>
    </SafeAreaProvider>
  );
}

async function show(section: Section = "week", me = makeMe()) {
  meFetch.mockImplementation(async (path: string) => {
    if (path === "/api/me") return me;
    throw new Error(`unexpected ${path}`);
  });
  await render(<PrayerScreen now={() => NOW} initialSection={section} />, { wrapper: Wrapper });
}

beforeEach(async () => {
  roomFetch.mockReset();
  meFetch.mockReset();
  (Haptics.notificationAsync as jest.Mock).mockClear();
  mockNet = { isConnected: true, isInternetReachable: true };
  await AsyncStorage.clear();
});

afterEach(() => jest.restoreAllMocks());

const flatten = (s: unknown) => (StyleSheet.flatten(s as never) ?? {}) as Record<string, unknown>;

function expectCleanTappables() {
  expect(auditTappables(screen.container as never)).toEqual([]);
}

/** Every tappable is at least 48dp tall (style or hit slop). */
function expectTargets() {
  for (const t of tappableSizes(screen.container as never, flatten)) {
    const slop = typeof t.hitSlop === "number" ? t.hitSlop * 2 : 0;
    const h = Math.max(Number(t.minHeight ?? 0), Number(t.height ?? 0)) + slop;
    expect({ name: t.name, tall: h >= 48 }).toEqual({ name: t.name, tall: true });
  }
}

const MINE = {
  "/api/prayer-room/sets?scope=invites": [
    {
      id: "sl6",
      role: "keys",
      status: "invited",
      required_label: null,
      set: { id: "s2", set_date: "2026-11-02", start_time: "08:00:00", end_time: "09:30:00", title: "Morning devo", theme: null, owner: person("u9", "Sample", "Person 905") },
    },
  ],
  "/api/prayer-room/sets?scope=owned": [],
  "/api/prayer-room/sets?scope=roster": [],
  ...WEEK,
};

describe("Prayer a11y: week", () => {
  it("loading: one labelled progress element, sections are tabs", async () => {
    room({ "/api/prayer-room/sets": new Promise(() => undefined) });
    await show();
    expect(screen.getByRole("progressbar", { name: strings.week.loading })).toBeTruthy();
    expect(screen.getByRole("tab", { name: strings.segments.week }).props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByRole("tab", { name: strings.segments.practice }).props.accessibilityState).toMatchObject({ selected: false });
    expectCleanTappables();
    expectTargets();
  });

  it("success: masthead and days are headers; set rows say time, length, lead and status in words", async () => {
    room(WEEK);
    await show();
    await screen.findByText("Night watch");
    expect(screen.getByRole("header", { name: strings.title })).toBeTruthy();
    expect(screen.getByRole("header", { name: "Tuesday 3 November" })).toBeTruthy();
    const row = screen.getByRole("button", { name: /^Tuesday 7 to 9 pm, Night watch/ });
    expect(row.props.accessibilityLabel).toMatch(/2 hours\. Led by Sample Person 199$/);
    expect(row.props.accessibilityHint).toBe(strings.set.openHint);
    // The unled set says so in words, not only with a dashed border.
    expect(screen.getByRole("button", { name: /needs a lead/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: strings.week.previous })).toBeTruthy();
    expect(screen.getByRole("button", { name: strings.week.next })).toBeTruthy();
    expectCleanTappables();
    expectTargets();
  });

  it("empty, error and permission-denied states have no unnamed controls", async () => {
    room({ ...WEEK, "/api/prayer-room/sets?dateFrom": [], "/api/prayer-room/blockouts": [] });
    await show();
    expect(await screen.findByRole("header", { name: strings.week.emptyTitle })).toBeTruthy();
    expectCleanTappables();
  });

  it("error: an alert with a named retry, spoken on iOS", async () => {
    const spoken = jest.spyOn(AccessibilityInfo, "announceForAccessibilityWithOptions").mockImplementation(() => {});
    Platform.OS = "ios";
    room({ ...WEEK, "/api/prayer-room/sets?dateFrom": new ApiError("http", "Something went wrong on the server (500). Try again.", 500) });
    await show();
    // With a button inside, the banner's message carries the alert role.
    expect(await screen.findByRole("alert")).toHaveTextContent(new RegExp(strings.errors.title, "i"));
    expect(screen.getByRole("button", { name: strings.errors.retry })).toBeTruthy();
    expect(spoken).toHaveBeenCalledWith(expect.stringContaining(strings.errors.actionFailed.replace(/[.!?]$/, "")), { queue: true });
    expectCleanTappables();
  });

  it("permission denied: a header saying so", async () => {
    room({ ...WEEK, "/api/prayer-room/sets?dateFrom": new ApiError("forbidden", "No", 403) });
    await show();
    expect(await screen.findByRole("header", { name: strings.errors.forbiddenTitle })).toBeTruthy();
    expectCleanTappables();
  });
});

describe("Prayer a11y: set sheet", () => {
  it("is modal, has a header and a named Close; seats are read as one line each", async () => {
    room(WEEK);
    await show();
    await fireEvent.press(await screen.findByTestId("set-s1"));
    const sheet = await screen.findByTestId("set-sheet");
    expect(sheet.props.accessibilityViewIsModal).toBe(true);
    await within(sheet).findByText("Night watch");
    expect(within(sheet).getByRole("header", { name: "Night watch" })).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: strings.set.close })).toBeTruthy();
    expect(within(sheet).getByLabelText("Prayer Lead, Sample Person 199")).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: "Ask to join: Worship Lead" }).props.accessibilityHint).toBeTruthy();
    // The scrim is hidden: Close and the back gesture do its job.
    expect(screen.getAllByRole("button", { name: strings.set.close })).toHaveLength(1);
    expectCleanTappables();
    expectTargets();
  });
});

describe("Prayer a11y: my sets", () => {
  it("invitation buttons name the seat; rows are buttons with hints", async () => {
    room(MINE);
    await show("mine");
    expect(await screen.findByRole("button", { name: "Accept Keys" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Decline Keys" })).toBeTruthy();
    expect(screen.getByRole("link", { name: `${strings.mine.join}. Opens in browser` })).toBeTruthy();
    expectCleanTappables();
    expectTargets();
  });

  it("an action result is spoken on iOS", async () => {
    const spoken = jest.spyOn(AccessibilityInfo, "announceForAccessibilityWithOptions").mockImplementation(() => {});
    Platform.OS = "ios";
    room({ ...MINE, "/api/prayer-room/slots/sl6": { id: "sl6" } });
    await show("mine");
    confirmNextAlert();
    await fireEvent.press(await screen.findByRole("button", { name: "Accept Keys" }));
    await screen.findByText(strings.set.accepted);
    expect(spoken).toHaveBeenCalledWith(strings.set.accepted, { queue: true });
  });
});

describe("Prayer a11y: practice", () => {
  it("rows say the time and how many stations are open; the sheet uses radios", async () => {
    room({ "/api/prayer-room/practice?": practiceWeek() });
    await show("practice");
    const row = await screen.findByTestId("practice-row-2026-11-04-16:00");
    expect(row.props.accessibilityRole).toBe("button");
    expect(row.props.accessibilityLabel).toMatch(/2 of 3 stations open/);
    expectCleanTappables();
    expectTargets();
    await fireEvent.press(row);
    const sheet = await screen.findByTestId("practice-sheet");
    expect(within(sheet).getByRole("radio", { name: "Keys, Open" }).props.accessibilityState).toMatchObject({ checked: true });
    expect(within(sheet).getByRole("radio", { name: "30 min" })).toBeTruthy();
    expectCleanTappables();
    expectTargets();
  });

  it("time columns grow with the text instead of a fixed width", async () => {
    room({ "/api/prayer-room/practice?": practiceWeek() });
    await show("practice");
    const time = within(await screen.findByTestId("practice-row-2026-11-04-16:00")).getByText("16:00–16:30");
    expect(flatten(time.props.style)).toMatchObject({ minWidth: 104 });
    expect(flatten(time.props.style).width).toBeUndefined();
  });
});
