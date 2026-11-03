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

  it("success: days as a vertical run, each set read as one sentence", async () => {
    room(WEEK);
    await show();
    expect(await screen.findByText("Night watch")).toBeTruthy();
    expect(screen.getByText("Tue 3 Nov")).toBeTruthy();
    // Mon–Fri always appear; a weekend with nothing on doesn't.
    expect(screen.getByTestId("day-2026-11-06")).toBeTruthy();
    expect(screen.queryByTestId("day-2026-11-07")).toBeNull();
    expect(screen.getByLabelText("Tuesday 7 to 9 pm, Night watch, NIGHT band, 2 of 4 seats taken, you are on this set")).toBeTruthy();
    // "You" in words, not just a heavier border.
    expect(within(screen.getByTestId("set-s1")).getByText("You")).toBeTruthy();
    // The block-out says where sets move.
    expect(screen.getByText("Room blocked 10:00–12:00: Staff meeting. Sets move to Music Room")).toBeTruthy();
  });

  it("success: the ONE yellow band is the web's: sets nobody leads", async () => {
    room(WEEK);
    await show();
    const band = await screen.findByTestId("needs-lead-band");
    expect(band).toHaveTextContent(new RegExp(strings.week.needLead(1).replace(/\./g, "\\.")));
    expect(screen.queryByTestId("invites-band")).toBeNull();
    await fireEvent.press(within(band).getByRole("button", { name: strings.week.openFirst }));
    const sheet = await screen.findByTestId("set-sheet");
    expect(await within(sheet).findByText("Morning devo")).toBeTruthy();
    expect(roomFetch).toHaveBeenCalledWith("/api/prayer-room/sets?id=s2", expect.anything());
  });

  it("no band when every set has a lead", async () => {
    room({ ...WEEK, "/api/prayer-room/sets?dateFrom": [prayerSet()] });
    await show();
    await screen.findByText("Night watch");
    expect(screen.queryByTestId("needs-lead-band")).toBeNull();
  });

  it("empty: says so, and how to move on", async () => {
    room({ ...WEEK, "/api/prayer-room/sets?dateFrom": [], "/api/prayer-room/blockouts": [] });
    await show();
    expect(await screen.findByText(strings.week.emptyTitle)).toBeTruthy();
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
    expect(screen.getByLabelText("Week of 8–14 Nov 2026")).toBeTruthy();

    await fireEvent.press(screen.getByRole("button", { name: strings.week.today }));
    expect(await screen.findByLabelText("Week of 1–7 Nov 2026")).toBeTruthy();

    await fireEvent.press(screen.getByRole("button", { name: strings.week.previous }));
    await waitFor(() => expect(roomFetch).toHaveBeenCalledWith("/api/prayer-room/sets?dateFrom=2026-10-25&dateTo=2026-10-31", expect.anything()));
  });
});

// ── Set sheet ───────────────────────────────────────────────────────────────

describe("Set sheet", () => {
  async function openSet(id: string, extra: Record<string, Handler> = {}) {
    room({ ...WEEK, ...extra });
    await show();
    await fireEvent.press(await screen.findByTestId(`set-${id}`));
    return screen.findByTestId("set-sheet");
  }

  it("shows the lineup, leads first, and who's in each seat", async () => {
    const sheet = await openSet("s1");
    expect(await within(sheet).findByText("Night watch")).toBeTruthy();
    expect(within(sheet).getByLabelText("Prayer Lead, Thabo")).toBeTruthy();
    expect(within(sheet).getByLabelText("Keys, You")).toBeTruthy();
    expect(within(sheet).getByText("Set up by Grace Dlamini · Led by Thabo")).toBeTruthy();
    // Not the owner: the leave note, not the management link.
    expect(within(sheet).getByText(strings.set.leaveNote("Grace"))).toBeTruthy();
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
    room({ ...WEEK, "/api/prayer-room/sets?id=s1": prayerSet({ owner_id: ME_ID, owner: person(ME_ID, "Jo", "Smit") }) });
    await show();
    await fireEvent.press(await screen.findByTestId("set-s1"));
    const sheet = await screen.findByTestId("set-sheet");
    await fireEvent.press(await within(sheet).findByTestId("manage-on-web"));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith("https://hub.example.test/prayer-room", expect.anything());
    expect(within(sheet).queryByRole("button", { name: /Ask to join/ })).toBeNull();
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
  set: { id: "s2", set_date: "2026-11-02", start_time: "08:00:00", end_time: "09:30:00", title: "Morning devo", theme: null, owner: person("u9", "Grace", "Dlamini") },
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
    expect(await screen.findByTestId("invites-band")).toHaveTextContent(strings.mine.invitationsBand(1));
    expect(screen.getByText("Keys · Night watch")).toBeTruthy();
    expect(screen.queryByText("Keys · Old set")).toBeNull();
    expect(screen.getByText(strings.mine.noLeading)).toBeTruthy();
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
  });

  it("before Sunday's opening: says when bookings open", async () => {
    room({ "/api/prayer-room/practice?": practiceWeek({ now: "2026-10-31T10:00" }) });
    await show("practice");
    expect(await screen.findByTestId("not-open")).toHaveTextContent("Bookings for this week open Sun 1 Nov at 00:00.");
  });

  it("a band row explains the whole room is taken", async () => {
    room({ "/api/prayer-room/practice?": practiceWeek({ bookings: [BAND_BOOKING] }) });
    await show("practice");
    await fireEvent.press(await screen.findByTestId("practice-row-2026-11-06-16:30"));
    const sheet = await screen.findByTestId("practice-sheet");
    expect(within(sheet).getByText(strings.practice.bandRoom)).toBeTruthy();
    expect(within(sheet).queryByTestId("book-station")).toBeNull();
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
  });
});
