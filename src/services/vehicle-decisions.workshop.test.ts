// Fleet part 5a: approving a request re-checks its vehicles against booked workshop
// visits, since a visit can be booked after the request went in (SPEC 7.3).

import { beforeEach, describe, expect, it, vi } from "vitest";

let blocks: { id: string; vehicle_id: string; date: string; until: string | null; kind: string | null; provider: string | null }[] = [];
const updates: unknown[] = [];

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/vehicles/requester-notify", () => ({ notifyVehicleRequester: vi.fn(async () => ({ slack: false, email: false })) }));
vi.mock("@/services/vehicles", () => ({
  getVehicleBookingById: async () => ({
    data: {
      id: "b1",
      status: "pending",
      checkout_date: "2026-12-02",
      return_date: "2026-12-04",
      assignments: [{ vehicle: { id: "kombi", name: "VW Kombi" } }],
    },
  }),
  // One outside driver with both photos, so the licence checks pass.
  getBookingDrivers: async () => ({ data: [{ id: "d1", name: "Jane", user_id: null, license_file_url: "x", passport_file_url: "y" }] }),
  getLicenceFactsFor: async () => new Map(),
  eligibilityInput: () => ({}),
  getWorkshopBlocks: vi.fn(async () => blocks),
  getOverlappingAssignments: async () => [],
  setBookingVehicles: async () => ({ error: null }),
  updateVehicleBooking: vi.fn(async (_s: unknown, _id: string, patch: unknown) => (updates.push(patch), { error: null })),
}));

import { decideVehicleBooking } from "./vehicle-decisions";

beforeEach(() => {
  blocks = [];
  updates.length = 0;
});

describe("approving over a workshop visit", () => {
  it("is refused, naming the vehicle, the workshop and the dates", async () => {
    blocks = [{ id: "w1", vehicle_id: "kombi", date: "2026-12-03", until: "2026-12-05", kind: "Service", provider: "Motech" }];
    const r = await decideVehicleBooking({}, "u1", "b1", "approved", null);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(409);
      expect(r.error).toMatch(/^Can't approve — VW Kombi is booked in at Motech .+\. Assign a different vehicle, or move the workshop visit in Fleet\.$/);
    }
    expect(updates).toHaveLength(0);
  });

  it("goes through when the vehicle has no visit then", async () => {
    blocks = [{ id: "w2", vehicle_id: "h1", date: "2026-12-03", until: null, kind: null, provider: null }];
    expect(await decideVehicleBooking({}, "u1", "b1", "approved", null)).toEqual({ ok: true });
    expect(updates).toHaveLength(1);
  });

  it("doesn't stand in the way of denying it", async () => {
    blocks = [{ id: "w1", vehicle_id: "kombi", date: "2026-12-03", until: null, kind: null, provider: null }];
    expect(await decideVehicleBooking({}, "u1", "b1", "denied", null)).toEqual({ ok: true });
  });
});
