import { describe, expect, it } from "vitest";
import { holdEnd, holdDays, blockEnd, blocksWindow, HOLD_PURPOSE } from "./hold";
import { getOverlappingAssignments } from "@/services/vehicles";
import { createFakeDb } from "./testing/fake-db";

describe("the hold after an International Team booking", () => {
  it("runs to the 3rd working day after the due-back day (same as migration 365's vehicle_hold_end)", () => {
    // Checked against vehicle_hold_end() on PGlite, 24 Nov 2026.
    const sql: Record<string, string> = {
      "2026-11-30": "2026-12-03", // Mon → Tue, Wed, Thu
      "2026-12-01": "2026-12-04",
      "2026-12-02": "2026-12-07", // Wed → Thu, Fri, (weekend), Mon
      "2026-12-03": "2026-12-08",
      "2026-12-04": "2026-12-09", // Fri → (Sat, Sun) Mon, Tue, Wed
      "2026-12-05": "2026-12-09",
      "2026-12-06": "2026-12-09",
    };
    for (const [due, end] of Object.entries(sql)) expect(holdEnd(due)).toBe(end);
  });

  it("skips South African public holidays (also checked against SQL for every day 2026–2035)", () => {
    expect(holdEnd("2026-12-15")).toBe("2026-12-21"); // Tue → (16 Dec) Thu, Fri, Mon
    expect(holdEnd("2026-12-24")).toBe("2026-12-30"); // Thu → (25, 26, 27) Mon, Tue, Wed
    expect(holdEnd("2027-03-25")).toBe("2027-04-01"); // Thu → (Good Friday … Family Day) Tue, Wed, Thu
    expect(holdEnd("2026-08-06")).toBe("2026-08-12"); // Thu → Fri, (9 Aug Sun, Mon 10 observed) Tue, Wed
  });

  it("only for International Team, and not once the coordinator releases it", () => {
    expect(holdDays({ purpose: HOLD_PURPOSE, return_date: "2026-12-04" })).toEqual({ from: "2026-12-05", to: "2026-12-09" });
    expect(holdDays({ purpose: "ministry", return_date: "2026-12-04" })).toBeNull();
    expect(holdDays({ purpose: HOLD_PURPOSE, return_date: "2026-12-04", hold_released_at: "2026-12-04T10:00:00Z" })).toBeNull();
    expect(blockEnd({ purpose: "ministry", return_date: "2026-12-04" })).toBe("2026-12-04");
  });

  it("outlasts completion, but a completed booking no longer holds its own days", () => {
    const b = { purpose: HOLD_PURPOSE, status: "completed", checkout_date: "2026-11-30", return_date: "2026-12-04" };
    expect(blocksWindow(b, "2026-12-04", "2026-12-04")).toBe(false);
    expect(blocksWindow(b, "2026-12-07", "2026-12-07")).toBe(true);
    expect(blocksWindow(b, "2026-12-10", "2026-12-12")).toBe(false);
    expect(blocksWindow({ ...b, status: "cancelled" }, "2026-12-07", "2026-12-07")).toBe(false);
    expect(blocksWindow({ ...b, status: "approved", purpose: "ministry" }, "2026-12-05", "2026-12-07")).toBe(false);
  });

  it("the clash check refuses a held vehicle, until the hold is released", async () => {
    const db = createFakeDb();
    db.tables.vehicle_bookings = [
      { id: "A", status: "completed", purpose: HOLD_PURPOSE, checkout_date: "2026-11-30", return_date: "2026-12-04", hold_released_at: null },
      { id: "B", status: "approved", purpose: "ministry", checkout_date: "2026-11-30", return_date: "2026-12-04" },
    ];
    db.tables.vehicle_booking_assignments = [
      { vehicle_booking_id: "A", vehicle_id: "almera" },
      { vehicle_booking_id: "B", vehicle_id: "kombi" },
    ];
    db.tables.fleet_workshop_visits = [];
    const held = async (from: string, to: string) => (await getOverlappingAssignments(db, from, to)).map((a) => a.vehicle_id).sort();
    expect(await held("2026-12-07", "2026-12-08")).toEqual(["almera"]);
    expect(await held("2026-12-10", "2026-12-12")).toEqual([]);
    db.tables.vehicle_bookings[0].hold_released_at = "2026-12-05T08:00:00Z";
    expect(await held("2026-12-07", "2026-12-08")).toEqual([]);
  });
});
