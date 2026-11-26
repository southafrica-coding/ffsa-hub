// Nothing in a vehicle's history is erased (359, Gideon 23 Nov 2026): deletes hide,
/* eslint-disable @typescript-eslint/no-explicit-any */// and reads leave hidden rows out even with an admin client (which skips RLS).

import { describe, expect, it, vi } from "vitest";
import { deleteFleetInspection, deleteFleetVisit, getFleetInspection, getFleetInspections, getFleetOdometerReadings, getFleetVisits } from "./fleet";
import { getWorkshopBlocks } from "./vehicles";

/** A fake client: every query resolves to `rows`; records rpc and delete calls. */
function fake(rows: unknown) {
  const calls: { rpc: unknown[]; deletes: number } = { rpc: [], deletes: 0 };
  const q: any = {
    select: () => q, eq: () => q, gte: () => q, lte: () => q, order: () => q, limit: () => q,
    delete: () => ((calls.deletes += 1), q),
    maybeSingle: async () => ({ data: rows, error: null }),
    then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(ok),
  };
  const client: any = { from: () => q, rpc: vi.fn(async (...a: unknown[]) => (calls.rpc.push(a), { data: true, error: null })) };
  return { client, calls };
}

describe("deleting hides, never erases", () => {
  it("an inspection goes through fleet_hide_row", async () => {
    const { client, calls } = fake(null);
    await deleteFleetInspection(client, "i1");
    expect(calls.rpc).toEqual([["fleet_hide_row", { p_table: "fleet_inspections", p_id: "i1" }]]);
    expect(calls.deletes).toBe(0);
  });
  it("a workshop visit too, returning the visit it hid", async () => {
    const { client, calls } = fake({ id: "v1", vehicle_id: "k" });
    const res = await deleteFleetVisit(client, "v1");
    expect(res.data).toMatchObject({ id: "v1", vehicle_id: "k" });
    expect(calls.rpc).toEqual([["fleet_hide_row", { p_table: "fleet_workshop_visits", p_id: "v1" }]]);
    expect(calls.deletes).toBe(0);
  });
  it("an already-hidden visit is 'not found'", async () => {
    const { client, calls } = fake({ id: "v1", vehicle_id: "k", deleted_at: "2026-11-23T10:00:00Z" });
    expect((await deleteFleetVisit(client, "v1")).data).toBeNull();
    expect(calls.rpc).toEqual([]);
  });
});

describe("reads leave hidden rows out", () => {
  const rows = [{ id: "a" }, { id: "b", deleted_at: "2026-11-23T10:00:00Z" }, { id: "c", deleted_at: null }];
  it("visits, inspections and km readings", async () => {
    for (const read of [() => getFleetVisits(fake(rows).client), () => getFleetInspections(fake(rows).client), () => getFleetOdometerReadings(fake(rows).client, "k")])
      expect(((await read()).data as { id: string }[]).map((r) => r.id)).toEqual(["a", "c"]);
  });
  it("one hidden inspection reads as not there", async () => {
    expect((await getFleetInspection(fake({ id: "b", deleted_at: "x" }).client, "b")).data).toBeNull();
    expect((await getFleetInspection(fake({ id: "a" }).client, "a")).data).toEqual({ id: "a" });
  });
  it("a hidden booked visit doesn't block bookings", async () => {
    const blocks = await getWorkshopBlocks(
      fake([
        { id: "v1", vehicle_id: "k", date: "2026-12-05", until: null, kind: "Service", provider: "Motech" },
        { id: "v2", vehicle_id: "k", date: "2026-12-06", until: null, kind: "Tyres", provider: "X", deleted_at: "2026-11-23T10:00:00Z" },
      ]).client,
      "2026-12-01",
      "2026-12-31"
    );
    expect(blocks).toEqual([{ id: "v1", vehicle_id: "k", date: "2026-12-05", until: null, kind: "Service", provider: "Motech" }]);
  });
});
