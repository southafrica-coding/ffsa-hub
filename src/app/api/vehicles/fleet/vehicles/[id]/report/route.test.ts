// GET /api/vehicles/fleet/vehicles/[id]/report — the vehicle history PDF (Gideon, 23 Nov 2026).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { seedFleetData } from "@/lib/fleet/testing/seed";

const V = "00000000-0000-0000-0000-000000000004";
let canView = true;
let fixesFail = false;
const built: unknown[] = [];

vi.mock("@/lib/fleet/api", async (orig) => ({
  ...(await orig<object>()),
  fleetAuth: async () => (canView ? { ok: true, supabase: {}, user: { id: "u1" }, access: {} } : { ok: false, response: new Response(null, { status: 403 }) }),
}));
vi.mock("@/lib/fleet/load", () => ({
  loadFleet: async () => {
    const F = seedFleetData("2026-12-20");
    return {
      F: {
        ...F,
        today: "2026-12-20",
        vehicles: [{ id: V, name: "VW Kombi", reg: "ABC 123 GP", make: "Volkswagen", model: "T5", year: 2015, colour: "Silver", condition: {} }],
        visits: [{ id: "w1", vehicleId: V, status: "done", kind: "Service", date: "2026-12-05", provider: "Motech", cost: 4500, work: [] }, { id: "w2", vehicleId: "other", status: "done", kind: "Service", date: "2026-12-05", provider: "X", cost: 1, work: [] }],
        trips: [],
      },
      vehicleRows: [{ id: V, details: { vin: "VIN1" } }],
    };
  },
}));
vi.mock("@/lib/fleet/report", async (orig) => {
  const m = await orig<typeof import("@/lib/fleet/report")>();
  return { ...m, buildVehicleReport: (x: unknown) => (built.push(x), m.buildVehicleReport(x as never)) };
});
vi.mock("@/services/fleet", () => ({
  getFleetInspections: async () => ({ data: [], error: null }),
  getFleetOdometerReadings: async () => ({ data: [{ date: "2026-12-15", km: "314900", note: null }], error: null }),
  getFleetFixes: async () => (fixesFail ? { data: null, error: { message: "relation fleet_fixes does not exist" } } : { data: [{ fixed_on: "2026-12-10", point: "Brakes", fixed_by: "Motech", work: "New pads", was: null }], error: null }),
}));

import { GET } from "./route";

const get = (q: string, id = V) => GET(new Request(`http://x/api?${q}`), { params: Promise.resolve({ id }) });

beforeEach(() => {
  canView = true;
  fixesFail = false;
  built.length = 0;
});

describe("Download report", () => {
  it("returns a PDF attachment of this vehicle's history only", async () => {
    const res = await get("from=2026-12-01&to=2026-12-31");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="ffsa-vehicle-report-ABC123GP-2026-12-01-to-2026-12-31.pdf"');
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
    const x = built[0] as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(x.visits.map((v: { id: string }) => v.id)).toEqual(["w1"]);
    expect(x.vehicle.vin).toBe("VIN1");
    expect(x.readings).toEqual([{ date: "2026-12-15", km: 314900, note: "" }]);
    expect(x.fixes).toEqual([{ date: "2026-12-10", point: "Brakes", by: "Motech", work: "New pads", was: {} }]);
  }, 30000);

  it("still works before 358 (no fixes table): no fixes", async () => {
    fixesFail = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await get("from=2026-12-01&to=2026-12-31")).status).toBe(200);
    expect((built[0] as { fixes: unknown[] }).fixes).toEqual([]);
  }, 30000);

  it("refuses bad dates, an unknown vehicle, and people without Fleet", async () => {
    expect((await get("from=2026-12-31&to=2026-12-01")).status).toBe(400);
    expect((await get("from=nope&to=2026-12-01")).status).toBe(400);
    expect((await get("from=2026-12-01&to=2026-12-31", "00000000-0000-0000-0000-000000000009")).status).toBe(404);
    canView = false;
    expect((await get("from=2026-12-01&to=2026-12-31")).status).toBe(403);
  });
});
