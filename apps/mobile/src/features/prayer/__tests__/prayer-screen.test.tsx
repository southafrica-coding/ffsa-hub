import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";
import type { ReactNode } from "react";
import { Alert } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { MeProvider } from "@/features/shell";
import { ApiError } from "@/lib/api";
import { apiFetch } from "@/lib/api-client";
import { makeMe } from "../../../../test/fixtures";

import { prayerFetch } from "../api-client";
import { weekPayloadSchema } from "../api";
import { weekCacheKey } from "../cache";
import { PrayerScreen, type Section } from "../screens/PrayerScreen";
import { ServerMessageError } from "../server-message";
import { strings } from "../strings";
import { BAND_BOOKING, BLOCKOUT, ME_ID, NOW, UNLED, WALL_META, practiceWeek, prayerSet, person } from "../__fixtures__/fixtures";

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

async function show(section: Section = "week", me = makeMe(), now: Date = NOW) {
  meFetch.mockImplementation(async (path: string) => {
    if (path === "/api/me") return me;
    throw new Error(`unexpected ${path}`);
  });
  await render(<PrayerScreen now={() => now} initialSection={section} />, { wrapper: Wrapper });
}

/** Choose a day in the Mon–Fri strip. */
async function pickDay(date: string) {
  await fireEvent.press(await screen.findByTestId(`day-tab-${date}`));
}

beforeEach(async () => {
  roomFetch.mockReset();
  meFetch.mockReset();
  (Haptics.notificationAsync as jest.Mock).mockClear();
  (WebBrowser.openBrowserAsync as jest.Mock).mockClear();
  mockNet = { isConnected: true, isInternetReachable: true };
  await AsyncStorage.clear();
});

afterEach(() => jest.restoreAllMocks());

// ── Week ────────────────────────────────────────────────────────────────────

describe("Week", () => {
  it("loading: a skeleton with a spoken label", async () => {
    room({ "/api/prayer-room/sets": new Promise(() => undefined) });
    await show();
    expect(screen.getByLabelText(strings.week.loading)).toBeTruthy();
  });

  it("success: a Mon–Fri day strip, today's run of sets, each set read as one sentence", async () => {
    room(WEEK);
    await show();
    expect(await screen.findByText("Night watch")).toBeTruthy();
    // Today (Tuesday) is the day showing; the label reads Monday to Friday.
    expect(screen.getByText("Tue 3 Nov")).toBeTruthy();
    expect(screen.getByText("2–6 Nov · This week")).toBeTruthy();
    expect(screen.getByText("2 sets · 3 seats open")).toBeTruthy();
    // Five days, never a weekend.
    for (const d of ["02", "03", "04", "05", "06"]) expect(screen.getByTestId(`day-tab-2026-11-${d}`)).toBeTruthy();
    expect(screen.queryByTestId("day-tab-2026-11-01")).toBeNull();
    expect(screen.queryByTestId("day-tab-2026-11-07")).toBeNull();
    // One day at a time: Monday's set isn't in Tuesday's run.
    expect(screen.queryByTestId("set-s2")).toBeNull();
    expect(
      screen.getByLabelText("Tuesday 7 to 9 pm, Night watch, NIGHT band, 2 of 4 seats taken, you are on this set. 2 hours. Led by Sample Person 199"),
    ).toBeTruthy();
    const row = within(screen.getByTestId("set-s1"));
    // The time column, the card's words, and "You" in words, not just a heavier border.
    expect(row.getByText("19:00")).toBeTruthy();
    expect(row.getByText("21:00")).toBeTruthy();
    expect(row.getByText("2H")).toBeTruthy();
    expect(row.getByText("Led by Sample Person 199 · 2 of 4 seats taken")).toBeTruthy();
    expect(row.getByText("NIGHT")).toBeTruthy();
    expect(row.getByText("You")).toBeTruthy();
  });

  it("the strip: one marker word per day, today marked, and the chosen day selected", async () => {
    room(WEEK);
    await show();
    await screen.findByText("Night watch");
    const tab = (name: string) => screen.getByRole("tab", { name });
    expect(tab("Monday 2 November, No lead").props.accessibilityState).toMatchObject({ selected: false });
    expect(tab("Tuesday 3 November, today, You").props.accessibilityState).toMatchObject({ selected: true });
    expect(tab("Wednesday 4 November")).toBeTruthy();
    expect(tab("Thursday 5 November, Blocked")).toBeTruthy();
    // The word is on screen too, not only spoken.
    expect(within(screen.getByTestId("day-marker-2026-11-02")).getByText("No lead")).toBeTruthy();
    expect(within(screen.getByTestId("day-marker-2026-11-05")).getByText("Blocked")).toBeTruthy();
    expect(screen.queryByTestId("day-marker-2026-11-04")).toBeNull();
  });

  it("choosing a day shows that day's run: a set that needs a lead, in words", async () => {
    room(WEEK);
    await show();
    await screen.findByText("Night watch");
    await pickDay("2026-11-02");
    expect(screen.getByRole("tab", { name: "Monday 2 November, No lead" }).props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByText("Mon 2 Nov")).toBeTruthy();
    expect(screen.queryByTestId("set-s1")).toBeNull();
    const row = within(screen.getByTestId("set-s2"));
    expect(row.getByText("Morning devo")).toBeTruthy();
    expect(row.getByText(strings.set.needsLead)).toBeTruthy();
    expect(row.getByText(strings.set.invited)).toBeTruthy();
    expect(row.getByText("MORNING")).toBeTruthy();
    expect(row.getByText(`${strings.set.noLead} · 0 of 2 seats taken`)).toBeTruthy();
  });

  it("room blocked: a banner at the top of its day, and a day with nothing says so", async () => {
    room(WEEK);
    await show();
    await screen.findByText("Night watch");
    expect(screen.queryByTestId("blockout-bo1")).toBeNull();
    await pickDay("2026-11-05");
    // The block-out says when, why and where sets move.
    expect(screen.getByTestId("blockout-bo1")).toHaveTextContent("Room blocked 10:00–12:00: Staff meeting. Sets move to Music Room");
    expect(screen.getByText(strings.week.nothingThisDay)).toBeTruthy();
  });

  it("a moved set says where it moved to", async () => {
    room({ ...WEEK, "/api/prayer-room/sets?dateFrom": [prayerSet({ relocation_note: "the Upper Room" })] });
    await show();
    expect(await within(await screen.findByTestId("set-s1")).findByText("Moved to the Upper Room")).toBeTruthy();
  });

  it("a set you set up says 'Your set'", async () => {
    room({
      ...WEEK,
      "/api/prayer-room/sets?dateFrom": [prayerSet({ owner_id: ME_ID, slots: [prayerSet().slots[0]] })],
    });
    await show();
    expect(await within(await screen.findByTestId("set-s1")).findByText(strings.set.yourSet)).toBeTruthy();
  });

  it("at a weekend, 'This week' is the coming Monday to Friday, opening on Monday", async () => {
    room(WEEK);
    // Saturday 7 Nov 2026, 10:00 SAST.
    await show("week", makeMe(), new Date("2026-11-07T08:00:00.000Z"));
    await waitFor(() => expect(roomFetch).toHaveBeenCalledWith("/api/prayer-room/sets?dateFrom=2026-11-08&dateTo=2026-11-14", expect.anything()));
    expect(await screen.findByText("9–13 Nov · This week")).toBeTruthy();
    expect(screen.queryByTestId("week-today")).toBeNull();
    expect(screen.getByRole("tab", { name: "Monday 9 November" }).props.accessibilityState).toMatchObject({ selected: true });
  });

  it("success: the ONE yellow band is the web's: sets nobody leads", async () => {
    room(WEEK);
    await show();
    const band = await screen.findByTestId("needs-lead-band");
    expect(band).toHaveTextContent(new RegExp(strings.week.needLead(1).replace(/\./g, "\\.")));
    expect(screen.queryByTestId("invites-band")).toBeNull();
    expect(within(band).getByText(strings.week.needLeadEyebrow)).toBeTruthy();
    await fireEvent.press(within(band).getByRole("button", { name: strings.week.openFirst }));
    const sheet = await screen.findByTestId("set-sheet");
    expect(await within(sheet).findByText("Morning devo")).toBeTruthy();
    expect(roomFetch).toHaveBeenCalledWith("/api/prayer-room/sets?id=s2", expect.anything());
    // The strip moves to that set's day, so closing the sheet lands on it.
    expect(screen.getByRole("tab", { name: "Monday 2 November, No lead" }).props.accessibilityState).toMatchObject({ selected: true });
  });

  it("no band when every set has a lead", async () => {
    room({ ...WEEK, "/api/prayer-room/sets?dateFrom": [prayerSet()] });
    await show();
    await screen.findByText("Night watch");
    expect(screen.queryByTestId("needs-lead-band")).toBeNull();
  });

  it("empty: says so, and how to move on; the strip stays", async () => {
    room({ ...WEEK, "/api/prayer-room/sets?dateFrom": [], "/api/prayer-room/blockouts": [] });
    await show();
    expect(await screen.findByText(strings.week.emptyTitle)).toBeTruthy();
    expect(screen.getByText(strings.week.emptyBody)).toBeTruthy();
    expect(screen.getByText("nothing booked")).toBeTruthy();
    expect(screen.getByTestId("day-strip")).toBeTruthy();
    expect(screen.queryByTestId("needs-lead-band")).toBeNull();
  });

  it("error: a specific message and a retry that works", async () => {
    let n = 0;
    room({
      ...WEEK,
      "/api/prayer-room/sets?dateFrom": () => (++n === 1 ? new ApiError("http", "Something went wrong on the server (500). Try again.", 500) : [prayerSet()]),
    });
    await show();
    expect(await screen.findByTestId("error-state")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: strings.errors.retry }));
    expect(await screen.findByText("Night watch")).toBeTruthy();
  });

  it("permission denied: a 403 reads as 'not available on your account'", async () => {
    room({ ...WEEK, "/api/prayer-room/sets?dateFrom": new ApiError("forbidden", "You don't have access to this.", 403) });
    await show();
    expect(await screen.findByText(strings.errors.forbiddenTitle)).toBeTruthy();
  });

  it("offline: shows the saved week with 'Offline, showing saved week'", async () => {
    const saved = weekPayloadSchema.parse({ sets: [prayerSet()], blockouts: [], meta: WALL_META });
    await AsyncStorage.setItem(
      weekCacheKey(ME_ID),
      JSON.stringify({ "2026-11-01": { savedAt: "2026-11-02T16:00:00.000Z", data: saved } }),
    );
    mockNet = { isConnected: false, isInternetReachable: false };
    room({ ...WEEK, "/api/prayer-room/sets?dateFrom": new ApiError("network", "Couldn't reach FFSA Hub.") });
    await show();
    expect(await screen.findByText("Night watch")).toBeTruthy();
    expect(await screen.findByTestId("offline-banner")).toHaveTextContent(/Offline, showing saved week/);
    expect(screen.getByTestId("offline-banner")).toHaveTextContent(/Mon 2 Nov at 18:00/);
    expect(screen.queryByTestId("stale-banner")).toBeNull();
  });

  it("refresh failed for another reason: keeps the saved week, says so, offers Try again", async () => {
    const saved = weekPayloadSchema.parse({ sets: [prayerSet()], blockouts: [], meta: WALL_META });
    await AsyncStorage.setItem(
      weekCacheKey(ME_ID),
      JSON.stringify({ "2026-11-01": { savedAt: "2026-11-02T16:00:00.000Z", data: saved } }),
    );
    let n = 0;
    room({
      ...WEEK,
      "/api/prayer-room/sets?dateFrom": () => (++n === 1 ? new ApiError("http", "x", 500) : [prayerSet({ title: "Fresh watch" })]),
    });
    await show();
    const banner = await screen.findByTestId("stale-banner");
    expect(banner).toHaveTextContent(/Couldn't refresh/);
    expect(banner).toHaveTextContent(/Showing the copy saved Mon 2 Nov at 18:00/);
    expect(screen.getByText("Night watch")).toBeTruthy();
    await fireEvent.press(within(banner).getByRole("button", { name: strings.errors.retry }));
    expect(await screen.findByText("Fresh watch")).toBeTruthy();
    expect(screen.queryByTestId("stale-banner")).toBeNull();
  });

  it("saves each week it loads, for next time", async () => {
    room(WEEK);
    await show();
    await screen.findByText("Night watch");
    await waitFor(async () => expect(await AsyncStorage.getItem(weekCacheKey(ME_ID))).toContain("Night watch"));
  });

  it("previous / next / this week move the range fetched", async () => {
    room(WEEK);
    await show();
    await screen.findByText("Night watch");
    expect(screen.queryByTestId("week-today")).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: strings.week.next }));
    await waitFor(() => expect(roomFetch).toHaveBeenCalledWith("/api/prayer-room/sets?dateFrom=2026-11-08&dateTo=2026-11-14", expect.anything()));
    // The API range stays Sunday-keyed; the label reads Monday to Friday.
    expect(await screen.findByLabelText(/^Week of 9–13 Nov 2026\./)).toBeTruthy();
    expect(screen.getByText("9–13 Nov 2026")).toBeTruthy();
    // Another week opens on its Monday.
    expect(screen.getByRole("tab", { name: "Monday 9 November" }).props.accessibilityState).toMatchObject({ selected: true });

    await fireEvent.press(screen.getByRole("button", { name: strings.week.today }));
    expect(await screen.findByLabelText(/^Week of 2–6 Nov 2026, this week/)).toBeTruthy();
    // Back on this week: today again.
    expect(await screen.findByRole("tab", { name: "Tuesday 3 November, today, You" })).toBeTruthy();
    expect(screen.queryByTestId("week-today")).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: strings.week.previous }));
    await waitFor(() => expect(roomFetch).toHaveBeenCalledWith("/api/prayer-room/sets?dateFrom=2026-10-25&dateTo=2026-10-31", expect.anything()));
  });
});

// ── Set sheet ───────────────────────────────────────────────────────────────

describe("Set sheet", () => {
  // s1 is on Tuesday (today), s2 on Monday.
  const DAY_OF: Record<string, string> = { s1: "2026-11-03", s2: "2026-11-02" };

  async function openSet(id: string, extra: Record<string, Handler> = {}) {
    room({ ...WEEK, ...extra });
    await show();
    await pickDay(DAY_OF[id]);
    await fireEvent.press(await screen.findByTestId(`set-${id}`));
    return screen.findByTestId("set-sheet");
  }

  it("shows the lineup, leads first, and who's in each seat", async () => {
    const sheet = await openSet("s1");
    expect(await within(sheet).findByText("Night watch")).toBeTruthy();
    expect(within(sheet).getByText("Tue 3 Nov · 19:00–21:00 · 2H")).toBeTruthy();
    expect(within(sheet).getByText("NIGHT")).toBeTruthy();
    expect(within(sheet).getByText("2 seats open")).toBeTruthy();
    // One row per seat, the two lead seats first.
    const seats = within(sheet).getAllByTestId(/^seat-/).map((n) => n.props.testID);
    expect(seats).toEqual(["seat-sl1", "seat-sl2", "seat-sl3", "seat-sl4"]);
    expect(within(sheet).getByLabelText("Prayer Lead, Sample Person 199")).toBeTruthy();
    expect(within(sheet).getByLabelText("Keys, You")).toBeTruthy();
    expect(within(sheet).getByText("Set up by Sample Person 59 · Led by Sample Person 199")).toBeTruthy();
    // Not the owner: the leave note, not the management link.
    expect(within(sheet).getByText(strings.set.leaveNote("Sample Person 59"))).toBeTruthy();
    expect(within(sheet).queryByTestId("manage-on-web")).toBeNull();
  });

  it("asks for an open seat, after a confirmation, with a haptic", async () => {
    const posted: unknown[] = [];
    const sheet = await openSet("s1", {
      "/api/prayer-room/requests?kind=seat": (init?: { method?: string; body?: unknown }) => {
        if (init?.method === "POST") posted.push(init.body);
        return init?.method === "POST" ? { ok: true } : [];
      },
    });
    confirmNextAlert();
    await fireEvent.press(await within(sheet).findByRole("button", { name: "Ask to join: Worship Lead" }));
    expect(await within(sheet).findByText(strings.set.requestSent)).toBeTruthy();
    expect(posted).toEqual([{ set_id: "s1", seat_type_id: "worship_lead" }]);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith("success");
  });

  it("cancelling the confirmation sends nothing", async () => {
    const sheet = await openSet("s1");
    confirmNextAlert("cancel");
    await fireEvent.press(await within(sheet).findByRole("button", { name: "Ask to join: Worship Lead" }));
    expect(roomFetch).not.toHaveBeenCalledWith("/api/prayer-room/requests?kind=seat", expect.objectContaining({ method: "POST" }));
  });

  it("a seat I've already asked for says so instead of offering the button again", async () => {
    const sheet = await openSet("s1", {
      "/api/prayer-room/requests?kind=seat&setId": [{ id: "r1", set_id: "s1", seat_type_id: "vocals", user_id: ME_ID, state: "pending" }],
    });
    expect(await within(sheet).findByTestId("asked-sl4")).toHaveTextContent(strings.set.asked);
    expect(within(sheet).getByRole("button", { name: "Ask to join: Worship Lead" })).toBeTruthy();
  });

  it("accepts an invitation", async () => {
    const puts: unknown[] = [];
    const sheet = await openSet("s2", {
      "/api/prayer-room/slots/": (init?: { method?: string; body?: unknown }) => {
        puts.push(init?.body);
        return { id: "sl6" };
      },
    });
    confirmNextAlert();
    await fireEvent.press(await within(sheet).findByRole("button", { name: "Accept Keys" }));
    expect(await within(sheet).findByText(strings.set.accepted)).toBeTruthy();
    expect(puts).toEqual([{ action: "accept" }]);
  });

  it("clash from the database: shows its sentence, not a generic error", async () => {
    const sheet = await openSet("s2", {
      "/api/prayer-room/slots/": new ServerMessageError(
        new ApiError("http", "x", 409),
        "You're already serving in another set that overlaps this time.",
      ),
    });
    confirmNextAlert();
    await fireEvent.press(await within(sheet).findByRole("button", { name: "Accept Keys" }));
    expect(await within(sheet).findByTestId("action-error")).toHaveTextContent(
      "You're already serving in another set that overlaps this time.",
    );
    expect(Haptics.notificationAsync).toHaveBeenCalledWith("error");
  });

  it("someone took the seat first: 'Someone just took this seat. Pick another.'", async () => {
    const sheet = await openSet("s2", {
      "/api/prayer-room/slots/": new ServerMessageError(new ApiError("http", "x", 409), "JSON object requested, multiple (or no) rows returned"),
    });
    confirmNextAlert();
    await fireEvent.press(await within(sheet).findByRole("button", { name: "Accept Keys" }));
    expect(await within(sheet).findByTestId("action-error")).toHaveTextContent(strings.errors.seatTaken);
  });

  it("the owner gets the website link to fill seats, not 'Ask to join'", async () => {
    room({ ...WEEK, "/api/prayer-room/sets?id=s1": prayerSet({ owner_id: ME_ID, owner: person(ME_ID, "Sample", "Person") }) });
    await show();
    await fireEvent.press(await screen.findByTestId("set-s1"));
    const sheet = await screen.findByTestId("set-sheet");
    await fireEvent.press(await within(sheet).findByTestId("manage-on-web"));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith("https://hub.example.test/prayer-room", expect.anything());
    expect(within(sheet).queryByRole("button", { name: /Ask to join/ })).toBeNull();
    // The website row replaces the "Can't make it?" note.
    expect(within(sheet).queryByText(/Can't make it/)).toBeNull();
  });

  it("theme and scripture chips, 'If you walk in', 'Moved to' and 'Repeats weekly' show when set", async () => {
    const sheet = await openSet("s1", {
      "/api/prayer-room/sets?id=s1": prayerSet({
        theme: "Harvest",
        scripture: "Matthew 9:38",
        setlist: "Psalm 24, then open worship",
        relocation_note: "the Upper Room",
        series_id: "ser1",
      }),
    });
    expect(await within(sheet).findByText(strings.set.praying)).toBeTruthy();
    expect(within(sheet).getByText("South Africa's schools")).toBeTruthy();
    expect(within(sheet).getByText("Harvest")).toBeTruthy();
    expect(within(sheet).getByText("Matthew 9:38")).toBeTruthy();
    expect(within(sheet).getByText(strings.set.walkIn)).toBeTruthy();
    expect(within(sheet).getByText("Psalm 24, then open worship")).toBeTruthy();
    expect(within(sheet).getByText("Moved to the Upper Room")).toBeTruthy();
    expect(within(sheet).getByText(strings.set.repeats)).toBeTruthy();
  });

  it("declines an invitation after a destructive confirmation", async () => {
    const puts: unknown[] = [];
    const sheet = await openSet("s2", {
      "/api/prayer-room/slots/": (init?: { method?: string; body?: unknown }) => {
        puts.push(init?.body);
        return { id: "sl6" };
      },
    });
    const alert = jest.spyOn(Alert, "alert").mockImplementationOnce((_t, _b, buttons) => buttons?.[1]?.onPress?.());
    await fireEvent.press(await within(sheet).findByRole("button", { name: "Decline Keys" }));
    expect(await within(sheet).findByText(strings.set.declined)).toBeTruthy();
    expect(puts).toEqual([{ action: "decline" }]);
    expect(alert.mock.calls[0][0]).toBe(strings.set.confirmDeclineTitle);
    expect(alert.mock.calls[0][2]?.[1]).toMatchObject({ text: strings.set.decline, style: "destructive" });
  });

  it("a set that's gone: says so", async () => {
    const sheet = await openSet("s1", { "/api/prayer-room/sets?id=s1": new ApiError("http", "x", 500) });
    expect(await within(sheet).findByText(strings.set.notFound)).toBeTruthy();
  });
});

// ── My sets ─────────────────────────────────────────────────────────────────

const INVITE = {
  id: "sl6",
  role: "keys",
  status: "invited",
  required_label: null,
  set: { id: "s2", set_date: "2026-11-02", start_time: "08:00:00", end_time: "09:30:00", title: "Morning devo", theme: null, owner: person("u9", "Sample", "Person 905") },
};

const MINE = {
  "/api/prayer-room/sets?scope=invites": [INVITE],
  "/api/prayer-room/sets?scope=owned": [],
  "/api/prayer-room/sets?scope=roster": [
    { id: "sl3", role: "keys", status: "filled", set: { id: "s1", set_date: "2026-11-03", start_time: "19:00:00", end_time: "21:00:00", title: "Night watch", theme: null, status: "scheduled", owner: null } },
    { id: "old", role: "keys", status: "filled", set: { id: "s0", set_date: "2026-10-20", start_time: "19:00:00", end_time: "21:00:00", title: "Old set", theme: null, status: "completed", owner: null } },
  ],
  ...WEEK,
};

describe("My sets", () => {
  it("loading", async () => {
    room({ ...MINE, "/api/prayer-room/sets?scope=invites": new Promise(() => undefined) });
    await show("mine");
    expect(screen.getByLabelText(strings.mine.loading)).toBeTruthy();
  });

  it("success: invitations (the yellow band), upcoming sets only", async () => {
    room(MINE);
    await show("mine");
    const band = await screen.findByTestId("invites-band");
    expect(within(band).getByText(strings.mine.needsYou)).toBeTruthy();
    expect(within(band).getByText(strings.mine.invitationsBand(1))).toBeTruthy();
    expect(within(screen.getByTestId("invite-sl6")).getByText("Keys · Morning devo")).toBeTruthy();
    expect(within(screen.getByTestId("invite-sl6")).getByText("Mon 2 Nov · 08:00–09:30 · Sample Person 905")).toBeTruthy();
    expect(screen.getByText("Keys · Night watch")).toBeTruthy();
    expect(screen.queryByText("Keys · Old set")).toBeNull();
    expect(screen.getByText(strings.mine.noLeading)).toBeTruthy();
    // No week stepper here, and no "coming later" copy.
    expect(screen.queryByTestId("week-prev")).toBeNull();
    expect(screen.queryByText(/coming later|coming soon|calendar/i)).toBeNull();
  });

  it("sections in order: Invitations, serving in, set up, more on the website", async () => {
    room({
      ...MINE,
      "/api/prayer-room/sets?scope=owned": [prayerSet({ id: "s7", set_date: "2026-11-09", title: "Night", series_id: "ser1", owner_id: ME_ID })],
    });
    await show("mine");
    await screen.findByTestId("invites-band");
    const order = [strings.mine.invitations, strings.mine.serving, strings.mine.leading, strings.mine.more];
    const headers = screen.getAllByRole("header").map((h) => h.props.children).filter((t) => order.includes(t));
    expect(headers).toEqual(order);
    expect(within(screen.getByTestId("leading-s7")).getByText("Mon 9 Nov · 19:00–21:00 · Repeats weekly")).toBeTruthy();
  });

  it("a row opens the set sheet", async () => {
    room(MINE);
    await show("mine");
    await fireEvent.press(await screen.findByTestId("serving-sl3"));
    const sheet = await screen.findByTestId("set-sheet");
    expect(await within(sheet).findByText("Tue 3 Nov · 19:00–21:00 · 2H")).toBeTruthy();
  });

  it("permission denied: a 403 reads as 'not available on your account'", async () => {
    room({ ...MINE, "/api/prayer-room/sets?scope=invites": new ApiError("forbidden", "x", 403) });
    await show("mine");
    expect(await screen.findByText(strings.errors.forbiddenTitle)).toBeTruthy();
    expect(screen.getByTestId("join-on-web")).toBeTruthy();
  });

  it("accepting an invitation reloads the list", async () => {
    let accepted = false;
    room({
      ...MINE,
      "/api/prayer-room/sets?scope=invites": () => (accepted ? [] : [INVITE]),
      "/api/prayer-room/slots/sl6": () => {
        accepted = true;
        return { id: "sl6" };
      },
    });
    await show("mine");
    confirmNextAlert();
    await fireEvent.press(await screen.findByRole("button", { name: "Accept Keys" }));
    expect(await screen.findByText(strings.set.accepted)).toBeTruthy();
    expect(await screen.findByText(strings.mine.noInvitations)).toBeTruthy();
    expect(screen.queryByTestId("invites-band")).toBeNull();
  });

  it("empty: nothing waiting, nothing booked", async () => {
    room({ ...MINE, "/api/prayer-room/sets?scope=invites": [], "/api/prayer-room/sets?scope=roster": [] });
    await show("mine");
    expect(await screen.findByText(strings.mine.noInvitations)).toBeTruthy();
    expect(screen.getByText(strings.mine.noServing)).toBeTruthy();
  });

  it("error with retry", async () => {
    room({ ...MINE, "/api/prayer-room/sets?scope=roster": new ApiError("timeout", "The server took too long to answer. Try again.") });
    await show("mine");
    expect(await screen.findByText("The server took too long to answer. Try again.")).toBeTruthy();
  });

  it("permission denied: evaluator tools are hidden from ordinary members", async () => {
    room(MINE);
    await show("mine");
    await screen.findByTestId("invites-band");
    expect(screen.queryByTestId("evaluator-tools")).toBeNull();
    expect(screen.getByTestId("join-on-web")).toBeTruthy();
  });

  it("evaluators get ONE row that opens the web's evaluator tools", async () => {
    room(MINE);
    await show("mine", makeMe({ permissions: [{ key: "prayer_room.evaluate", scopeType: null, scopeId: null, source: "direct" }] }));
    await fireEvent.press(await screen.findByTestId("evaluator-tools"));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith("https://hub.example.test/prayer-room", expect.anything());
  });
});

// ── Practice ────────────────────────────────────────────────────────────────

describe("Practice", () => {
  it("loading", async () => {
    room({ "/api/prayer-room/practice?": new Promise(() => undefined) });
    await show("practice");
    expect(screen.getByLabelText(strings.practice.loading)).toBeTruthy();
  });

  it("success: my bookings, the closed day, and each row's state", async () => {
    room({ "/api/prayer-room/practice?": practiceWeek() });
    await show("practice");
    expect(await screen.findByTestId("my-practice-pb2")).toHaveTextContent(/Keys/);
    expect(within(screen.getByTestId("practice-day-2026-11-03")).getByText("Ministry night. No practice.")).toBeTruthy();
    expect(screen.getByTestId("practice-row-2026-11-04-16:00")).toHaveTextContent(/2 of 3 stations open/);
    // The week label is the same Monday–Friday one; no set summary under it here.
    expect(screen.getByText("2–6 Nov · This week")).toBeTruthy();
    expect(screen.getByText(strings.practice.intro("16:00", "17:30", 60))).toBeTruthy();
    expect(within(screen.getByTestId("my-practice-pb2")).getByText("Thu 5 Nov · 16:30–17:30")).toBeTruthy();
  });

  it("each row has a square per station, and says who has what", async () => {
    room({ "/api/prayer-room/practice?": practiceWeek() });
    await show("practice");
    const squares = within(await screen.findByTestId("practice-squares-2026-11-04-16:00", { includeHiddenElements: true }));
    for (const name of ["KEYS", "DRUMS", "VOX"]) expect(squares.getByText(name, { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId("practice-row-2026-11-04-16:00").props.accessibilityLabel).toBe(
      "4 to 4:30 pm, 2 of 3 stations open. Taken: Drums, Sample Person 199",
    );
    // My own booking's rows carry "You" in words.
    const mine = screen.getByTestId("practice-row-2026-11-05-16:30");
    expect(within(mine).getByText(strings.set.you)).toBeTruthy();
    expect(mine.props.accessibilityLabel).toBe("4:30 to 5 pm, 2 of 3 stations open. Taken: Keys, You");
    expect(within(screen.getByTestId("practice-row-2026-11-04-16:00")).queryByText(strings.set.you)).toBeNull();
  });

  it("a row whose time has gone says so", async () => {
    room({ "/api/prayer-room/practice?": practiceWeek({ now: "2026-11-04T16:45" }) });
    await show("practice");
    const row = await screen.findByTestId("practice-row-2026-11-04-16:00");
    expect(within(row).getByText(strings.practice.gone)).toBeTruthy();
    expect(row.props.accessibilityLabel).toMatch(/This time has gone$/);
  });

  it("nothing booked: says so", async () => {
    room({ "/api/prayer-room/practice?": practiceWeek({ bookings: [] }) });
    await show("practice");
    expect(await screen.findByText(strings.practice.noneYours)).toBeTruthy();
  });

  it("the booking sheet lays the stations out two to a row", async () => {
    room({ "/api/prayer-room/practice?": practiceWeek() });
    await show("practice");
    await fireEvent.press(await screen.findByTestId("practice-row-2026-11-04-16:00"));
    const sheet = await screen.findByTestId("practice-sheet");
    expect(within(sheet).getByText("Wed 4 Nov · 16:00")).toBeTruthy();
    expect(within(sheet).getByText("1 of 3 taken")).toBeTruthy();
    const rowOf = (id: string) => within(sheet).getByTestId(`station-${id}`).parent;
    expect(rowOf("st-keys")).toBe(rowOf("st-drums"));
    expect(rowOf("st-vocals")).not.toBe(rowOf("st-keys"));
    expect(within(sheet).getByTestId("station-st-drums")).toHaveTextContent(/Taken by Sample Person 199/);
    expect(within(sheet).getByText("Keys is free for the next half hour too.")).toBeTruthy();
    expect(within(sheet).getByText(strings.practice.groupOnWeb)).toBeTruthy();
  });

  it("60 minutes isn't offered when the station is taken in the next row, and says why", async () => {
    room({ "/api/prayer-room/practice?": practiceWeek() });
    await show("practice");
    // Thu 16:00: Keys is mine from 16:30.
    await fireEvent.press(await screen.findByTestId("practice-row-2026-11-05-16:00"));
    const sheet = await screen.findByTestId("practice-sheet");
    expect(within(sheet).getByRole("radio", { name: "60 min" }).props.accessibilityState).toMatchObject({ disabled: true });
    expect(within(sheet).getByText(strings.practice.takenNext("Keys", "16:30"))).toBeTruthy();
  });

  it("books a station for 60 minutes after a confirmation", async () => {
    const posts: unknown[] = [];
    room({
      "/api/prayer-room/practice?": practiceWeek(),
      "/api/prayer-room/practice/bookings": (init?: { body?: unknown }) => {
        posts.push(init?.body);
        return { id: "pb9" };
      },
    });
    await show("practice");
    await fireEvent.press(await screen.findByTestId("practice-row-2026-11-04-16:00"));
    const sheet = await screen.findByTestId("practice-sheet");
    // Your instrument is pre-selected.
    expect(within(sheet).getByRole("radio", { name: "Keys, Open" }).props.accessibilityState).toMatchObject({ checked: true });
    await fireEvent.press(within(sheet).getByRole("radio", { name: "60 min" }));
    confirmNextAlert();
    await fireEvent.press(within(sheet).getByTestId("book-station"));
    await waitFor(() =>
      expect(posts).toEqual([{ kind: "station", date: "2026-11-04", start: "16:00", end: "17:00", stationId: "st-keys", singers: [] }]),
    );
    expect(await screen.findByText(strings.practice.booked("Keys", "16:00–17:00"))).toBeTruthy();
  });

  it("the database's clash ('someone got there first') shows in the sheet", async () => {
    room({
      "/api/prayer-room/practice?": practiceWeek(),
      "/api/prayer-room/practice/bookings": new ServerMessageError(new ApiError("http", "x", 409), "Someone already has that station then."),
    });
    await show("practice");
    await fireEvent.press(await screen.findByTestId("practice-row-2026-11-04-16:00"));
    const sheet = await screen.findByTestId("practice-sheet");
    confirmNextAlert();
    await fireEvent.press(within(sheet).getByTestId("book-station"));
    expect(await within(sheet).findByTestId("action-error")).toHaveTextContent("Someone already has that station then.");
  });

  it("cancels my own booking", async () => {
    const deletes: string[] = [];
    room({
      "/api/prayer-room/practice?": practiceWeek(),
      "/api/prayer-room/practice/bookings/": (init?: { method?: string }) => {
        deletes.push(init?.method ?? "");
        return { ok: true };
      },
    });
    await show("practice");
    confirmNextAlert();
    await fireEvent.press(await screen.findByRole("button", { name: "Cancel booking: Keys, Thu 5 Nov 16:30–17:30" }));
    expect(await screen.findByText(strings.practice.cancelled)).toBeTruthy();
    expect(deletes).toEqual(["DELETE"]);
  });

  it("not on the team: can see, can't book, and is told why", async () => {
    room({ "/api/prayer-room/practice?": practiceWeek({ me: { canBook: false, isStaff: false, defaultStationId: null } }) });
    await show("practice");
    expect(await screen.findByText(strings.practice.cantBook)).toBeTruthy();
    await fireEvent.press(screen.getByTestId("practice-row-2026-11-04-16:00"));
    const sheet = await screen.findByTestId("practice-sheet");
    expect(within(sheet).getByTestId("book-station").props.accessibilityState).toMatchObject({ disabled: true });
    // The reason sits above the disabled button.
    expect(within(sheet).getByTestId("blocked-reason")).toHaveTextContent(strings.practice.cantBook);
  });

  it("before Sunday's opening: says when bookings open", async () => {
    room({ "/api/prayer-room/practice?": practiceWeek({ now: "2026-10-31T10:00" }) });
    await show("practice");
    expect(await screen.findByTestId("not-open")).toHaveTextContent("Bookings for this week open Sun 1 Nov at 00:00.");
    // The rows still show, and the sheet's Book button is disabled with the reason.
    await fireEvent.press(screen.getByTestId("practice-row-2026-11-04-16:00"));
    const sheet = await screen.findByTestId("practice-sheet");
    expect(within(sheet).getByTestId("book-station").props.accessibilityState).toMatchObject({ disabled: true });
    expect(within(sheet).getByTestId("blocked-reason")).toHaveTextContent("Bookings for this week open Sun 1 Nov at 00:00.");
  });

  it("a band row explains the whole room is taken", async () => {
    room({ "/api/prayer-room/practice?": practiceWeek({ bookings: [BAND_BOOKING] }) });
    await show("practice");
    await fireEvent.press(await screen.findByTestId("practice-row-2026-11-06-16:30"));
    const sheet = await screen.findByTestId("practice-sheet");
    expect(within(sheet).getByText(strings.practice.bandRoom)).toBeTruthy();
    expect(within(sheet).queryByTestId("book-station")).toBeNull();
    // The row itself names the band and has no station squares.
    expect(screen.getByTestId("practice-row-2026-11-06-16:30")).toHaveTextContent(/Full band: The Sends/);
    expect(screen.queryByTestId("practice-squares-2026-11-06-16:30", { includeHiddenElements: true })).toBeNull();
  });

  it("permission denied", async () => {
    room({ "/api/prayer-room/practice?": new ApiError("forbidden", "x", 403) });
    await show("practice");
    expect(await screen.findByText(strings.errors.forbiddenTitle)).toBeTruthy();
  });
});

describe("sections", () => {
  it("are a labelled tab strip; switching keeps the week", async () => {
    room({ ...WEEK, ...MINE, "/api/prayer-room/practice?": practiceWeek() });
    await show();
    await screen.findByText("Night watch");
    await fireEvent.press(screen.getByRole("button", { name: strings.week.next }));
    await fireEvent.press(screen.getByRole("tab", { name: strings.segments.practice }));
    await waitFor(() => expect(roomFetch).toHaveBeenCalledWith("/api/prayer-room/practice?week=2026-11-08", expect.anything()));
    expect(screen.getByRole("tab", { name: strings.segments.practice }).props.accessibilityState).toMatchObject({ selected: true });
    expect(await screen.findByText("9–13 Nov 2026")).toBeTruthy();
  });

  it("the chosen day survives a visit to another section", async () => {
    room({ ...WEEK, ...MINE, "/api/prayer-room/practice?": practiceWeek() });
    await show();
    await screen.findByText("Night watch");
    await pickDay("2026-11-02");
    await fireEvent.press(screen.getByRole("tab", { name: strings.segments.mine }));
    await screen.findByTestId("invites-band");
    await fireEvent.press(screen.getByRole("tab", { name: strings.segments.week }));
    expect(await screen.findByTestId("set-s2")).toBeTruthy();
  });
});
