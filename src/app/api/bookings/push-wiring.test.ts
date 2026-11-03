import { beforeEach, describe, expect, it, vi } from "vitest";

// Phone push at the two booking write points (POST /api/bookings and
// POST /api/bookings/[id]/decision). The routes themselves are unchanged:
// these tests prove they push the right people from after(), only when they
// should, and still answer exactly as before when push blows up.

const h = vi.hoisted(() => ({
  afterCallbacks: [] as (() => unknown)[],
  canApprove: false,
  requiresApproval: true,
  booking: null as Record<string, unknown> | null,
  pushThrows: false,
  newRequests: [] as unknown[],
  decisions: [] as unknown[],
}));

vi.mock("next/server", async (orig) => {
  const actual = await orig<typeof import("next/server")>();
  return { ...actual, after: (fn: () => unknown) => h.afterCallbacks.push(fn) };
});
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "me" } } }) },
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { first_name: "Jo", last_name: "S" } }) }) }),
    }),
  }),
}));
vi.mock("@/lib/prayer-room/booking-alerts", () => ({ syncBookingAlerts: () => {} }));
vi.mock("@/services/bookings", () => ({
  getBookingAccess: async () => ({ canRequest: true, canApprove: h.canApprove, canManage: false }),
  getVenueApproval: async () => ({ data: { requires_approval: h.requiresApproval } }),
  getVenueBookingsBetween: async () => ({ data: [] }),
  insertBooking: async (_s: unknown, row: Record<string, unknown>) => ({ data: { id: "b-new", ...row }, error: null }),
  insertBookings: async () => ({ error: null }),
  insertSeries: async () => ({ data: { id: "s-new" }, error: null }),
  deleteSeries: async () => ({}),
  getBookingById: async () => ({ data: h.booking, error: h.booking ? null : { message: "nope" } }),
  updateBooking: async () => ({ error: null }),
  updateSeries: async () => ({ error: null }),
  updateSeriesOccurrences: async () => ({ error: null }),
}));
vi.mock("@/lib/push/notify", () => ({
  notifyNewBookingRequest: async (args: unknown) => {
    if (h.pushThrows) throw new Error("push down");
    h.newRequests.push(args);
  },
  notifyBookingDecision: async (args: unknown) => {
    if (h.pushThrows) throw new Error("push down");
    h.decisions.push(args);
  },
}));

const create = await import("./route");
const decide = await import("./[id]/decision/route");

const oneOff = { venue_id: "v1", title: "Team night", booking_date: "2026-11-10", start_time: "18:00", end_time: "20:00" };
const weekly = {
  venue_id: "v1",
  title: "Prayer",
  recurrence: "weekly",
  weekday: 2,
  series_start: "2026-11-03",
  series_end: "2026-11-24",
};

const post = (body: unknown) =>
  create.POST(new Request("http://localhost/api/bookings", { method: "POST", body: JSON.stringify(body) }));
const decision = (body: unknown) =>
  decide.POST(new Request("http://localhost/api/bookings/b1/decision", { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: "b1" }),
  });
/** Run the after() callbacks the way Next does: each may reject; none may throw synchronously. */
const runAfter = () => Promise.allSettled(h.afterCallbacks.splice(0).map((fn) => Promise.resolve().then(fn)));

beforeEach(() => {
  h.afterCallbacks = [];
  h.canApprove = false;
  h.requiresApproval = true;
  h.booking = { id: "b1", requested_by: "asker", series_id: null, title: "Team night", venue_id: "v1", start_time: "18:00", end_time: "20:00" };
  h.pushThrows = false;
  h.newRequests = [];
  h.decisions = [];
});

describe("POST /api/bookings → push to approvers", () => {
  it("a pending one-off request pushes approvers (from after(), not before the response)", async () => {
    const res = await post(oneOff);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, bookingId: "b-new", autoConfirm: false });
    expect(h.newRequests).toEqual([]);
    await runAfter();
    expect(h.newRequests).toEqual([{ requesterId: "me", bookingId: "b-new" }]);
  });

  it("a pending weekly series pushes once, with the series", async () => {
    const res = await post(weekly);
    expect(res.status).toBe(200);
    await runAfter();
    expect(h.newRequests).toEqual([{ requesterId: "me", seriesId: "s-new" }]);
  });

  it("an auto-confirmed booking waits for nobody: no push", async () => {
    h.requiresApproval = false;
    const res = await post(oneOff);
    expect((await res.json()).autoConfirm).toBe(true);
    await runAfter();
    expect(h.newRequests).toEqual([]);
  });

  it("a dry run pushes nothing", async () => {
    await post({ ...oneOff, dryRun: true });
    await runAfter();
    expect(h.newRequests).toEqual([]);
  });

  it("push failing doesn't change the response", async () => {
    h.pushThrows = true;
    const res = await post(oneOff);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, bookingId: "b-new" });
    await expect(runAfter()).resolves.toBeDefined();
  });
});

describe("POST /api/bookings/[id]/decision → push to the requester", () => {
  beforeEach(() => {
    h.canApprove = true;
  });

  it("approve: pushes the requester's booking after the response", async () => {
    const res = await decision({ decision: "approved" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    await runAfter();
    expect(h.decisions).toEqual([{ booking: h.booking, status: "approved", deciderId: "me" }]);
  });

  it("deny a whole series: one push", async () => {
    h.booking = { ...h.booking!, series_id: "s1" };
    const res = await decision({ decision: "denied", applyToSeries: true });
    expect(await res.json()).toEqual({ ok: true, appliedToSeries: true });
    await runAfter();
    expect(h.decisions).toEqual([{ booking: h.booking, status: "denied", deciderId: "me" }]);
  });

  it("not an approver: 403 and no push", async () => {
    h.canApprove = false;
    expect((await decision({ decision: "approved" })).status).toBe(403);
    await runAfter();
    expect(h.decisions).toEqual([]);
  });

  it("bad decision: 400 and no push", async () => {
    expect((await decision({ decision: "maybe" })).status).toBe(400);
    await runAfter();
    expect(h.decisions).toEqual([]);
  });

  it("push failing doesn't change the response", async () => {
    h.pushThrows = true;
    const res = await decision({ decision: "approved" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    await expect(runAfter()).resolves.toBeDefined();
  });
});
