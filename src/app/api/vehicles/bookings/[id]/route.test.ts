// PATCH /api/vehicles/bookings/[id]: a dates-only edit to a pending booking checks the
// vehicle already on it for clashes (Jack's review of #712).
import { beforeEach, describe, expect, it, vi } from "vitest";

const B = "00000000-0000-4000-8000-b00000000001";
let held: string[] = [];
const updates: Record<string, unknown>[] = [];
const windows: [string, string][] = [];

vi.mock("next/server", async (orig) => ({ ...(await orig<object>()), after: () => {} }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/api-auth", () => ({ getAuthedUser: async () => ({ id: "u-owner" }) }));
vi.mock("@/lib/vehicles/slack-alerts", () => ({ refreshVehicleRequestAlerts: async () => {} }));
vi.mock("@/lib/vehicles/requester-notify", () => ({ notifyVehicleRequester: async () => ({}) }));
vi.mock("@/lib/email/send-vehicle-request", () => ({ notifyVehicleManagers: async () => {} }));
vi.mock("@/services/vehicles", async (orig) => ({
  ...(await orig<object>()),
  getVehicleAccess: async () => ({ isAdmin: false, canApprove: false, canManage: false }),
  getVehicleBookingById: async () => ({
    data: {
      id: B, status: "pending", requested_by: "u-owner", purpose: "ministry", checkout_date: "2026-12-01", return_date: "2026-12-04",
      booking_name: "Camp", assignments: [{ vehicle: { id: "kombi", name: "VW Kombi" } }], drivers: [],
    },
  }),
  getOverlappingAssignments: async (_s: unknown, from: string, to: string) => (windows.push([from, to]), held.map((v) => ({ vehicle_id: v, vehicle_booking_id: "other" }))),
  updateVehicleBooking: async (_s: unknown, _id: string, u: Record<string, unknown>) => (updates.push(u), { error: null }),
}));

import { PATCH } from "./route";
const patch = (body: unknown) =>
  PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id: B }) });

beforeEach(() => {
  held = [];
  updates.length = 0;
  windows.length = 0;
});

describe("dates-only edit", () => {
  it("is refused when the vehicle on the booking is taken on the new dates", async () => {
    held = ["kombi"];
    const res = await patch({ return_date: "2026-12-08" });
    expect(res.status).toBe(409);
    expect((await res.json()).clashingVehicleIds).toEqual(["kombi"]);
    expect(windows).toEqual([["2026-12-01", "2026-12-08"]]);
    expect(updates).toHaveLength(0);
  });

  it("goes through when it's free", async () => {
    const res = await patch({ return_date: "2026-12-08" });
    expect(res.status).toBe(200);
    expect(updates[0]).toMatchObject({ return_date: "2026-12-08" });
  });

  it("a purpose-only change to International Team checks the hold after it (Jack's review of #723)", async () => {
    held = ["kombi"];
    const res = await patch({ purpose: "international_team" });
    expect(res.status).toBe(409);
    // Due back Fri 4 Dec: the hold runs Sat 5 to Wed 9 Dec, so the window reaches the 9th.
    expect(windows).toEqual([["2026-12-01", "2026-12-09"]]);
    expect(updates).toHaveLength(0);
  });

  it("…and goes through when the vehicle is free through the hold", async () => {
    const res = await patch({ purpose: "international_team" });
    expect(res.status).toBe(200);
    expect(windows).toEqual([["2026-12-01", "2026-12-09"]]);
    expect(updates[0]).toMatchObject({ purpose: "international_team" });
  });

  it("an edit that doesn't touch the dates doesn't check", async () => {
    held = ["kombi"];
    const res = await patch({ booking_name: "Youth camp" });
    expect(res.status).toBe(200);
    expect(windows).toHaveLength(0);
  });
});
