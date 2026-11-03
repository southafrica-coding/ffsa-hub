jest.mock("@/lib/supabase", () => ({ supabase: {} }));

// eslint-disable-next-line import/first
import { DataError, loadMine, loadPending, loadSpaceBooking, loadSpaceOptions, loadVehicleBooking } from "../data";

type Result = { data: unknown; error: { message: string; code?: string } | null };

/** A tiny PostgREST stand-in: records the chain, answers per table. */
function fakeDb(answers: Record<string, Result>) {
  const log: { table: string; calls: [string, ...unknown[]][] }[] = [];
  return {
    log,
    client: {
      from(table: string) {
        const entry = { table, calls: [] as [string, ...unknown[]][] };
        log.push(entry);
        const chain: Record<string, unknown> = {};
        for (const m of ["select", "eq", "order", "limit", "single", "in"]) {
          chain[m] = (...args: unknown[]) => {
            entry.calls.push([m, ...args]);
            return chain;
          };
        }
        chain.then = (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(answers[table] ?? { data: [], error: null }).then(resolve, reject);
        return chain;
      },
    } as never,
  };
}

const spaceRow = { id: "s1", venue_id: "v1", title: "Youth night", booking_date: "2026-11-10", status: "approved", venue: [{ id: "v1", name: "Hall" }] };

describe("reads (RLS decides what comes back)", () => {
  it("my requests: filtered to me, both tables, bad rows skipped", async () => {
    const db = fakeDb({
      venue_bookings: { data: [spaceRow, { id: 5 }], error: null },
      vehicle_bookings: { data: [{ id: "vb1", booking_name: "Trip", checkout_date: "2026-11-10", return_date: "2026-11-11", status: "weird" }], error: null },
    });
    const mine = await loadMine("u1", { spaces: true, vehicles: true }, db.client);
    expect(mine.spaces).toHaveLength(1);
    // Embeds that come back as a one-item array are flattened.
    expect(mine.spaces[0].venue?.name).toBe("Hall");
    // An unknown status reads as pending rather than breaking the list.
    expect(mine.vehicles[0].status).toBe("pending");
    expect(db.log.find((l) => l.table === "venue_bookings")?.calls).toContainEqual(["eq", "requested_by", "u1"]);
    expect(db.log.find((l) => l.table === "vehicle_bookings")?.calls).toContainEqual(["eq", "requested_by", "u1"]);
  });

  it("skips a module the person can't open", async () => {
    const db = fakeDb({});
    await loadMine("u1", { spaces: false, vehicles: true }, db.client);
    expect(db.log.map((l) => l.table)).toEqual(["vehicle_bookings"]);
  });

  it("the review queues are pending only", async () => {
    const db = fakeDb({ venue_bookings: { data: [{ ...spaceRow, status: "pending" }], error: null } });
    const p = await loadPending({ spaces: true, vehicles: false }, db.client);
    expect(p.spaces).toHaveLength(1);
    expect(db.log[0].calls).toContainEqual(["eq", "status", "pending"]);
  });

  it("a failed read is a plain error", async () => {
    const db = fakeDb({ venue_bookings: { data: null, error: { message: "boom" } } });
    await expect(loadMine("u1", { spaces: true, vehicles: false }, db.client)).rejects.toBeInstanceOf(DataError);
  });

  it("a booking RLS hides (or that's gone) is null, not an error", async () => {
    const db = fakeDb({ venue_bookings: { data: null, error: { message: "no rows", code: "PGRST116" } } });
    expect(await loadSpaceBooking("s1", db.client)).toBeNull();
    const v = fakeDb({ vehicle_bookings: { data: null, error: { message: "no rows", code: "PGRST116" } } });
    expect(await loadVehicleBooking("vb1", v.client)).toBeNull();
  });

  it("a vehicle booking comes with its checks", async () => {
    const db = fakeDb({
      vehicle_bookings: { data: { id: "vb1", booking_name: "Trip", checkout_date: "2026-11-10", return_date: "2026-11-11", status: "approved" }, error: null },
      vehicle_inspections: { data: [{ id: "i1", kind: "collection", mileage: 100, performed_at: "2026-11-10T08:00:00Z" }], error: null },
    });
    const d = await loadVehicleBooking("vb1", db.client);
    expect(d?.inspections[0]).toMatchObject({ kind: "collection", mileage: 100, damage_panels: [] });
  });

  it("spaces and ministries are the active ones", async () => {
    const db = fakeDb({ venues: { data: [{ id: "v1", name: "Hall", requires_approval: true }], error: null }, ministries: { data: [{ id: "m1", name: "Youth" }], error: null } });
    const o = await loadSpaceOptions(db.client);
    expect(o.venues[0].requires_approval).toBe(true);
    expect(db.log[0].calls).toContainEqual(["eq", "is_active", true]);
  });
});
