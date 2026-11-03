import AsyncStorage from "@react-native-async-storage/async-storage";

import { ApiError, type ApiDeps } from "@/lib/api";

import {
  askForSeat,
  bookStation,
  cancelPracticeBooking,
  getCommitments,
  getPendingSeatRequests,
  getPracticeWeek,
  getSet,
  getWeek,
  respondToInvite,
  weekPayloadSchema,
} from "../api";
import { loadSavedWeek, MAX_SAVED_WEEKS, pruneWeeks, saveWeek, weekCacheKey } from "../cache";
import { createPrayerFetch, ServerMessageError } from "../server-message";
import { BLOCKOUT, WALL_META, practiceWeek, prayerSet } from "../__fixtures__/fixtures";

/** An ApiFetch stand-in that records calls and answers by path. */
function mockFetch(answer: (path: string, init?: { method?: string; body?: unknown }) => unknown) {
  const calls: { path: string; method?: string; body?: unknown }[] = [];
  const fn = jest.fn(async (path: string, init?: { method?: string; body?: unknown; schema?: { parse: (v: unknown) => unknown } }) => {
    calls.push({ path, method: init?.method, body: init?.body });
    const value = await answer(path, init);
    if (value instanceof Error) throw value;
    return init?.schema ? init.schema.parse(value) : value;
  });
  return { fn: fn as unknown as Parameters<typeof getWeek>[0], calls };
}

describe("API contract (existing website routes)", () => {
  it("the week: sets, block-outs and wall meta for Sun–Sat", async () => {
    const { fn, calls } = mockFetch((path) =>
      path.startsWith("/api/prayer-room/sets") ? [prayerSet()] : path.startsWith("/api/prayer-room/blockouts") ? [BLOCKOUT] : WALL_META,
    );
    const week = await getWeek(fn, "2026-11-01", "2026-11-07");
    expect(calls.map((c) => c.path).sort()).toEqual([
      "/api/prayer-room/blockouts?from=2026-11-01&to=2026-11-07",
      "/api/prayer-room/sets?dateFrom=2026-11-01&dateTo=2026-11-07",
      "/api/prayer-room/wall-meta",
    ]);
    expect(week.sets[0].start_time).toBe("19:00");
    expect(week.blockouts[0].start_time).toBe("10:00");
    expect(week.meta.seatTypes).toHaveLength(4);
  });

  it("the week degrades like the web: no block-outs or meta is not an error, no sets is", async () => {
    const partial = mockFetch((path) => (path.startsWith("/api/prayer-room/sets") ? [prayerSet()] : new ApiError("http", "x", 500)));
    const week = await getWeek(partial.fn, "2026-11-01", "2026-11-07");
    expect(week.blockouts).toEqual([]);
    expect(week.meta).toEqual({ seatTypes: [], bands: [] });

    const broken = mockFetch((path) => (path.startsWith("/api/prayer-room/sets") ? new ApiError("forbidden", "x", 403) : []));
    await expect(getWeek(broken.fn, "2026-11-01", "2026-11-07")).rejects.toMatchObject({ kind: "forbidden" });
  });

  it("one set, and the pending seat requests on it", async () => {
    const { fn, calls } = mockFetch((path) => (path.startsWith("/api/prayer-room/sets") ? prayerSet() : []));
    await getSet(fn, "s 1");
    await getPendingSeatRequests(fn, "s1");
    expect(calls.map((c) => c.path)).toEqual([
      "/api/prayer-room/sets?id=s%201",
      "/api/prayer-room/requests?kind=seat&setId=s1&state=pending",
    ]);
  });

  it("my commitments: invites, upcoming sets I set up, and my roster", async () => {
    const { fn, calls } = mockFetch(() => []);
    await getCommitments(fn);
    expect(calls.map((c) => c.path).sort()).toEqual([
      "/api/prayer-room/sets?scope=invites",
      "/api/prayer-room/sets?scope=owned&upcoming=true",
      "/api/prayer-room/sets?scope=roster",
    ]);
  });

  it("seat actions send exactly what the web sends", async () => {
    const { fn, calls } = mockFetch(() => ({ ok: true }));
    await respondToInvite(fn, "sl3", "accept");
    await respondToInvite(fn, "sl3", "decline");
    await askForSeat(fn, "s1", "vocals");
    expect(calls).toEqual([
      { path: "/api/prayer-room/slots/sl3", method: "PUT", body: { action: "accept" } },
      { path: "/api/prayer-room/slots/sl3", method: "PUT", body: { action: "decline" } },
      { path: "/api/prayer-room/requests?kind=seat", method: "POST", body: { set_id: "s1", seat_type_id: "vocals" } },
    ]);
  });

  it("practice: the week, booking a station for yourself, cancelling", async () => {
    const { fn, calls } = mockFetch((path) => (path.startsWith("/api/prayer-room/practice?") ? practiceWeek() : { id: "pb9" }));
    const week = await getPracticeWeek(fn, "2026-11-03");
    expect(week.stations).toHaveLength(3);
    await bookStation(fn, { date: "2026-11-04", start: "16:00", end: "17:00", stationId: "st-keys" });
    await cancelPracticeBooking(fn, "pb2");
    expect(calls).toEqual([
      { path: "/api/prayer-room/practice?week=2026-11-03", method: undefined, body: undefined },
      {
        path: "/api/prayer-room/practice/bookings",
        method: "POST",
        body: { kind: "station", date: "2026-11-04", start: "16:00", end: "17:00", stationId: "st-keys", singers: [] },
      },
      { path: "/api/prayer-room/practice/bookings/pb2", method: "DELETE", body: undefined },
    ]);
  });
});

// ── The server's own error sentence ─────────────────────────────────────────

function json(status: number, body: unknown) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function setup() {
  const fetchImpl = jest.fn<Promise<Response>, [string, RequestInit]>();
  const onAuthFailure = jest.fn();
  const deps: ApiDeps = {
    baseUrl: "https://hub.example.test",
    getAccessToken: async () => "token",
    onAuthFailure,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  };
  return { fetch: createPrayerFetch(deps), fetchImpl, onAuthFailure };
}

describe("createPrayerFetch", () => {
  it("passes successes through, with the bearer token", async () => {
    const { fetch, fetchImpl } = setup();
    fetchImpl.mockResolvedValue(json(200, { ok: true }));
    await expect(fetch("/api/x")).resolves.toEqual({ ok: true });
    expect(new Headers(fetchImpl.mock.calls[0][1].headers).get("Authorization")).toBe("Bearer token");
  });

  it("keeps the database's clash sentence on a 409", async () => {
    const { fetch, fetchImpl } = setup();
    fetchImpl.mockResolvedValue(json(409, { error: "You're already serving in another set that overlaps this time." }));
    const err = await fetch("/api/prayer-room/slots/sl3", { method: "PUT", body: { action: "accept" } }).catch((e) => e);
    expect(err).toBeInstanceOf(ServerMessageError);
    expect(err).toMatchObject({ kind: "http", status: 409, serverMessage: "You're already serving in another set that overlaps this time." });
  });

  it("keeps the sentence on a plain 403 (RLS said no)", async () => {
    const { fetch, fetchImpl, onAuthFailure } = setup();
    fetchImpl.mockResolvedValue(json(403, { error: "Only the booker can cancel." }));
    await expect(fetch("/api/x")).rejects.toMatchObject({ kind: "forbidden", serverMessage: "Only the booker can cancel." });
    expect(onAuthFailure).not.toHaveBeenCalled();
  });

  it("a deactivated account still signs out, never becomes a button message", async () => {
    const { fetch, fetchImpl, onAuthFailure } = setup();
    fetchImpl.mockResolvedValue(json(403, { error: "deactivated" }));
    const err = await fetch("/api/x").catch((e) => e);
    expect(err).not.toBeInstanceOf(ServerMessageError);
    expect(err).toMatchObject({ kind: "deactivated" });
    expect(onAuthFailure).toHaveBeenCalledWith("deactivated");
  });

  it("401 signs out as before", async () => {
    const { fetch, fetchImpl, onAuthFailure } = setup();
    fetchImpl.mockResolvedValue(json(401, { error: "Not authenticated" }));
    await expect(fetch("/api/x")).rejects.toMatchObject({ kind: "unauthenticated" });
    expect(onAuthFailure).toHaveBeenCalledWith("unauthenticated");
  });

  it("a 500 without a JSON error is a plain ApiError", async () => {
    const { fetch, fetchImpl } = setup();
    fetchImpl.mockResolvedValue(json(500, "<html>oops</html>"));
    const err = await fetch("/api/x").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).not.toBeInstanceOf(ServerMessageError);
  });
});

// ── Saved weeks ─────────────────────────────────────────────────────────────

describe("saved weeks (offline copy)", () => {
  const payload = weekPayloadSchema.parse({ sets: [prayerSet()], blockouts: [BLOCKOUT], meta: WALL_META });

  beforeEach(() => AsyncStorage.clear());

  it("saves and loads per user and per week", async () => {
    await saveWeek("u1", "2026-11-01", payload, "2026-11-03T06:00:00.000Z");
    expect((await loadSavedWeek("u1", "2026-11-01"))?.data.sets[0].id).toBe("s1");
    expect(await loadSavedWeek("u1", "2026-11-08")).toBeNull();
    expect(await loadSavedWeek("u2", "2026-11-01")).toBeNull();
  });

  it("keeps only the most recent weeks", () => {
    const store = Object.fromEntries(
      Array.from({ length: MAX_SAVED_WEEKS + 2 }, (_, i) => [`w${i}`, { savedAt: `2026-11-0${i + 1}T00:00:00Z`, data: payload }]),
    );
    const kept = Object.keys(pruneWeeks(store));
    expect(kept).toHaveLength(MAX_SAVED_WEEKS);
    expect(kept).not.toContain("w0");
  });

  it("a corrupt copy reads as nothing saved", async () => {
    await AsyncStorage.setItem(weekCacheKey("u1"), "{not json");
    expect(await loadSavedWeek("u1", "2026-11-01")).toBeNull();
  });
});
