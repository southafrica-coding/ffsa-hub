// The km and workshop visit routes on the seed data: what they refuse, what they write,
// and the messages the co-ordinator sees (SPEC 10 tests 6, 8 and 9).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { seedFleetData, withVehicle } from "@/lib/fleet/testing/seed";
import type { FleetData } from "@/lib/fleet/rules";

const TODAY = "2026-11-17";
let data: FleetData;
const calls: { fn: string; args: unknown[] }[] = [];
const record = (fn: string, result: unknown = { data: { id: "00000000-0000-0000-0000-0000000000aa" }, error: null }) =>
  vi.fn(async (...args: unknown[]) => {
    calls.push({ fn, args });
    return result;
  });

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } }) }));
vi.mock("@/lib/api-auth", () => ({ getAuthedUser: async () => ({ id: "u1" }) }));
vi.mock("@/lib/fleet/load", () => ({ loadFleet: async () => ({ F: data, vehicleRows: [], providers: [], coordinator: null }) }));
vi.mock("@/lib/fleet/rules/format", async (orig) => ({ ...(await orig<object>()), todayInSA: () => TODAY }));
vi.mock("@/services/fleet", () => ({
  getFleetAccess: async () => ({ isAdmin: false, canView: true, canManage: true }),
  insertFleetOdometerReading: record("insertFleetOdometerReading"),
  updateFleetVehicleDetails: record("updateFleetVehicleDetails"),
  insertFleetTimeLog: record("insertFleetTimeLog"),
  insertFleetVisit: record("insertFleetVisit"),
  updateFleetVisit: record("updateFleetVisit"),
  getFleetVisits: async () => ({ data: [], error: null }),
  moveBookingAssignment: record("moveBookingAssignment", { data: { vehicle_booking_id: "b", vehicle_id: "v" }, error: null }),
  getBookingRequestedBy: vi.fn(async () => ({ data: { requested_by: bookedBy }, error: null })),
  setBookingHold: record("setBookingHold", { data: { id: "b" }, error: null }),
  cancelBookingBrokenDown: record("cancelBookingBrokenDown", { data: { id: "b" }, error: null }),
}));
// Move tells the person who booked through the Hub's booking notice (never a real send here).
let bookedBy = "someone-else";
let noticeResult = { slack: true, email: true };
const notices: unknown[] = [];
const refreshed: string[] = [];
vi.mock("@/lib/vehicles/requester-notify", () => ({
  notifyVehicleRequester: vi.fn(async (o: unknown) => (notices.push(o), noticeResult)),
}));
vi.mock("@/lib/vehicles/slack-alerts", () => ({
  refreshVehicleRequestAlerts: vi.fn(async (id: string) => void refreshed.push(id)),
}));

// Seed vehicles have string ids ("h1-2"); the routes want uuids.
const UUID: Record<string, string> = {
  "h1-1": "00000000-0000-0000-0000-000000000001",
  "h1-2": "00000000-0000-0000-0000-000000000002",
  "h1-3": "00000000-0000-0000-0000-000000000003",
  kombi: "00000000-0000-0000-0000-000000000004",
  crv: "00000000-0000-0000-0000-000000000005",
  almera: "00000000-0000-0000-0000-000000000006",
};
function withUuids(F: FleetData): FleetData {
  const map = (id: string) => UUID[id] || id;
  return {
    ...F,
    vehicles: F.vehicles.map((v) => ({ ...v, id: map(v.id) })),
    trips: F.trips.map((t) => ({ ...t, vehicleId: map(t.vehicleId) })),
    visits: F.visits.map((r) => ({ ...r, vehicleId: map(r.vehicleId) })),
  };
}
const req = (body: unknown) => new Request("http://x", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  calls.length = 0;
  notices.length = 0;
  refreshed.length = 0;
  bookedBy = "someone-else";
  noticeResult = { slack: true, email: true };
  data = withUuids(seedFleetData(TODAY));
});

describe("POST /api/vehicles/fleet/vehicles/[id]/km", () => {
  it("saves the reading, moves the odometer on and warns 10 km before (SPEC 10.8)", async () => {
    data = withUuids(withVehicle(seedFleetData(TODAY), "h1-2", { lastService: { km: 215000 }, odometer: 224920 }));
    const { POST } = await import("./vehicles/[id]/km/route");
    const res = await POST(req({ km: "224 990", date: TODAY, note: "Back from HULC" }), params(UUID["h1-2"]));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.message).toBe("Saved. Hyundai H1 #2: Service and bumper-to-bumper inspection due in 10 km (at 225 000 km): book it at the workshop");
    const reading = calls.find((c) => c.fn === "insertFleetOdometerReading")!.args[1] as Record<string, unknown>;
    expect(reading).toMatchObject({ vehicle_id: UUID["h1-2"], km: 224990, date: TODAY, note: "Back from HULC", source: "km-log" });
    const patch = calls.find((c) => c.fn === "updateFleetVehicleDetails")!.args[2] as Record<string, unknown>;
    expect(patch).toMatchObject({ odometer_km: 224990, odometer_date: TODAY, odo_prev: { km: 224920, date: "2026-03-23" } });
    expect(calls.some((c) => c.fn === "insertFleetTimeLog")).toBe(true);
  });

  it("keeps a lower reading but doesn't move the odometer back", async () => {
    const { POST } = await import("./vehicles/[id]/km/route");
    const res = await POST(req({ km: 1000 }), params(UUID["h1-2"]));
    expect((await res.json()).moved).toBe(false);
    expect(calls.some((c) => c.fn === "insertFleetOdometerReading")).toBe(true);
    expect(calls.some((c) => c.fn === "updateFleetVehicleDetails")).toBe(false);
  });

  it("refuses a missing reading and a date in the future", async () => {
    const { POST } = await import("./vehicles/[id]/km/route");
    expect((await (await POST(req({ km: "" }), params(UUID["h1-2"]))).json()).error).toBe("Enter the odometer reading in km.");
    expect((await POST(req({ km: 230000, date: "2026-11-18" }), params(UUID["h1-2"]))).status).toBe(400);
  });
});

describe("POST /api/vehicles/fleet/visits", () => {
  it("refuses a done bumper-to-bumper inspection without an odometer reading (SPEC 10.9)", async () => {
    const { POST } = await import("./visits/route");
    const res = await POST(req({ vehicleId: UUID["h1-2"], status: "done", kind: "Workshop inspection (bumper to bumper)", date: TODAY }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Enter the odometer reading: the next service and bumper-to-bumper inspection are worked out from it.");
  });

  it("asks before booking over a rental, and books when confirmed (SPEC 10.6)", async () => {
    const { POST } = await import("./visits/route");
    const visit = { vehicleId: UUID.almera, status: "booked", kind: "Service", date: "2026-11-25", until: "2026-11-26", provider: "Motech" };
    const first = await POST(req(visit));
    expect(first.status).toBe(409);
    expect((await first.json()).clash).toMatch(/^This visit clashes with Rental \(Thu, 19 Nov – Sun, 13 Dec\)\. Book it anyway\?/);
    expect(calls.some((c) => c.fn === "insertFleetVisit")).toBe(false);

    const second = await POST(req({ ...visit, force: true }));
    expect(second.status).toBe(200);
    const row = calls.find((c) => c.fn === "insertFleetVisit")!.args[1] as Record<string, unknown>;
    expect(row).toMatchObject({ status: "booked", kind: "Service", date: "2026-11-25", until: "2026-11-26", odometer_km: null });
    const patch = calls.find((c) => c.fn === "updateFleetVehicleDetails")!.args[2] as Record<string, unknown>;
    expect(patch).toMatchObject({ fleet_status: "Booked for workshop", status_since: TODAY });
    expect(patch.follow_up).toMatchObject({ date: "2026-11-25", until: "2026-11-26", kind: "Service", provider: "Motech" });
  });

  it("records a done service with the odometer and moves the last service on when asked", async () => {
    const { POST } = await import("./visits/route");
    const res = await POST(
      req({ vehicleId: UUID["h1-2"], status: "done", kind: "Service", date: TODAY, odometer: "225 010", updateLastService: true, provider: "Motech", cost: "R 3 450,50" })
    );
    expect(res.status).toBe(200);
    const row = calls.find((c) => c.fn === "insertFleetVisit")!.args[1] as Record<string, unknown>;
    expect(row).toMatchObject({ odometer_km: 225010, cost: 3450.5 });
    const patch = calls.find((c) => c.fn === "updateFleetVehicleDetails")!.args[2] as Record<string, unknown>;
    expect(patch).toMatchObject({ odometer_km: 225010, last_service: { date: TODAY, km: 225010, provider: "Motech" } });
  });
});

describe("POST /api/vehicles/fleet/trips/move", () => {
  const BOOKING = "00000000-0000-0000-0000-0000000000b7";
  const kombiTrip = () => {
    data = { ...data, trips: [...data.trips, { id: `${BOOKING}:${UUID.kombi}`, vehicleId: UUID.kombi, from: "2026-11-19", to: "2026-11-21", label: "HULC", source: "hub" }] };
  };

  it("moves a Kombi booking over its workshop visit to H1 #1 (SPEC 10.7)", async () => {
    kombiTrip();
    const { POST } = await import("./trips/move/route");
    const res = await POST(req({ tripId: `${BOOKING}:${UUID.kombi}`, to: UUID["h1-1"] }));
    expect(res.status).toBe(200);
    expect((await res.json()).message).toBe("Moved to Hyundai H1 #1. The person who booked it has been told.");
    expect(calls.find((c) => c.fn === "moveBookingAssignment")!.args.slice(1)).toEqual([BOOKING, UUID.kombi, UUID["h1-1"]]);
  });

  it("tells the person who booked, with the old and new vehicle, and refreshes the Slack request", async () => {
    kombiTrip();
    const { POST } = await import("./trips/move/route");
    await POST(req({ tripId: `${BOOKING}:${UUID.kombi}`, to: UUID["h1-1"] }));
    const kombi = data.vehicles.find((v) => v.id === UUID.kombi)!.name;
    expect(notices).toEqual([
      {
        bookingId: BOOKING,
        kind: "changed",
        changes: [`Please be aware your vehicle has been changed from "${kombi}" to "Hyundai H1 #1".`],
        sentBy: "u1",
      },
    ]);
    expect(refreshed).toEqual([BOOKING]);
  });

  it("doesn't message you about your own booking", async () => {
    kombiTrip();
    bookedBy = "u1";
    const { POST } = await import("./trips/move/route");
    const res = await POST(req({ tripId: `${BOOKING}:${UUID.kombi}`, to: UUID["h1-1"] }));
    expect((await res.json()).message).toBe("Moved to Hyundai H1 #1.");
    expect(notices).toHaveLength(0);
    expect(refreshed).toEqual([BOOKING]);
  });

  it("says so when the person who booked couldn't be reached", async () => {
    kombiTrip();
    noticeResult = { slack: false, email: false };
    const { POST } = await import("./trips/move/route");
    const res = await POST(req({ tripId: `${BOOKING}:${UUID.kombi}`, to: UUID["h1-1"] }));
    expect((await res.json()).message).toBe("Moved to Hyundai H1 #1. Couldn't reach the person who booked it, so let them know yourself.");
  });

  it("refuses a vehicle that isn't free for the whole trip (H1 #3 is at Motech on 19 Nov)", async () => {
    kombiTrip();
    const { POST } = await import("./trips/move/route");
    const res = await POST(req({ tripId: `${BOOKING}:${UUID.kombi}`, to: UUID["h1-3"] }));
    expect(res.status).toBe(409);
    expect(calls.some((c) => c.fn === "moveBookingAssignment")).toBe(false);
    expect(notices).toHaveLength(0);
  });
});

describe("POST /api/vehicles/fleet/notices (Let them know, Fleet part 5b)", () => {
  const BOOKING = "00000000-0000-0000-0000-0000000000b8";
  const kombiOverVisit = () => {
    const w = data.visits.find((r) => r.vehicleId === UUID.kombi && r.status === "booked" && r.date)!;
    data = { ...data, trips: [...data.trips, { id: `${BOOKING}:${UUID.kombi}`, vehicleId: UUID.kombi, from: w.date!, to: w.until || w.date!, label: "HULC", source: "hub" }] };
    return w;
  };

  it("tells the person who booked, through the booking notice, with the clash text", async () => {
    const w = kombiOverVisit();
    const { POST } = await import("./notices/route");
    const res = await POST(req({ bookingId: BOOKING, visitId: w.id }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ told: true, message: "The person who booked has been told." });
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ bookingId: BOOKING, kind: "message", sentBy: "u1" });
    expect((notices[0] as { note: string }).note).toMatch(/is booked in for a .+ during HULC/);
  });

  it("refuses when the booking doesn't clash with that visit (any more)", async () => {
    const w = kombiOverVisit();
    const { POST } = await import("./notices/route");
    const res = await POST(req({ bookingId: "00000000-0000-0000-0000-0000000000ff", visitId: w.id }));
    expect(res.status).toBe(409);
    expect(notices).toHaveLength(0);
  });

  it("doesn't message you about your own booking", async () => {
    const w = kombiOverVisit();
    bookedBy = "u1";
    const { POST } = await import("./notices/route");
    expect(await (await POST(req({ bookingId: BOOKING, visitId: w.id }))).json()).toMatchObject({ told: false });
    expect(notices).toHaveLength(0);
  });

  it("says so when the person couldn't be reached", async () => {
    const w = kombiOverVisit();
    noticeResult = { slack: false, email: false };
    const { POST } = await import("./notices/route");
    expect((await (await POST(req({ bookingId: BOOKING, visitId: w.id }))).json()).message).toBe("Couldn’t reach the person who booked it, so let them know yourself.");
  });
});


describe("POST /api/vehicles/fleet/out-of-action (Fleet part 5c)", () => {
  const BOOKING = "00000000-0000-0000-0000-0000000000c1";
  // H1 #2 broken down, a booking on it under way, and every other van busy for its dates.
  const brokenDown = (vanFree = false) => {
    const busy = ["h1-1", "h1-3", "kombi"].filter((v) => !vanFree || v !== "h1-1");
    data = {
      ...data,
      visits: [],
      vehicles: data.vehicles.map((v) => (v.id === UUID["h1-2"] ? { ...v, status: "Off the road", statusSince: TODAY } : { ...v, followUp: null })),
      trips: [
        { id: `${BOOKING}:${UUID["h1-2"]}`, vehicleId: UUID["h1-2"], from: "2026-11-16", to: "2026-11-20", label: "Outreach", source: "hub" },
        ...busy.map((v, i) => ({ id: `0000000${i}-0000-0000-0000-000000000000:${UUID[v]}`, vehicleId: UUID[v], from: "2026-11-15", to: "2026-11-25", label: "Busy", source: "hub" })),
      ],
    };
  };

  it("puts the booking on hold and tells the person who booked", async () => {
    brokenDown();
    const { POST } = await import("./out-of-action/route");
    const res = await POST(req({ action: "hold", bookingId: BOOKING }));
    expect(res.status).toBe(200);
    expect((await res.json()).message).toBe("On hold until the vehicle is back. The person who booked it has been told.");
    expect(calls.find((c) => c.fn === "setBookingHold")!.args[2]).toMatchObject({ since: TODAY });
    expect(notices[0]).toMatchObject({ bookingId: BOOKING, kind: "changed" });
    expect((notices[0] as { changes: string[] }).changes[0]).toMatch(/^Your booking is on hold: Hyundai H1 #2 is off the road/);
    expect(refreshed).toEqual([BOOKING]);
  });

  it("cancels it ('Vehicle broke down') with the cancelled notice", async () => {
    brokenDown();
    const { POST } = await import("./out-of-action/route");
    expect((await POST(req({ action: "cancel", bookingId: BOOKING }))).status).toBe(200);
    expect(calls.find((c) => c.fn === "cancelBookingBrokenDown")!.args[2]).toMatch(/^Vehicle broke down/);
    expect(notices[0]).toMatchObject({ kind: "cancelled", note: expect.stringMatching(/^Vehicle broke down/) });
  });

  it("refuses hold and cancel while a similar vehicle is free: Move it instead", async () => {
    brokenDown(true);
    const { POST } = await import("./out-of-action/route");
    const res = await POST(req({ action: "hold", bookingId: BOOKING }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("A similar vehicle is free: Move the booking instead.");
    expect(notices).toHaveLength(0);
  });

  it("resumes a booking on hold once its vehicle is back", async () => {
    brokenDown();
    data = { ...data, vehicles: data.vehicles.map((v) => (v.id === UUID["h1-2"] ? { ...v, status: "In service" } : v)), trips: data.trips.map((t) => (t.id.startsWith(BOOKING) ? { ...t, onHold: "2026-11-17" } : t)) };
    const { POST } = await import("./out-of-action/route");
    expect((await POST(req({ action: "resume", bookingId: BOOKING }))).status).toBe(200);
    expect(calls.find((c) => c.fn === "setBookingHold")!.args[2]).toBeNull();
    expect((notices[0] as { changes: string[] }).changes).toEqual(["Hyundai H1 #2 is back, so your booking carries on as planned."]);
  });

  it("won't resume while the vehicle is still out", async () => {
    brokenDown();
    data = { ...data, trips: data.trips.map((t) => (t.id.startsWith(BOOKING) ? { ...t, onHold: "2026-11-17" } : t)) };
    const { POST } = await import("./out-of-action/route");
    expect((await POST(req({ action: "resume", bookingId: BOOKING }))).status).toBe(409);
  });

  it("Move swaps a booking under way to a van free for the rest of it", async () => {
    brokenDown();
    // H1 #1 was busy before today, free from today on.
    data = { ...data, trips: data.trips.map((t) => (t.vehicleId === UUID["h1-1"] ? { ...t, from: "2026-11-10", to: "2026-11-16" } : t)) };
    const { POST } = await import("./trips/move/route");
    const res = await POST(req({ tripId: `${BOOKING}:${UUID["h1-2"]}`, to: UUID["h1-1"] }));
    expect(res.status).toBe(200);
  });
});
