// POST /api/vehicles/fleet/vehicles/[id]/fixed — "Mark as fixed" (Gideon, 23 Nov 2026).

import { beforeEach, describe, expect, it, vi } from "vitest";

const V = "00000000-0000-0000-0000-000000000004";
let condition: Record<string, unknown> = {};
let canManage = true;
const writes: Record<string, unknown>[] = [];
const fixes: Record<string, unknown>[] = [];
let fixFails = false;
let conditionFails = false;
const removed: string[] = [];
// 410's one-transaction function: "missing" (not applied yet → the old path), "ok" or "fail".
let rpc: "missing" | "ok" | "fail" = "missing";
const rpcCalls: Record<string, unknown>[] = [];

vi.mock("@/lib/fleet/api", async (orig) => ({
  ...(await orig<object>()),
  fleetAuth: async () => (canManage ? { ok: true, supabase: {}, user: { id: "u1" }, access: {} } : { ok: false, response: new Response(null, { status: 403 }) }),
  logTime: vi.fn(async () => {}),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/fleet/rules", async (orig) => ({ ...(await orig<object>()), todayInSA: () => "2026-11-23" }));
vi.mock("@/services/fleet", async (orig) => ({
  isMissingFunction: (await orig<typeof import("@/services/fleet")>()).isMissingFunction,
  markFleetFixed: vi.fn(async (_s: unknown, a: Record<string, unknown>) => {
    rpcCalls.push(a);
    if (rpc === "missing") return { data: null, error: { code: "PGRST202", message: "Could not find the function public.fleet_mark_fixed" } };
    return rpc === "ok" ? { data: "fix-1", error: null } : { data: null, error: { message: "That vehicle's condition couldn't be saved" } };
  }),
  getFleetVehicle: async () => ({ data: { id: V, details: { condition } }, error: null }),
  updateFleetVehicleDetails: vi.fn(async (_s: unknown, _id: string, patch: Record<string, unknown>) =>
    conditionFails ? { data: null, error: { message: "write failed" } } : (writes.push(patch), { data: {}, error: null })
  ),
  removeUnfinishedFleetFix: vi.fn(async (_s: unknown, id: string) => (removed.push(id), { error: null })),
  insertFleetFix: vi.fn(async (_s: unknown, row: Record<string, unknown>) => (fixes.push(row), fixFails ? { data: null, error: { message: "nope" } } : { data: { id: "f1" }, error: null })),
}));

import { POST } from "./route";

const req = (body: unknown) => new Request("http://x", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const params = { params: Promise.resolve({ id: V }) };

beforeEach(() => {
  writes.length = 0;
  fixes.length = 0;
  fixFails = false;
  conditionFails = false;
  removed.length = 0;
  rpc = "missing";
  rpcCalls.length = 0;
  canManage = true;
  condition = {
    "m25-balljoints": { s: "fix", d: "2026-11-19", n: "4x lower control arm bushes worn", i: "ins-1", t: "Ball joints and control arms" },
    "m25-oil": { s: "ok", d: "2026-11-19", i: "ins-1" },
  };
});

describe("Mark as fixed", () => {
  it("sets the point to OK with who and what, and leaves the other points alone", async () => {
    const res = await POST(req({ itemId: "m25-balljoints", date: "2026-11-22", by: "Motech", work: "Replaced the bushes." }), params);
    expect(res.status).toBe(200);
    const cond = writes[0].condition as Record<string, Record<string, unknown>>;
    expect(cond["m25-balljoints"]).toMatchObject({ s: "ok", d: "2026-11-22", n: "Fixed by Motech: Replaced the bushes.", f: { by: "Motech", work: "Replaced the bushes.", recordedBy: "u1", was: { s: "fix" } } });
    expect(cond["m25-oil"]).toEqual(condition["m25-oil"]);
    // …and the fix is kept for good, for the History and the report.
    expect(fixes).toEqual([
      {
        vehicle_id: V,
        item_id: "m25-balljoints",
        point: "Ball joints and control arms",
        fixed_on: "2026-11-22",
        fixed_by: "Motech",
        work: "Replaced the bushes.",
        was: { s: "fix", d: "2026-11-19", n: "4x lower control arm bushes worn", i: "ins-1" },
        recorded_by: "u1",
      },
    ]);
  });

  it("changes nothing if the fix can't be kept", async () => {
    fixFails = true;
    const res = await POST(req({ itemId: "m25-balljoints", date: "2026-11-22", by: "Motech", work: "x" }), params);
    expect(res.status).toBe(500);
    expect(writes).toHaveLength(0);
  });

  it("takes the fix back out if the point can't be saved (no orphan in History)", async () => {
    conditionFails = true;
    const res = await POST(req({ itemId: "m25-balljoints", date: "2026-11-22", by: "Motech", work: "x" }), params);
    expect(res.status).toBe(500);
    expect(fixes).toHaveLength(1);
    expect(removed).toEqual(["f1"]);
  });

  it("marks a Monitor point fixed too (Gideon, 25 Nov 2026)", async () => {
    condition["m25-oil"] = { s: "mon", d: "2026-11-19", n: "Slight seep", i: "ins-1", t: "Oil" };
    const res = await POST(req({ itemId: "m25-oil", date: "2026-11-22", by: "Motech", work: "New gasket." }), params);
    expect(res.status).toBe(200);
    expect((writes[0].condition as Record<string, Record<string, unknown>>)["m25-oil"]).toMatchObject({ s: "ok", f: { was: { s: "mon" } } });
    expect(fixes[0]).toMatchObject({ item_id: "m25-oil", was: { s: "mon", n: "Slight seep" } });
  });

  it("with 410 applied, saves the fix and the point in one call (Jack's review of #717)", async () => {
    rpc = "ok";
    const res = await POST(req({ itemId: "m25-balljoints", date: "2026-11-22", by: "Motech", work: "Replaced the bushes." }), params);
    expect(res.status).toBe(200);
    expect(rpcCalls[0]).toMatchObject({ vehicleId: V, itemId: "m25-balljoints", point: "Ball joints and control arms", fixedOn: "2026-11-22", by: "Motech", entry: { s: "ok", d: "2026-11-22" } });
    expect(fixes).toHaveLength(0); // no separate insert
    expect(writes).toHaveLength(0); // no separate update
  });

  it("with 410 applied, a failure changes nothing and needs no undo", async () => {
    rpc = "fail";
    const res = await POST(req({ itemId: "m25-balljoints", date: "2026-11-22", by: "Motech", work: "x" }), params);
    expect(res.status).toBe(500);
    // The person sees what didn't happen, not the database's message (Jack's review of #723).
    const body = await res.json();
    expect(body.error).toBe("Couldn’t mark it fixed. Nothing was changed: try again.");
    expect(body.error).not.toContain("condition couldn't be saved");
    expect(fixes).toHaveLength(0);
    expect(writes).toHaveLength(0);
    expect(removed).toHaveLength(0);
  });

  it("refuses a point that isn't Fix now or Monitor, and bad input", async () => {
    expect((await POST(req({ itemId: "m25-oil", date: "2026-11-22", by: "Motech", work: "x" }), params)).status).toBe(409);
    expect((await POST(req({ itemId: "m25-balljoints", date: "2026-11-22", by: "", work: "x" }), params)).status).toBe(400);
    expect((await POST(req({ itemId: "", date: "2026-11-22", by: "M", work: "x" }), params)).status).toBe(400);
    expect(writes).toHaveLength(0);
  });

  it("needs Fleet manage access", async () => {
    canManage = false;
    expect((await POST(req({ itemId: "m25-balljoints", date: "2026-11-22", by: "M", work: "x" }), params)).status).toBe(403);
  });
});
