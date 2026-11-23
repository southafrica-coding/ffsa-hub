/**
 * check_vehicle_availability's day counts with the bot's service-role
 * client: vehicle_availability() is gated on auth.uid(), which is null for
 * the service role, so the counts are worked out from the rows instead —
 * only after the asker's own vehicles access has been checked.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeState } from "./testing";
import type { HubState } from "./testing-hub";

const h = vi.hoisted(() => ({ state: {} as FakeState, hub: {} as HubState }));

vi.mock("./data", async () => (await import("./testing")).makeFakeData(h.state));
// The fake Hub for everything but the day counts, which are the real code.
vi.mock("./hub-data", async (importOriginal) => {
  const real = await importOriginal<typeof import("./hub-data")>();
  return { ...(await import("./testing-hub")).makeFakeHub(h.hub), vehicleDayCounts: real.vehicleDayCounts };
});

const { baseState, MINISTRY_WORSHIP } = await import("./testing");
const { baseHubState } = await import("./testing-hub");
const { executeHubLeaderTool } = await import("./tools");
const { countVehicleDays } = await vi.importActual<typeof import("./hub-data")>("./hub-data");

type Row = Record<string, unknown>;

/** A service-role stand-in: plain table reads with filters, and an RPC that sees no auth.uid(). */
function serviceRoleClient(tables: Record<string, Row[]>) {
  const read: string[] = [];
  const rpc: string[] = [];
  const from = (table: string) => {
    read.push(table);
    let rows = [...(tables[table] ?? [])];
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => ((rows = rows.filter((r) => r[c] === v)), q),
      in: (c: string, vs: unknown[]) => ((rows = rows.filter((r) => vs.includes(r[c]))), q),
      lte: (c: string, v: string) => ((rows = rows.filter((r) => String(r[c]) <= v)), q),
      gte: (c: string, v: string) => ((rows = rows.filter((r) => String(r[c]) >= v)), q),
      then: (ok: (v: { data: Row[]; error: null }) => unknown) => Promise.resolve({ data: rows, error: null }).then(ok),
    };
    return q;
  };
  return {
    read,
    rpc,
    client: {
      from,
      // has_vehicles_access() is false without auth.uid(): the function returns no rows.
      rpc: async (name: string) => (rpc.push(name), { data: [], error: null }),
    },
  };
}

// Fake fleet and bookings (made up). Days 2030-03-01 … 2030-03-03.
const TABLES: Record<string, Row[]> = {
  vehicles: [
    { id: "van-a", vehicle_type: "van", status: "active" },
    { id: "van-b", vehicle_type: "van", status: "active" },
    { id: "van-c", vehicle_type: "van", status: "inactive" },
    { id: "car-d", vehicle_type: "car", status: "active" },
  ],
  vehicle_bookings: [
    { id: "bk-1", status: "approved", checkout_date: "2030-03-01", return_date: "2030-03-02" },
    { id: "bk-2", status: "pending", checkout_date: "2030-03-02", return_date: "2030-03-03" },
    { id: "bk-3", status: "denied", checkout_date: "2030-03-01", return_date: "2030-03-03" },
    { id: "bk-4", status: "approved", checkout_date: "2030-03-03", return_date: "2030-03-03" },
    { id: "bk-5", status: "approved", checkout_date: "2030-03-01", return_date: "2030-03-01" },
    { id: "bk-6", status: "approved", checkout_date: "2030-04-01", return_date: "2030-04-02" },
  ],
  vehicle_booking_assignments: [
    { vehicle_booking_id: "bk-1", vehicle_id: "van-a" },
    { vehicle_booking_id: "bk-2", vehicle_id: "van-b" },
    { vehicle_booking_id: "bk-2", vehicle_id: "car-d" },
    { vehicle_booking_id: "bk-3", vehicle_id: "car-d" }, // declined: not counted
    { vehicle_booking_id: "bk-4", vehicle_id: "van-c" }, // inactive vehicle: not counted
    { vehicle_booking_id: "bk-5", vehicle_id: "van-a" }, // same van, same day as bk-1: counted once
    { vehicle_booking_id: "bk-6", vehicle_id: "car-d" }, // outside the window
  ],
};

const EXPECTED = [
  { day: "2030-03-01", vans_free: 1, cars_free: 1, vans_requested: 0, cars_requested: 0 },
  { day: "2030-03-02", vans_free: 1, cars_free: 1, vans_requested: 1, cars_requested: 1 },
  { day: "2030-03-03", vans_free: 2, cars_free: 1, vans_requested: 1, cars_requested: 1 },
];

const leader = { hubUserId: "u-lead", slackUserId: "U_LEAD", ministries: [{ id: MINISTRY_WORSHIP, name: "Worship" }], pointLeaderOf: [] };
const check = (admin: unknown) =>
  executeHubLeaderTool({ admin, leader, channelId: "D_LEAD" }, "check_vehicle_availability", { from: "2030-03-01", to: "2030-03-03" });

beforeEach(() => {
  for (const k of Object.keys(h.state)) delete (h.state as Record<string, unknown>)[k];
  Object.assign(h.state, baseState());
  for (const k of Object.keys(h.hub)) delete (h.hub as Record<string, unknown>)[k];
  Object.assign(h.hub, baseHubState());
});

describe("check_vehicle_availability — day counts under the service role", () => {
  it("gives a permitted asker the same counts the calendar would, without the auth.uid()-gated RPC", async () => {
    h.hub.vehicleAccess["u-lead"] = { canView: true };
    const db = serviceRoleClient(TABLES);
    const out = (await check(db.client)).output as { days: unknown[]; vehicles: unknown[] };
    expect(out.days).toEqual(EXPECTED);
    expect(db.rpc).toEqual([]);
    // Named-vehicle checks are unchanged.
    expect(out.vehicles).toHaveLength(2);
  });

  it("refuses an asker without vehicles access, and reads nothing", async () => {
    const db = serviceRoleClient(TABLES);
    const out = (await check(db.client)).output as Record<string, unknown>;
    expect(out).toMatchObject({ refused: true });
    expect(out.days).toBeUndefined();
    expect(db.read).toEqual([]);
  });
});

describe("countVehicleDays — vehicle_availability()'s arithmetic", () => {
  it("lists every day of the window, with zeros where nothing is booked", () => {
    const days = countVehicleDays("2030-02-27", "2030-03-01", [{ id: "v", vehicle_type: "van" }], [], []);
    expect(days.map((d) => d.day)).toEqual(["2030-02-27", "2030-02-28", "2030-03-01"]);
    expect(days[0]).toEqual({ day: "2030-02-27", vans: 1, cars: 0, vanTotal: 1, carTotal: 0, vansRequested: 0, carsRequested: 0 });
  });
});
