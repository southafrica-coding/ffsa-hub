// Fleet part 5a (SPEC 7.3): a booked workshop visit blocks its vehicle from `date` to
// `until`, so the Hub's clash check treats it as taken: new bookings, edits, the public
// request form, approvals and the "free vehicles" lists all refuse it.

import { describe, expect, it } from "vitest";
import { getOverlappingAssignments, getWorkshopBlocks } from "./vehicles";

type Row = Record<string, unknown>;

/** A tiny in-memory Supabase: just the filters these two functions use. */
function fakeDb(tables: Record<string, Row[]>) {
  return {
    from(t: string) {
      let rows = [...(tables[t] ?? [])];
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => ((rows = rows.filter((r) => r[c] === v)), q),
        in: (c: string, vs: unknown[]) => ((rows = rows.filter((r) => vs.includes(r[c]))), q),
        lte: (c: string, v: string) => ((rows = rows.filter((r) => String(r[c]) <= v)), q),
        gte: (c: string, v: string) => ((rows = rows.filter((r) => String(r[c]) >= v)), q),
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(ok),
      };
      return q;
    },
  };
}

const visits: Row[] = [
  { id: "w1", vehicle_id: "kombi", status: "booked", date: "2026-12-01", until: "2026-12-03", kind: "Service", provider: "Motech" },
  { id: "w2", vehicle_id: "h1", status: "booked", date: "2026-12-10", until: null, kind: null, provider: null },
  { id: "w3", vehicle_id: "h2", status: "done", date: "2026-12-01", until: "2026-12-05", kind: "Service", provider: "Motech" },
];
const bookings: Row[] = [{ id: "b1", status: "approved", checkout_date: "2026-12-02", return_date: "2026-12-04" }];
const assignments: Row[] = [{ vehicle_booking_id: "b1", vehicle_id: "crv" }];
const db = () => fakeDb({ fleet_workshop_visits: visits, vehicle_bookings: bookings, vehicle_booking_assignments: assignments });

describe("getWorkshopBlocks", () => {
  it("finds booked visits overlapping the dates, from the day in to the day back", async () => {
    expect((await getWorkshopBlocks(db(), "2026-12-03", "2026-12-04")).map((v) => v.id)).toEqual(["w1"]);
    expect((await getWorkshopBlocks(db(), "2026-12-04", "2026-12-09")).map((v) => v.id)).toEqual([]);
  });

  it("a one-day visit (no until) blocks that day only", async () => {
    expect((await getWorkshopBlocks(db(), "2026-12-10", "2026-12-10")).map((v) => v.id)).toEqual(["w2"]);
    expect((await getWorkshopBlocks(db(), "2026-12-11", "2026-12-12")).map((v) => v.id)).toEqual([]);
  });

  it("ignores visits that are done", async () => {
    expect((await getWorkshopBlocks(db(), "2026-12-01", "2026-12-05")).map((v) => v.vehicle_id)).not.toContain("h2");
  });
});

describe("getOverlappingAssignments", () => {
  it("counts a vehicle in the workshop as taken, alongside booked vehicles", async () => {
    const out = await getOverlappingAssignments(db(), "2026-12-01", "2026-12-05");
    expect(out).toEqual(
      expect.arrayContaining([
        { vehicle_id: "crv", vehicle_booking_id: "b1" },
        { vehicle_id: "kombi", vehicle_booking_id: "fleet-visit:w1" },
      ])
    );
    expect(out.map((a) => a.vehicle_id)).not.toContain("h2");
  });

  it("still blocks the workshop vehicle when no other booking overlaps", async () => {
    const out = await getOverlappingAssignments(db(), "2026-12-10", "2026-12-10");
    expect(out).toEqual([{ vehicle_id: "h1", vehicle_booking_id: "fleet-visit:w2" }]);
  });

  it("editing a booking doesn't clash with itself, but still with the workshop", async () => {
    const out = await getOverlappingAssignments(db(), "2026-12-02", "2026-12-04", "b1");
    expect(out).toEqual([{ vehicle_id: "kombi", vehicle_booking_id: "fleet-visit:w1" }]);
  });
});
