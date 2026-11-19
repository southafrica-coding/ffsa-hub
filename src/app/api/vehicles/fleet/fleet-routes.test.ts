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
    expect((await res.json()).message).toBe("Moved to Hyundai H1 #1.");
    expect(calls.find((c) => c.fn === "moveBookingAssignment")!.args.slice(1)).toEqual([BOOKING, UUID.kombi, UUID["h1-1"]]);
  });

  it("refuses a vehicle that isn't free for the whole trip (H1 #3 is at Motech on 19 Nov)", async () => {
    kombiTrip();
    const { POST } = await import("./trips/move/route");
    const res = await POST(req({ tripId: `${BOOKING}:${UUID.kombi}`, to: UUID["h1-3"] }));
    expect(res.status).toBe(409);
    expect(calls.some((c) => c.fn === "moveBookingAssignment")).toBe(false);
  });
});
