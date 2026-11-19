// Saving and deleting an inspection on the seed data: what's refused, what's written,
// and SPEC acceptance test 10 (a weekly check with 17 minutes of active use saves
// mins: 17 and a time log).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { seedFleetData, withVehicle } from "@/lib/fleet/testing/seed";
import { itemsFor, type FleetData } from "@/lib/fleet/rules";
import { newDraft, tickDraft } from "@/lib/fleet/inspection";

const TODAY = "2026-11-17";
const H12 = "00000000-0000-0000-0000-000000000002";
const INS = "00000000-0000-0000-0000-0000000000aa";
let data: FleetData;
let vehicleRows: Record<string, unknown>[] = [];
let stored: Record<string, unknown>[] = [];
let failVehicleUpdate = false;
const calls: { fn: string; args: unknown[] }[] = [];
const record = (fn: string, result: () => unknown = () => ({ data: { id: INS }, error: null })) =>
  vi.fn(async (...args: unknown[]) => {
    calls.push({ fn, args });
    return result();
  });

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } }) }));
vi.mock("@/lib/api-auth", () => ({ getAuthedUser: async () => ({ id: "u1" }) }));
vi.mock("@/lib/fleet/load", () => ({ loadFleet: async () => ({ F: data, vehicleRows, providers: [], coordinator: null }) }));
vi.mock("@/lib/fleet/rules/format", async (orig) => ({ ...(await orig<object>()), todayInSA: () => TODAY }));
vi.mock("@/services/fleet", () => ({
  getFleetAccess: async () => ({ isAdmin: false, canView: true, canManage: true }),
  insertFleetInspection: record("insertFleetInspection"),
  deleteFleetInspection: record("deleteFleetInspection", () => ({ error: null })),
  insertFleetOdometerReading: record("insertFleetOdometerReading"),
  updateFleetVehicleDetails: record("updateFleetVehicleDetails", () => (failVehicleUpdate ? { data: null, error: { message: "nope" } } : { data: {}, error: null })),
  insertFleetTimeLog: record("insertFleetTimeLog", () => ({ error: null })),
  deleteFleetDraft: record("deleteFleetDraft", () => ({ error: null })),
  getFleetInspection: record("getFleetInspection", () => ({ data: stored.find((r) => r.id === INS) ?? null, error: null })),
  getFleetInspections: record("getFleetInspections", () => ({ data: stored, error: null })),
}));

const req = (body: unknown) => new Request("http://x", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const argOf = (fn: string, i = 1) => calls.find((c) => c.fn === fn)?.args[i] as Record<string, unknown>;

function seed() {
  const F = seedFleetData(TODAY);
  return {
    ...F,
    vehicles: F.vehicles.map((v) => (v.id === "h1-2" ? { ...v, id: H12 } : v)),
    trips: F.trips.map((t) => (t.vehicleId === "h1-2" ? { ...t, vehicleId: H12 } : t)),
    visits: F.visits.map((r) => (r.vehicleId === "h1-2" ? { ...r, vehicleId: H12 } : r)),
  };
}

/** A weekly check on H1 #2: every point OK except one Fix now, with 17 active minutes. */
function weeklyCheck() {
  const v = data.vehicles.find((x) => x.id === H12)!;
  const d = newDraft(v, "weekly", TODAY, "Jack", 0);
  d.odometer = "225 050";
  const ids = itemsFor(data.checklist, "weekly");
  ids.forEach((id) => (d.results[id] = { s: "ok", p: [] }));
  d.results[ids[0]] = { s: "fix", n: "Low", p: [] };
  d.tick = 0;
  d.activeMs = 0;
  let now = 5_000_000;
  tickDraft(d, now);
  for (let i = 0; i < 12; i++) tickDraft(d, (now += 60e3)); // 12 minutes, a tap a minute
  tickDraft(d, (now += 5 * 60e3)); // then 5 minutes on one point: 17
  return { d, ids };
}

beforeEach(() => {
  calls.length = 0;
  data = seed();
  vehicleRows = [];
  stored = [];
  failVehicleUpdate = false;
});

describe("POST /api/vehicles/fleet/inspections", () => {
  it("SPEC 10.10: saves mins 17 and a time log of 17 minutes", async () => {
    const { POST } = await import("./route");
    const { d, ids } = weeklyCheck();
    const res = await POST(req({ vehicleId: H12, draft: d }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true, id: INS, mins: 17 });

    const row = argOf("insertFleetInspection");
    expect(row).toMatchObject({ vehicle_id: H12, type: "weekly", date: TODAY, odometer_km: 225050, inspector: "Jack", mins: 17, created_by: "u1" });
    expect(row.counts).toEqual({ ok: ids.length - 1, mon: 0, fix: 1, na: 0 });
    expect(argOf("insertFleetTimeLog")).toMatchObject({ kind: "inspection", type: "weekly", vehicle_id: H12, mins: 17, date: TODAY, week: "2026-11-16", user_id: "u1" });
  });

  it("updates the vehicle, keeps the reading, and removes the server draft", async () => {
    const { POST } = await import("./route");
    const { d, ids } = weeklyCheck();
    await POST(req({ vehicleId: H12, draft: d }));
    const patch = argOf("updateFleetVehicleDetails", 2);
    expect(argOf("updateFleetVehicleDetails", 1) as unknown).toBe(H12);
    expect(patch).toMatchObject({
      odometer_km: 225050,
      odometer_date: TODAY,
      odo_prev: { km: 224920, date: "2026-03-23" },
      last_inspection: { id: INS, date: TODAY, type: "weekly" },
      last_check: { id: INS, date: TODAY, type: "weekly" },
      updated_by: "u1",
    });
    expect((patch.condition as Record<string, unknown>)[ids[0]]).toMatchObject({ s: "fix", d: TODAY, n: "Low", i: INS });
    expect(patch.last_monthly).toBeUndefined();
    expect(argOf("insertFleetOdometerReading")).toMatchObject({ vehicle_id: H12, km: 225050, date: TODAY, source: "inspection", source_id: INS });
    expect(calls.find((c) => c.fn === "deleteFleetDraft")!.args.slice(1)).toEqual(["u1", H12]);
  });

  it("a post-trip check brings a vehicle On a trip back In service and records a post-trip reading", async () => {
    data = withVehicle(data, H12, { status: "On a trip" });
    const { POST } = await import("./route");
    const v = data.vehicles.find((x) => x.id === H12)!;
    const d = newDraft(v, "post", TODAY);
    d.odometer = "226000";
    d.bookingId = "00000000-0000-0000-0000-0000000000bb";
    d.results[itemsFor(data.checklist, "post")[0]] = { s: "ok", p: [] };
    expect((await POST(req({ vehicleId: H12, draft: d }))).status).toBe(200);
    expect(argOf("insertFleetInspection")).toMatchObject({ type: "post", booking_id: d.bookingId });
    expect(argOf("updateFleetVehicleDetails", 2)).toMatchObject({ fleet_status: "In service", status_since: TODAY, last_post: { id: INS, date: TODAY } });
    expect(argOf("insertFleetOdometerReading")).toMatchObject({ source: "post-trip" });
  });

  it("refuses with the app's messages, and writes nothing", async () => {
    const { POST } = await import("./route");
    const { d } = weeklyCheck();
    const msg = async (body: unknown) => (await (await POST(req(body))).json()).error;
    expect(await msg({ vehicleId: H12, draft: { ...d, odometer: "" } })).toBe("Enter the odometer reading in km.");
    expect(await msg({ vehicleId: H12, draft: { ...d, date: "" } })).toBe("Enter the date of the inspection.");
    expect(await msg({ vehicleId: H12, draft: { ...d, results: {} } })).toBe("Mark at least one point before saving.");
    expect(await msg({ vehicleId: "h1-2", draft: d })).toBe("Unknown vehicle");
    expect(calls.some((c) => c.fn === "insertFleetInspection")).toBe(false);
  });

  it("takes the inspection back out if the vehicle can't be updated", async () => {
    failVehicleUpdate = true;
    const { POST } = await import("./route");
    const res = await POST(req({ vehicleId: H12, draft: weeklyCheck().d }));
    expect(res.status).toBe(500);
    expect(calls.find((c) => c.fn === "deleteFleetInspection")!.args[1]).toBe(INS);
    expect(calls.some((c) => c.fn === "insertFleetTimeLog")).toBe(false);
  });

  it("doesn't move lastInspection back when a later one exists", async () => {
    vehicleRows = [{ id: H12, details: { last_inspection: { id: "later", date: "2026-12-01" } } }];
    const { POST } = await import("./route");
    await POST(req({ vehicleId: H12, draft: weeklyCheck().d }));
    expect(argOf("updateFleetVehicleDetails", 2).last_inspection).toBeUndefined();
  });
});

describe("DELETE /api/vehicles/fleet/inspections/[id]", () => {
  const params = (id: string) => ({ params: Promise.resolve({ id }) });
  const r = (s: string) => ({ s, v: "", n: "", p: [], t: "Oil", sec: "Engine" });

  it("deletes it and recalculates the vehicle from the rest", async () => {
    stored = [
      { id: INS, vehicle_id: H12, type: "weekly", date: "2026-11-17", results: { "eng-oil": r("fix") }, counts: { fix: 1 }, created_at: "2026-11-17T09:00:00Z" },
      { id: "old", vehicle_id: H12, type: "monthly", date: "2026-11-03", results: { "eng-oil": r("ok") }, counts: { ok: 1 }, created_at: "2026-11-03T09:00:00Z" },
    ];
    const { DELETE } = await import("./[id]/route");
    const res = await DELETE(new Request("http://x", { method: "DELETE" }), params(INS));
    expect(res.status).toBe(200);
    expect(calls.find((c) => c.fn === "deleteFleetInspection")!.args[1]).toBe(INS);
    expect(argOf("updateFleetVehicleDetails", 2)).toEqual({
      condition: { "eng-oil": { s: "ok", d: "2026-11-03", v: "", n: "", p: [], i: "old", t: "Oil" } },
      last_inspection: { id: "old", date: "2026-11-03", type: "monthly", counts: { ok: 1, mon: 0, fix: 0, na: 0 } },
      last_check: { id: "old", date: "2026-11-03", type: "monthly" },
      last_monthly: { id: "old", date: "2026-11-03" },
      updated_by: "u1",
    });
  });

  it("404s an inspection that's gone", async () => {
    const { DELETE } = await import("./[id]/route");
    const res = await DELETE(new Request("http://x", { method: "DELETE" }), params(INS));
    expect(res.status).toBe(404);
    expect(calls.some((c) => c.fn === "deleteFleetInspection")).toBe(false);
  });
});
