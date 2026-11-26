// Jack's review of #712: nobody approves their own early return or booking, and with
// VEHICLE_RENTAL_MESSAGES_ENABLED off, Returned and Return early send nothing.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./testing/fake-db";

const sent: string[] = [];
const db = createFakeDb();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db }));
vi.mock("@/lib/slack/client", () => ({
  openConversation: async (id: string) => ({ ok: true, channel: { id: `D-${id}` } }),
  postMessage: async (m: { text: string }) => (sent.push(`slack: ${m.text}`), { ok: true, ts: "1", channel: "D" }),
  updateMessage: async () => ({ ok: true }),
  openView: async () => ({ ok: true }),
  lookupUserByEmail: async () => ({ ok: false }),
}));
vi.mock("@/lib/email/send-transactional", () => ({
  sendTransactional: async (m: { subject: string }) => (sent.push(`email: ${m.subject}`), { ok: true }),
}));

import { decideEarlyReturn, markReturned, requestEarlyReturn } from "./rental-return";
import { decideVehicleBooking } from "@/services/vehicle-decisions";

const COORD = "00000000-0000-4000-8000-c00000000001";
const OTHER = "00000000-0000-4000-8000-c00000000002";
const B = "00000000-0000-4000-8000-b00000000001";

beforeEach(() => {
  sent.length = 0;
  process.env.SLACK_BOT_TOKEN = "xoxb-test";
  db.tables.users = [
    { id: COORD, first_name: "Pieter", last_name: "C", email: "c@example.org", slack_user_id: "UC" },
    { id: OTHER, first_name: "Ann", last_name: "O", email: "o@example.org", slack_user_id: "UO" },
  ];
  db.tables.vehicle_alert_settings = [{ id: true, slack_alert_user_ids: [OTHER] }];
  db.tables.vehicles = [{ id: "v1", name: "Nissan Almera", registration_plate: "DEMO 1 GP" }];
  // The coordinator booked this one himself.
  db.tables.vehicle_bookings = [
    { id: B, booking_name: "Coordinator's own trip", status: "approved", checkout_date: "2026-12-01", return_date: "2026-12-05", requested_by: COORD, requester_name: "Pieter C", requester_email: "c@example.org", returned_at: null },
  ];
  db.tables.vehicle_booking_assignments = [{ id: "a1", vehicle_booking_id: B, vehicle_id: "v1" }];
  db.tables.vehicle_booking_drivers = [];
  db.tables.vehicle_booking_slack_alerts = [];
  db.tables.fleet_inspections = [];
});
afterEach(() => {
  delete process.env.VEHICLE_RENTAL_MESSAGES_ENABLED;
  delete process.env.VERCEL_ENV;
});

describe("nobody approves their own", () => {
  it("early return: refused for the coordinator who booked, allowed for another", async () => {
    expect((await requestEarlyReturn(db, B, COORD, "2026-12-03", "2026-12-02")).ok).toBe(true);
    const own = await decideEarlyReturn(db, B, COORD, true);
    expect(own.ok).toBe(false);
    expect(db.tables.vehicle_bookings[0].return_date).toBe("2026-12-05");
    expect((await decideEarlyReturn(db, B, OTHER, true)).ok).toBe(true);
    expect(db.tables.vehicle_bookings[0].return_date).toBe("2026-12-03");
  });

  it("early return: nor decline it (Jack's review, 25 Nov)", async () => {
    expect((await requestEarlyReturn(db, B, COORD, "2026-12-03", "2026-12-02")).ok).toBe(true);
    expect((await decideEarlyReturn(db, B, COORD, false)).ok).toBe(false);
    expect(db.tables.vehicle_bookings[0].early_return_status).toBe("requested");
    expect((await decideEarlyReturn(db, B, OTHER, false)).ok).toBe(true);
    expect(db.tables.vehicle_bookings[0].early_return_status).toBe("declined");
  });

  it("booking: the coordinator who booked can't approve it", async () => {
    db.tables.vehicle_bookings[0].status = "pending";
    const r = await decideVehicleBooking(db, COORD, B, "approved", null);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.status).toBe(403);
    expect(db.tables.vehicle_bookings[0].status).toBe("pending");
  });
});

describe("with VEHICLE_RENTAL_MESSAGES_ENABLED off", () => {
  it("Returned and Return early change the booking but send nothing", async () => {
    expect((await requestEarlyReturn(db, B, COORD, "2026-12-03", "2026-12-02")).ok).toBe(true);
    expect((await decideEarlyReturn(db, B, OTHER, false)).ok).toBe(true);
    expect((await markReturned(db, B, OTHER)).ok).toBe(true);
    expect(db.tables.vehicle_bookings[0].returned_at).toBeTruthy();
    expect(sent).toEqual([]);
  });

  it("…and with it on, they do", async () => {
    process.env.VEHICLE_RENTAL_MESSAGES_ENABLED = "1";
    process.env.VERCEL_ENV = "production";
    await requestEarlyReturn(db, B, COORD, "2026-12-03", "2026-12-02");
    await markReturned(db, B, OTHER);
    expect(sent.length).toBeGreaterThan(0);
  });
});

// Jack's review of #727: a failed save says what didn't happen, never the database's message.
describe("when a save fails", () => {
  const DB_ERR = "permission denied for table vehicle_bookings";
  const failing = {
    ...db,
    from: (t: string) => {
      const q = db.from(t);
      if (t !== "vehicle_bookings") return q;
      return new Proxy(q, {
        get(target, p) {
          if (p === "update") {
            const res = { error: { message: DB_ERR } };
            const chain: Record<string, unknown> = { then: (ok: (v: unknown) => unknown) => Promise.resolve(res).then(ok) };
            chain.eq = () => chain;
            chain.is = () => chain;
            return () => chain;
          }
          const v = (target as Record<string | symbol, unknown>)[p];
          return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
        },
      });
    },
  };

  it("the early-return decision", async () => {
    expect((await requestEarlyReturn(db, B, COORD, "2026-12-03", "2026-12-02")).ok).toBe(true);
    const r = await decideEarlyReturn(failing, B, OTHER, true);
    expect(r).toEqual({ ok: false, error: "Couldn’t save the decision on the early return. Nothing was changed: try again." });
  });

  it("Returned", async () => {
    const r = await markReturned(failing, B, OTHER);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toBe("Couldn’t mark it returned. Nothing was changed: try again.");
    expect(JSON.stringify(r)).not.toContain(DB_ERR);
  });
});
