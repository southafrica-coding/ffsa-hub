// SPEC 7.3: who hears about a booked or moved workshop visit, and what they're told.

import { describe, expect, it } from "vitest";
import { seedFleetData } from "../testing/seed";
import { visitBlockedIds, visitMoved, visitNotices, type FleetData, type Trip } from "./index";

const TUE = "2026-11-17";

describe("visitNotices", () => {
  it("10.6 Service on the rented Almera 25–26 Nov: clash, no similar car, wait or make other plans", () => {
    const base = seedFleetData(TUE);
    const F: FleetData = {
      ...base,
      visits: [...base.visits, { id: "r-test", vehicleId: "almera", status: "booked", kind: "Service", date: "2026-11-25", until: "2026-11-26", provider: "Motech" }],
    };
    const n = visitNotices(F, "r-test");
    expect(n).toHaveLength(1);
    expect(n[0].kind).toBe("clash");
    expect(n[0].alternatives).toEqual([]);
    expect(n[0].backOn).toBe("2026-11-27");
    expect(n[0].text).toMatch(/is booked in for a service .*No similar car is free for your dates\. You can wait until it’s back on Fri, 27 Nov, or make other plans\.$/);
  });

  it("10.7 Kombi visit over a 19–21 Nov booking: offers H1 #1 and H1 #2", () => {
    const base = seedFleetData(TUE);
    const trip: Trip = { id: "b-1:kombi", vehicleId: "kombi", from: "2026-11-19", to: "2026-11-21", label: "HULC" };
    const F: FleetData = {
      ...base,
      trips: [...base.trips, trip],
      visits: [...base.visits, { id: "r-k", vehicleId: "kombi", status: "booked", kind: "Service", date: "2026-11-20", until: "2026-11-20", provider: "Motech" }],
    };
    const c = visitNotices(F, "r-k").find((x) => x.trip.id === "b-1:kombi")!;
    expect(c.kind).toBe("clash");
    expect(c.bookingId).toBe("b-1");
    expect(c.alternatives.map((v) => v.name)).toEqual(["Hyundai H1 #1", "Hyundai H1 #2"]);
    expect(c.text).toContain("The Vehicle Coordinator can switch you to one: reply to them.");
  });

  it("gives a heads-up to a booking starting within 7 days after the visit, and nothing after 7", () => {
    const base = seedFleetData(TUE);
    const F: FleetData = {
      ...base,
      trips: [
        ...base.trips,
        { id: "b-near:h1-1", vehicleId: "h1-1", from: "2026-12-03", to: "2026-12-04", label: "Outreach" },
        { id: "b-far:h1-1", vehicleId: "h1-1", from: "2026-12-10", to: "2026-12-11", label: "Later" },
      ],
      visits: [...base.visits, { id: "r-h", vehicleId: "h1-1", status: "booked", kind: "Service", date: "2026-12-01", until: "2026-12-02", provider: "Motech" }],
    };
    const n = visitNotices(F, "r-h");
    expect(n.map((x) => [x.bookingId, x.kind])).toEqual([["b-near", "heads-up"]]);
    expect(n[0].text).toMatch(/^Heads-up: .* the day before Outreach starts \(Thu, 03 Dec\)/);
  });

  it("says nothing for a visit that's done or unknown", () => {
    expect(visitNotices(seedFleetData(TUE), "nope")).toEqual([]);
  });
});

describe("visitMoved", () => {
  const v = { vehicleId: "a", date: "2026-12-01", until: "2026-12-02", status: "booked" };
  it("is true for a new or re-dated booked visit, false otherwise", () => {
    expect(visitMoved(null, v)).toBe(true);
    expect(visitMoved(v, { ...v })).toBe(false);
    expect(visitMoved(v, { ...v, until: "2026-12-03" })).toBe(true);
    expect(visitMoved(v, { ...v, vehicleId: "b" })).toBe(true);
    expect(visitMoved({ ...v, status: "done" }, v)).toBe(true);
    expect(visitMoved(v, { ...v, status: "done" })).toBe(false);
  });
});

describe("visitBlockedIds", () => {
  it("blocks vehicles with a booked visit overlapping the dates", () => {
    const visits = [
      { vehicleId: "a", date: "2026-12-01", until: "2026-12-02", status: "booked" },
      { vehicleId: "b", date: "2026-12-01", until: null, status: "booked" },
      { vehicleId: "c", date: "2026-12-01", until: "2026-12-05", status: "done" },
    ];
    expect(visitBlockedIds(visits, "2026-12-02", "2026-12-04")).toEqual(["a"]);
    expect(visitBlockedIds(visits, "2026-11-28", "2026-12-01").sort()).toEqual(["a", "b"]);
  });
});
