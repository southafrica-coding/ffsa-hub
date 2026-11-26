import { beforeEach, describe, expect, it, vi } from "vitest";

// No two live space bookings at once, on every write path: create, single
// edit, apply-to-series, series edit and approve. The services are an
// in-memory booking table; the database's own guard (migration 403) is
// played by `h.dbError`, which the next write returns.

type Row = Record<string, unknown> & {
  id: string;
  venue_id: string;
  booking_date: string;
  status: string;
};

const h = vi.hoisted(() => ({
  access: { isAdmin: false, canView: true, canRequest: true, canApprove: false, canManage: false },
  requiresApproval: true,
  rows: [] as Row[],
  series: null as Record<string, unknown> | null,
  dbError: null as { code: string; message: string; details?: string } | null,
  /** Only this service call returns `dbError` (any write, when unset). */
  dbErrorOn: null as string | null,
  /** Rows the database "sees" only at write time — another request racing us. */
  raceRows: [] as Row[],
  writes: [] as { fn: string; args: unknown[] }[],
}));

vi.mock("next/server", async (orig) => {
  const actual = await orig<typeof import("next/server")>();
  return { ...actual, after: () => {} };
});
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "me" } } }) },
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { first_name: "Jo", last_name: "Sibiya" } }) }) }),
    }),
  }),
}));
vi.mock("@/lib/prayer-room/booking-alerts", () => ({ syncBookingAlerts: () => {} }));
vi.mock("@/lib/push/notify", () => ({ notifyNewBookingRequest: async () => {}, notifyBookingDecision: async () => {} }));
vi.mock("@/lib/auth/check-ministry-access", () => ({ callerLeadsBookingMinistry: async () => false }));

vi.mock("@/services/bookings", () => {
  const live = (r: Row) => r.status === "pending" || r.status === "approved";
  const failing = (fn: string) => {
    if (!h.dbError || h.dbErrorOn !== fn) return null;
    const error = h.dbError;
    h.dbError = null;
    return error;
  };
  const write = (fn: string, ...args: unknown[]) => {
    h.writes.push({ fn, args });
    if (h.dbErrorOn && h.dbErrorOn !== fn) return null;
    const error = h.dbError;
    if (error) {
      h.rows.push(...h.raceRows);
      h.raceRows = [];
      h.dbError = null;
    }
    return error;
  };
  return {
    getBookingAccess: async () => h.access,
    getVenueApproval: async () => ({ data: { requires_approval: h.requiresApproval, name: "Office 2" } }),
    getVenueBookingsBetween: async (_s: unknown, venueId: string, from: string, to: string) => ({
      data: h.rows.filter(
        (r) =>
          r.venue_id === venueId &&
          live(r) &&
          r.booking_date <= to &&
          ((r.end_date as string | null) ?? r.booking_date) >= from
      ),
    }),
    getBookingById: async (_s: unknown, id: string) => {
      const row = h.rows.find((r) => r.id === id);
      return row
        ? { data: { ...row, venue: { name: "Office 2" }, ministry: null }, error: null }
        : { data: null, error: { message: "nope" } };
    },
    getSeriesById: async () => ({ data: h.series, error: h.series ? null : { message: "nope" } }),
    getSeriesOccurrences: async (_s: unknown, seriesId: string) => {
      const error = failing("getSeriesOccurrences");
      if (error) return { data: null, error };
      return {
        data: h.rows.filter((r) => r.series_id === seriesId).sort((a, b) => a.booking_date.localeCompare(b.booking_date)),
        error: null,
      };
    },
    insertBooking: async (_s: unknown, row: Record<string, unknown>) => {
      const error = write("insertBooking", row);
      return error ? { data: null, error } : { data: { id: "b-new", ...row }, error: null };
    },
    insertBookings: async (_s: unknown, rows: unknown[]) => ({ error: write("insertBookings", rows) }),
    insertSeries: async () => {
      const error = failing("insertSeries");
      return error ? { data: null, error } : { data: { id: "s-new" }, error: null };
    },
    deleteSeries: async () => ({}),
    updateBooking: async (_s: unknown, id: string, data: unknown) => ({ data: {}, error: write("updateBooking", id, data) }),
    updateBookingsByIds: async (_s: unknown, ids: string[], data: unknown) => ({ error: write("updateBookingsByIds", ids, data) }),
    updateSeries: async (_s: unknown, id: string, data: unknown) => {
      const error = failing("updateSeries");
      return error ? { data: null, error } : { data: { id, ...(data as object) }, error: null };
    },
    updateSeriesOccurrences: async (...args: unknown[]) => ({ error: write("updateSeriesOccurrences", ...args.slice(1)) }),
    deleteBookings: async (_s: unknown, ids: string[]) => {
      const error = failing("deleteBookings");
      return error ? { data: null, error } : { data: ids.map((id) => ({ id })), error: null };
    },
    cancelBookings: async () => ({ error: null }),
  };
});

const create = await import("./route");
const edit = await import("./[id]/route");
const decide = await import("./[id]/decision/route");
const seriesEdit = await import("./series/[id]/route");

const req = (url: string, method: string, body: unknown) =>
  new Request(`http://localhost${url}`, { method, body: JSON.stringify(body) });
const post = (body: unknown) => create.POST(req("/api/bookings", "POST", body));
const patch = (id: string, body: unknown) =>
  edit.PATCH(req(`/api/bookings/${id}`, "PATCH", body), { params: Promise.resolve({ id }) });
const decision = (id: string, body: unknown) =>
  decide.POST(req(`/api/bookings/${id}/decision`, "POST", body), { params: Promise.resolve({ id }) });
const patchSeries = (id: string, body: unknown) =>
  seriesEdit.PATCH(req(`/api/bookings/series/${id}`, "PATCH", body), { params: Promise.resolve({ id }) });

function row(over: Partial<Row> & { id: string }): Row {
  return {
    venue_id: "v1",
    series_id: null,
    title: "Booking",
    booking_date: "2026-12-01",
    end_date: null,
    setup_time: null,
    start_time: "09:00",
    end_time: "10:00",
    setdown_time: null,
    status: "approved",
    requested_by: "someone",
    requester_name: "Someone",
    ...over,
  };
}

/** Riley holds Office 2 on Tue 1 Dec, 11:30–13:00. */
const riley = () =>
  row({
    id: "held",
    title: "SBS Staff Mtg",
    start_time: "11:30:00",
    end_time: "13:00:00",
    requester_name: "Riley Botha",
    requested_by: "riley-uid",
  });
const RILEY_MSG =
  'Office 2 is already booked by Riley Botha ("SBS Staff Mtg") on Tue 1 Dec 2026, 11:30 – 13:00. Talk to them, or pick another time.';

const oneOff = { venue_id: "v1", title: "Team night", booking_date: "2026-12-01", start_time: "12:00", end_time: "14:00" };
const writesOf = (fn: string) => h.writes.filter((w) => w.fn === fn);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-25T08:00:00Z")); // Wed 25 Nov, 10:00 SAST
  h.access = { isAdmin: false, canView: true, canRequest: true, canApprove: false, canManage: false };
  h.requiresApproval = true;
  h.rows = [riley()];
  h.series = null;
  h.dbError = null;
  h.dbErrorOn = null;
  h.raceRows = [];
  h.writes = [];
});

const manager = () => {
  h.access = { isAdmin: false, canView: true, canRequest: true, canApprove: true, canManage: true };
};

describe("POST /api/bookings", () => {
  it("refuses a clash on an approval-required space, naming who holds it", async () => {
    const res = await post(oneOff);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json).toMatchObject({ blocked: true, canOverride: false, error: RILEY_MSG });
    expect(json.conflicts).toEqual([
      expect.objectContaining({ date: "2026-12-01", existingTitle: "SBS Staff Mtg", who: "Riley Botha", existingWindow: "11:30 – 13:00" }),
    ]);
    expect(JSON.stringify(json)).not.toContain("riley-uid");
    expect(writesOf("insertBooking")).toHaveLength(0);
  });

  it("refuses a clash on an auto-confirm space too", async () => {
    h.requiresApproval = false;
    expect((await post(oneOff)).status).toBe(409);
  });

  it("refuses a weekly series with one clashing date", async () => {
    const res = await post({
      venue_id: "v1",
      title: "Prayer",
      recurrence: "weekly",
      weekday: 2,
      series_start: "2026-11-24",
      series_end: "2026-12-15",
      start_time: "12:00",
      end_time: "12:30",
    });
    expect(res.status).toBe(409);
    expect((await res.json()).conflicts).toHaveLength(1);
    expect(writesOf("insertBookings")).toHaveLength(0);
  });

  it("dry run still answers 200 and reports the block", async () => {
    const res = await post({ ...oneOff, dryRun: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, blocked: true, canOverride: false });
  });

  it("books back-to-back and ignores cancelled / denied bookings", async () => {
    h.rows.push(row({ id: "c", start_time: "13:00", end_time: "15:00", status: "cancelled" }));
    h.rows.push(row({ id: "d", start_time: "13:00", end_time: "15:00", status: "denied" }));
    const res = await post({ ...oneOff, start_time: "13:00", end_time: "15:00" });
    expect(res.status).toBe(200);
  });

  it("a pending booking blocks", async () => {
    h.rows = [{ ...riley(), status: "pending" }];
    expect((await post(oneOff)).status).toBe(409);
  });

  it("override by someone without bookings.manage → 403, nothing written", async () => {
    h.access = { ...h.access, canApprove: true }; // approve alone isn't enough
    const res = await post({ ...oneOff, override: { reason: "Board meeting" } });
    expect(res.status).toBe(403);
    expect(writesOf("insertBooking")).toHaveLength(0);
  });

  it("override with a blank or too-long reason → 400", async () => {
    manager();
    expect((await post({ ...oneOff, override: { reason: "   " } })).status).toBe(400);
    expect((await post({ ...oneOff, override: { reason: "x".repeat(501) } })).status).toBe(400);
    expect(writesOf("insertBooking")).toHaveLength(0);
  });

  it("a manager is offered the override, and booking over passes the reason to the database", async () => {
    manager();
    const refused = await post(oneOff);
    expect(refused.status).toBe(409);
    expect((await refused.json()).canOverride).toBe(true);

    const res = await post({ ...oneOff, override: { reason: "  Board meeting moved here  " } });
    expect(res.status).toBe(200);
    const [inserted] = writesOf("insertBooking")[0].args as [Record<string, unknown>];
    expect(inserted.clash_override_reason).toBe("Board meeting moved here");
  });

  it("maps the database's 23P01 (a racing booking) to 409 with the clash re-read, never the raw text", async () => {
    h.rows = [];
    h.raceRows = [riley()];
    h.dbError = {
      code: "23P01",
      message: "venue_booking_clash",
      details: "clashing_booking_ids=00000000-0000-0000-0000-000000000001",
    };
    const res = await post(oneOff);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe(RILEY_MSG);
    expect(json.blocked).toBe(true);
    const text = JSON.stringify(json);
    expect(text).not.toContain("venue_booking_clash");
    expect(text).not.toContain("clashing_booking_ids");
  });

  it("maps the guard's 42501 / 23514 to 403 / 400", async () => {
    manager();
    h.rows = [];
    h.dbError = { code: "42501", message: "venue_booking_override_forbidden" };
    const forbidden = await post({ ...oneOff, override: { reason: "x" } });
    expect(forbidden.status).toBe(403);
    expect(JSON.stringify(await forbidden.json())).not.toContain("venue_booking");

    h.dbError = { code: "23514", message: "venue_booking_override_reason_too_long" };
    const long = await post({ ...oneOff, override: { reason: "x" } });
    expect(long.status).toBe(400);
  });
});

describe("PATCH /api/bookings/[id]", () => {
  beforeEach(() => {
    h.rows.push(row({ id: "mine", requested_by: "me", start_time: "14:00", end_time: "15:00" }));
  });

  it("refuses moving a booking into a clash", async () => {
    const res = await patch("mine", { start_time: "12:00", end_time: "13:30" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(RILEY_MSG);
    expect(writesOf("updateBooking")).toHaveLength(0);
  });

  it("moves into free time", async () => {
    const res = await patch("mine", { start_time: "13:00", end_time: "14:30" });
    expect(res.status).toBe(200);
  });

  it("renames a booking that already overlaps another (legacy row)", async () => {
    h.rows.push(row({ id: "legacy", requested_by: "me", start_time: "12:00", end_time: "12:30" }));
    const res = await patch("legacy", { title: "Renamed", start_time: "12:00", end_time: "12:30" });
    expect(res.status).toBe(200);
    expect(writesOf("updateBooking")[0].args[1]).toMatchObject({ title: "Renamed" });
  });

  it("cancels a booking that already overlaps another", async () => {
    h.rows.push(row({ id: "legacy", requested_by: "me", start_time: "12:00", end_time: "12:30" }));
    expect((await patch("legacy", { cancel: true })).status).toBe(200);
  });

  it("maps a database refusal on update to 409", async () => {
    h.raceRows = [row({ id: "racer", start_time: "13:00", end_time: "14:00", requester_name: "Sam" })];
    h.dbError = { code: "23P01", message: "venue_booking_clash", details: "clashing_booking_ids=x" };
    const res = await patch("mine", { start_time: "13:00", end_time: "14:30" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("by Sam");
  });

  it("manager override on an edit passes the reason", async () => {
    manager();
    const res = await patch("mine", { start_time: "12:00", end_time: "13:30", override: { reason: "Agreed with Riley" } });
    expect(res.status).toBe(200);
    expect(writesOf("updateBooking")[0].args[1]).toMatchObject({ clash_override_reason: "Agreed with Riley" });
  });
});

describe("PATCH /api/bookings/[id] with applyToSeries", () => {
  // A weekly Tuesday series: one past date, today's week, two future dates.
  beforeEach(() => {
    const occ = (id: string, date: string) =>
      row({ id, series_id: "s1", booking_date: date, requested_by: "me", start_time: "14:00", end_time: "15:00" });
    h.rows.push(occ("past", "2026-11-17"), occ("o1", "2026-11-24"), occ("o2", "2026-12-01"), occ("o3", "2026-12-08"));
  });

  it("refuses when another occurrence would land on a clash", async () => {
    // Editing the 8 Dec date; the 1 Dec date would move on top of Riley.
    const res = await patch("o3", { start_time: "12:00", end_time: "13:00", applyToSeries: true });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.conflicts).toEqual([expect.objectContaining({ date: "2026-12-01", who: "Riley Botha" })]);
    expect(writesOf("updateBooking")).toHaveLength(0);
    expect(writesOf("updateSeriesOccurrences")).toHaveLength(0);
  });

  it("leaves past occurrences alone: only today (SAST) onward is checked and rewritten", async () => {
    // Something now sits where the PAST date would move to; it must not matter.
    h.rows.push(row({ id: "old-clash", booking_date: "2026-11-17", start_time: "16:00", end_time: "17:00" }));
    const res = await patch("o3", { start_time: "16:00", end_time: "17:00", applyToSeries: true });
    expect(res.status).toBe(200);
    const [seriesId, data, onlyPending, opts] = writesOf("updateSeriesOccurrences")[0].args as [
      string,
      Record<string, unknown>,
      boolean,
      Record<string, unknown>,
    ];
    expect(seriesId).toBe("s1");
    expect(data).toMatchObject({ start_time: "16:00", end_time: "17:00" });
    expect(onlyPending).toBe(false);
    expect(opts).toMatchObject({ excludeId: "o3", skipClosed: true, fromDate: "2026-11-25" });
  });

  it("uses the SAST date just after midnight SAST (still the previous day in UTC)", async () => {
    vi.setSystemTime(new Date("2026-11-24T22:30:00Z")); // Wed 25 Nov 00:30 SAST
    await patch("o3", { title: "Renamed", applyToSeries: true });
    const opts = writesOf("updateSeriesOccurrences")[0].args[3] as Record<string, unknown>;
    expect(opts.fromDate).toBe("2026-11-25");
  });

  it("a rename across the series isn't blocked by an occurrence that already overlaps", async () => {
    h.rows.find((r) => r.id === "o2")!.start_time = "12:00"; // legacy overlap with Riley
    const res = await patch("o3", { title: "Renamed", applyToSeries: true });
    expect(res.status).toBe(200);
  });
});

describe("POST /api/bookings/[id]/decision", () => {
  beforeEach(() => {
    h.access = { isAdmin: false, canView: true, canRequest: true, canApprove: true, canManage: false };
    h.rows.push(row({ id: "req", status: "pending", start_time: "12:00", end_time: "12:30", requester_name: "Lee" }));
  });

  it("refuses to approve a pending request that clashes", async () => {
    const res = await decision("req", { decision: "approved" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: RILEY_MSG, blocked: true, canOverride: false });
    expect(writesOf("updateBooking")).toHaveLength(0);
  });

  it("still denies it", async () => {
    expect((await decision("req", { decision: "denied" })).status).toBe(200);
  });

  it("refuses a whole-series approval when one pending date clashes", async () => {
    h.rows.find((r) => r.id === "req")!.series_id = "s2";
    h.rows.push(row({ id: "req2", series_id: "s2", status: "pending", booking_date: "2026-12-08", start_time: "12:00", end_time: "12:30" }));
    const res = await decision("req", { decision: "approved", applyToSeries: true });
    expect(res.status).toBe(409);
    expect(writesOf("updateSeriesOccurrences")).toHaveLength(0);
  });

  it("an approver alone can't override", async () => {
    expect((await decision("req", { decision: "approved", override: { reason: "ok" } })).status).toBe(403);
  });

  it("a manager can approve over the clash with a reason", async () => {
    manager();
    const res = await decision("req", { decision: "approved", override: { reason: "Riley agreed to share" } });
    expect(res.status).toBe(200);
    expect(writesOf("updateBooking")[0].args[1]).toMatchObject({
      status: "approved",
      clash_override_reason: "Riley agreed to share",
    });
  });

  describe("whole series", () => {
    beforeEach(() => {
      h.rows.find((r) => r.id === "req")!.series_id = "s2";
      // A second pending date that clashes with Sam on 8 Dec, and one already denied.
      h.rows.push(
        row({ id: "req2", series_id: "s2", status: "pending", booking_date: "2026-12-08", start_time: "12:00", end_time: "12:30" }),
        row({ id: "req3", series_id: "s2", status: "denied", booking_date: "2026-12-15", start_time: "12:00", end_time: "12:30" }),
        row({ id: "sam", booking_date: "2026-12-08", title: "Choir", start_time: "12:00", end_time: "13:00", requester_name: "Sam" })
      );
    });

    it("names every clashing pending date, and offers the override only to a manager", async () => {
      const res = await decision("req", { decision: "approved", applyToSeries: true });
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json).toMatchObject({ blocked: true, canOverride: false });
      expect(json.conflicts).toEqual([
        expect.objectContaining({ date: "2026-12-01", who: "Riley Botha" }),
        expect.objectContaining({ date: "2026-12-08", who: "Sam" }),
      ]);

      manager();
      expect((await (await decision("req", { decision: "approved", applyToSeries: true })).json()).canOverride).toBe(true);
    });

    it("a manager approves the whole series over the clashes, the reason on every pending date", async () => {
      manager();
      const res = await decision("req", {
        decision: "approved",
        applyToSeries: true,
        override: { reason: "  Riley and Sam agreed to move  " },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, appliedToSeries: true });
      const [seriesId, stamp, onlyPending] = writesOf("updateSeriesOccurrences")[0].args as [string, Record<string, unknown>, boolean];
      expect(seriesId).toBe("s2");
      expect(stamp).toMatchObject({ status: "approved", clash_override_reason: "Riley and Sam agreed to move" });
      expect(onlyPending).toBe(true);
    });

    it("an approver alone can't override the series → 403, nothing written", async () => {
      const res = await decision("req", { decision: "approved", applyToSeries: true, override: { reason: "ok" } });
      expect(res.status).toBe(403);
      expect(writesOf("updateSeriesOccurrences")).toHaveLength(0);
      expect(writesOf("updateBooking")).toHaveLength(0);
    });

    it("a blank or too-long reason → 400, nothing written", async () => {
      manager();
      for (const reason of ["   ", "x".repeat(501)]) {
        const res = await decision("req", { decision: "approved", applyToSeries: true, override: { reason } });
        expect(res.status).toBe(400);
      }
      expect(writesOf("updateSeriesOccurrences")).toHaveLength(0);
    });

    it("a reason of exactly 500 characters is fine", async () => {
      manager();
      const res = await decision("req", { decision: "approved", applyToSeries: true, override: { reason: "x".repeat(500) } });
      expect(res.status).toBe(200);
    });

    it("a racing booking caught by the database → 409 with the clash re-read, nothing half-written", async () => {
      h.rows = h.rows.filter((r) => r.id !== "held" && r.id !== "sam");
      h.raceRows = [riley()];
      h.dbErrorOn = "updateSeriesOccurrences";
      h.dbError = { code: "23P01", message: "venue_booking_clash", details: "clashing_booking_ids=x" };
      const res = await decision("req", { decision: "approved", applyToSeries: true });
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.conflicts).toEqual([expect.objectContaining({ who: "Riley Botha" })]);
      expect(JSON.stringify(json)).not.toContain("venue_booking_clash");
      // One statement for every pending date, refused whole by the database.
      expect(writesOf("updateSeriesOccurrences")).toHaveLength(1);
      expect(writesOf("updateBooking")).toHaveLength(0);
    });

    it("can't load the series' dates → generic 500, nothing approved", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        h.dbErrorOn = "getSeriesOccurrences";
        h.dbError = { code: "XX000", message: "SECRET-internal detail" };
        const res = await decision("req", { decision: "approved", applyToSeries: true });
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ error: "Could not load the series." });
        expect(log).toHaveBeenCalledTimes(1);
        expect(writesOf("updateSeriesOccurrences")).toHaveLength(0);
      } finally {
        log.mockRestore();
      }
    });
  });
});

describe("PATCH /api/bookings/series/[id]", () => {
  beforeEach(() => {
    h.series = {
      id: "s1",
      venue_id: "v1",
      ministry_id: null,
      ministry: null,
      title: "Prayer",
      description: null,
      point_person: null,
      weekday: 2,
      start_time: "14:00:00",
      end_time: "15:00:00",
      setup_time: null,
      setdown_time: null,
      series_start: "2026-11-24",
      series_end: "2026-12-08",
      interval_weeks: 1,
      status: "approved",
      created_by: "me",
    };
    const occ = (id: string, date: string) =>
      row({ id, series_id: "s1", booking_date: date, requested_by: "me", start_time: "14:00:00", end_time: "15:00:00" });
    h.rows.push(occ("o1", "2026-11-24"), occ("o2", "2026-12-01"), occ("o3", "2026-12-08"));
  });

  it("refuses moving the series onto a clash, on an approval-required space too", async () => {
    const res = await patchSeries("s1", { start_time: "12:00", end_time: "13:00" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(RILEY_MSG);
    expect(writesOf("updateBookingsByIds")).toHaveLength(0);
  });

  it("moves the kept future dates in one write each group", async () => {
    const res = await patchSeries("s1", { venue_id: "v2", start_time: "12:00", end_time: "13:00" });
    expect(res.status).toBe(200);
    const writes = writesOf("updateBookingsByIds");
    expect(writes).toHaveLength(1);
    expect(writes[0].args[0]).toEqual(["o2", "o3"]); // o1 is in the past
    expect(writes[0].args[1]).toMatchObject({ venue_id: "v2", start_time: "12:00", end_time: "13:00" });
  });

  it("renames a series even when a date already overlaps something", async () => {
    h.rows.find((r) => r.id === "o2")!.start_time = "12:00:00";
    expect((await patchSeries("s1", { title: "Evening prayer" })).status).toBe(200);
  });
});

describe("an unmapped database error is a generic 500, never the raw text", () => {
  const SECRET = 'relation "venue_bookings" SECRET-internal detail';
  const rawError = () => ({ code: "XX000", message: SECRET, details: "SECRET-row" });
  const occ = (id: string, seriesId: string, date: string, extra: Partial<Row> = {}) =>
    row({ id, series_id: seriesId, booking_date: date, title: "Prayer", requested_by: "me", start_time: "14:00:00", end_time: "15:00:00", ...extra });
  const withSeries = () => {
    h.series = {
      id: "s1", venue_id: "v1", ministry_id: null, ministry: null, title: "Prayer", description: null,
      point_person: null, weekday: 2, start_time: "14:00:00", end_time: "15:00:00", setup_time: null,
      setdown_time: null, series_start: "2026-11-24", series_end: "2026-12-08", interval_weeks: 1,
      status: "approved", created_by: "me",
    };
    h.rows.push(occ("o1", "s1", "2026-11-24"), occ("o2", "s1", "2026-12-01"), occ("o3", "s1", "2026-12-08"));
  };
  const weekly = {
    venue_id: "v1", title: "Prayer", recurrence: "weekly", weekday: 2,
    series_start: "2026-11-24", series_end: "2026-12-15", start_time: "15:00", end_time: "16:00",
  };
  const mine = () => h.rows.push(row({ id: "mine", requested_by: "me", start_time: "14:00", end_time: "15:00" }));

  const cases: Array<[string, string, () => void, () => Promise<Response>, string]> = [
    ["create one-off", "insertBooking", () => {}, () => post({ ...oneOff, start_time: "14:00", end_time: "15:00" }), "Could not create the booking."],
    ["create series row", "insertSeries", () => {}, () => post(weekly), "Could not create the booking."],
    ["create series dates", "insertBookings", () => {}, () => post(weekly), "Could not create the booking."],
    ["edit a booking", "updateBooking", mine, () => patch("mine", { start_time: "15:00", end_time: "16:00" }), "Could not update the booking."],
    ["cancel a booking", "updateBooking", mine, () => patch("mine", { cancel: true }), "Could not cancel the booking."],
    ["cancel a whole series", "updateSeriesOccurrences", withSeries, () => patch("o3", { cancel: true, applyToSeries: true }), "Could not cancel the booking."],
    ["apply to all dates", "updateSeriesOccurrences", withSeries, () => patch("o3", { title: "Renamed", applyToSeries: true }), "Could not update the booking."],
    [
      "approve a booking",
      "updateBooking",
      () => {
        manager();
        h.rows.push(row({ id: "req", status: "pending", start_time: "14:00", end_time: "15:00" }));
      },
      () => decision("req", { decision: "approved" }),
      "Could not update the booking.",
    ],
    [
      "approve a series",
      "updateSeriesOccurrences",
      () => {
        manager();
        h.rows.push(occ("p1", "s2", "2026-12-01", { status: "pending" }), occ("p2", "s2", "2026-12-08", { status: "pending" }));
      },
      () => decision("p1", { decision: "approved", applyToSeries: true }),
      "Could not update the booking.",
    ],
    ["series: load its dates", "getSeriesOccurrences", withSeries, () => patchSeries("s1", { title: "Evening prayer" }), "Could not load the series."],
    ["series: save the schedule", "updateSeries", withSeries, () => patchSeries("s1", { title: "Evening prayer" }), "Could not update the series."],
    ["series: add dates", "insertBookings", withSeries, () => patchSeries("s1", { series_end: "2026-12-15" }), "Could not update the series."],
    ["series: change kept dates", "updateBookingsByIds", withSeries, () => patchSeries("s1", { title: "Evening prayer" }), "Could not update the series."],
    ["series: remove dates", "deleteBookings", withSeries, () => patchSeries("s1", { series_end: "2026-12-01" }), "Could not update the series."],
  ];

  it.each(cases)("%s (%s fails)", async (_name, failOn, setup, call, message) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      setup();
      h.dbErrorOn = failOn;
      h.dbError = rawError();
      const res = await call();
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json).toEqual({ error: message });
      const text = JSON.stringify(json);
      expect(text).not.toContain("SECRET");
      expect(text).not.toContain("XX000");
      // The real error goes to the server log, once.
      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0]).toContainEqual(expect.objectContaining({ message: SECRET }));
    } finally {
      log.mockRestore();
    }
  });
});
