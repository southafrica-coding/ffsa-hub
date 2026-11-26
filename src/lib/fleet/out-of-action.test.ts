// Fleet part 5c: a vehicle out of action on bookings (Gideon, 19 Nov 2026).

import { describe, expect, it } from "vitest";
import { seedFleetData, withVehicle } from "@/lib/fleet/testing/seed";
import type { FleetData, Trip } from "@/lib/fleet/rules";
import { LOOK_AHEAD_DAYS, noticeText, outKindOf, outOfAction, restOf } from "./out-of-action";

const DAY = "2026-11-23";
// Vans: h1-1, h1-2, h1-3 (9 seats), kombi (8). Cars: crv, almera (5).
const trip = (id: string, vehicleId: string, from: string, to: string, extra: Partial<Trip> = {}): Trip => ({ id: `${id}:${vehicleId}`, vehicleId, from, to, label: id, source: "hub", ...extra });
const withTrips = (F: FleetData, ...ts: Trip[]): FleetData => ({ ...F, trips: [...F.trips, ...ts], visits: [] });
const base = () => withTrips(seedFleetData(DAY));

describe("outKindOf", () => {
  it("In workshop is a repair, Off the road a breakdown, anything else isn't out", () => {
    const F = base();
    const v = F.vehicles[0];
    expect(outKindOf({ ...v, status: "In workshop" })).toBe("repair");
    expect(outKindOf({ ...v, status: "Off the road" })).toBe("breakdown");
    expect(outKindOf({ ...v, status: "In service" })).toBeNull();
  });
});

describe("outOfAction", () => {
  it("lists the bookings under way and starting in the next 10 days, not later or past ones", () => {
    const F = withTrips(
      withVehicle(base(), "h1-2", { status: "Off the road", statusSince: "2026-11-22" }),
      trip("now", "h1-2", "2026-11-21", "2026-11-25"),
      trip("soon", "h1-2", "2026-12-03", "2026-12-04"),
      trip("later", "h1-2", "2026-12-04", "2026-12-06"),
      trip("past", "h1-2", "2026-11-10", "2026-11-12")
    );
    const o = outOfAction(F).vehicles.find((v) => v.id === "h1-2")!;
    expect(o).toMatchObject({ kind: "breakdown", since: "2026-11-22" });
    const ids = o.bookings.map((b) => b.bookingId);
    expect(ids).toContain("now");
    expect(ids).toContain("soon"); // 3 Dec is exactly 10 days on
    expect(ids).not.toContain("past");
    expect(ids).not.toContain("later");
    expect(o.bookings.find((b) => b.bookingId === "now")!.inProgress).toBe(true);
    expect(LOOK_AHEAD_DAYS).toBe(10);
  });

  it("offers a van for a van, free for the REST of the booking (busy earlier doesn't matter)", () => {
    // h1-1 was busy 20–22 Nov (before today) and is free from today: it counts.
    // h1-3 is busy 24 Nov (inside the rest of the booking): it doesn't. No cars offered.
    const F = withTrips(
      withVehicle(withVehicle(base(), "h1-2", { status: "In workshop", statusSince: DAY }), "h1-1", { followUp: null }),
      trip("now", "h1-2", "2026-11-20", "2026-11-26"),
      trip("other", "h1-1", "2026-11-20", "2026-11-22"),
      trip("busy", "h1-3", "2026-11-24", "2026-11-24")
    );
    const b = outOfAction(F).vehicles.find((v) => v.id === "h1-2")!.bookings[0];
    const swaps = b.swaps.map((s) => s.id);
    expect(swaps).toContain("h1-1");
    expect(swaps).not.toContain("h1-3");
    expect(swaps).not.toContain("crv");
    expect(swaps).not.toContain("h1-2");
  });

  it("a booking on hold whose vehicle is back is listed to resume", () => {
    const F = withTrips(base(), trip("held", "h1-2", "2026-11-21", "2026-11-28", { onHold: "2026-11-22" }));
    expect(outOfAction(F).resume).toEqual([expect.objectContaining({ bookingId: "held", onHold: "2026-11-22" })]);
    // …but not while it's still out.
    const G = withVehicle(F, "h1-2", { status: "In workshop" });
    expect(outOfAction(G).resume).toEqual([]);
  });

  it("only Hub bookings (old-app trips can't be moved or held from here)", () => {
    const F = withTrips(withVehicle(base(), "h1-2", { status: "In workshop" }), trip("app", "h1-2", DAY, DAY, { source: "app" }));
    expect(outOfAction(F).vehicles.find((v) => v.id === "h1-2")!.bookings).toEqual([]);
  });
});

describe("restOf and the notices", () => {
  it("restOf starts a booking under way from today", () => {
    expect(restOf(trip("a", "x", "2026-11-20", "2026-11-26"), DAY).from).toBe(DAY);
    expect(restOf(trip("a", "x", "2026-11-25", "2026-11-26"), DAY).from).toBe("2026-11-25");
  });
  it("say what happened, plainly", () => {
    expect(noticeText.hold("VW Kombi", "repair")).toBe("Your booking is on hold: VW Kombi is in for a repair, and no similar vehicle is free for your dates. We’ll tell you as soon as it’s back.");
    expect(noticeText.resume("VW Kombi")).toBe("VW Kombi is back, so your booking carries on as planned.");
    expect(noticeText.cancel("VW Kombi")).toMatch(/^Vehicle broke down: VW Kombi is off the road/);
  });
});
