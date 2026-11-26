import { describe, expect, it } from "vitest";
import { seedFleetData, withVehicle } from "@/lib/fleet/testing/seed";
import { SEV_RANK, vehicleAlerts } from "@/lib/fleet/rules";
import { ago, condBar, extraOf, fleetAttention, fmtR, statusOf, toKm, vehicleCard, vehicleCards, weekLine } from "./model";

const TUE = "2026-11-17";

describe("ago (the app's relative dates)", () => {
  it("reads like the app", () => {
    expect(ago(TUE, TUE)).toBe("today");
    expect(ago("2026-11-16", TUE)).toBe("yesterday");
    expect(ago("2026-11-20", TUE)).toBe("in 3 days");
    expect(ago("2026-11-01", TUE)).toBe("16 days ago");
    expect(ago("2026-08-17", TUE)).toBe("3 months ago");
    expect(ago("2024-11-17", TUE)).toBe("2 years ago");
    expect(ago(null, TUE)).toBe("");
  });
});

describe("number helpers", () => {
  it("fmtR is rand, or a dash", () => {
    expect(fmtR(5692.5).replace(/\s/g, " ")).toMatch(/^R 5 692,50$/);
    expect(fmtR(null)).toBe("—");
  });
  it("toKm keeps digits only", () => {
    expect(toKm("312 606 km")).toBe(312606);
    expect(toKm("")).toBeNull();
    expect(toKm("abc")).toBeNull();
  });
});

describe("Needs attention", () => {
  it("lists every non-info alert across the fleet, worst first", () => {
    const F = withVehicle(seedFleetData(TUE), "h1-2", { licenceExpiry: "2026-11-01" });
    const all = fleetAttention(F);
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((a) => a.sev !== "info")).toBe(true);
    for (let i = 1; i < all.length; i++) expect(SEV_RANK[all[i - 1].sev]).toBeLessThanOrEqual(SEV_RANK[all[i].sev]);
    const expected = F.vehicles.reduce((n, v) => n + vehicleAlerts(F, v).filter((a) => a.sev !== "info").length, 0);
    expect(all).toHaveLength(expected);
    expect(all[0]).toMatchObject({ sev: "crit", vehicleId: "h1-2", vehicleName: "Hyundai H1 #2" });
  });
});

describe("vehicle cards", () => {
  it("one per vehicle, in fleet order, with the row's photo and last inspection", () => {
    const F = seedFleetData(TUE);
    const rows = [{ id: "crv", details: { photo_file_id: "a".repeat(32), last_inspection: { id: "i1", date: "2026-11-03", type: "weekly" } } }];
    const cards = vehicleCards(F, rows);
    expect(cards.map((c) => c.id)).toEqual(F.vehicles.map((v) => v.id));
    const crv = cards.find((c) => c.id === "crv")!;
    expect(crv.photo).toBe("a".repeat(32));
    expect(crv.last).toBe("Last inspection 14 days ago");
    expect(cards.find((c) => c.id === "almera")!.last).toBe("Never inspected");
  });

  it("top alert is the worst non-info one, and the card is marked by it", () => {
    const F = withVehicle(seedFleetData(TUE), "almera", { licenceExpiry: "2026-11-01" });
    const c = vehicleCard(F, F.vehicles.find((v) => v.id === "almera")!);
    expect(c.sev).toBe("crit");
    expect(c.top?.sev).toBe("crit");
    expect(c.top?.text).toMatch(/licence/i);
  });

  it("condition bar counts and legend", () => {
    const F = withVehicle(seedFleetData(TUE), "crv", {
      condition: { "pre-tyres": { s: "fix" }, "ext-front": { s: "mon" }, "ext-rear": { s: "ok" }, "ext-left": { s: "ok" }, "gone-point": { s: "ok" } },
    });
    const v = F.vehicles.find((x) => x.id === "crv")!;
    const b = condBar(F.checklist, v);
    expect(b.legend).toBe("2 OK · 1 monitor · 1 fix now · 120 of 124 not checked yet");
    expect(b.segs.map((s) => s.k)).toEqual(["fix", "mon", "ok"]);
    expect(b.segs[0].pct).toBeCloseTo(100 / 124, 2);
  });

  it("status: away until the trip's end while on a trip", () => {
    const base = seedFleetData(TUE);
    const F = { ...base, trips: [...base.trips, { id: "t1", vehicleId: "h1-2", from: "2026-11-16", to: "2026-11-20", label: "HULC" }] };
    expect(statusOf(F, F.vehicles.find((v) => v.id === "h1-2")!)).toEqual({ text: "Away until Fri, 20 Nov", tone: "quiet" });
    expect(statusOf(F, F.vehicles.find((v) => v.id === "almera")!)).toEqual({ text: "In service", tone: "good" });
  });

  it("week line names the check only when it's still to do", () => {
    expect(weekLine({ wd: 2, date: TUE, type: "monthly", name: "Monthly check", st: "today", label: "due today" })).toBe("Monthly check: due today");
    expect(weekLine({ wd: 2, date: TUE, type: "weekly", name: "Weekly check", st: "done", label: "done Tue" })).toBe("Weekly check: done Tue");
    expect(weekLine({ wd: null, date: null, type: "weekly", name: "Monthly check", st: "none", label: "no day set" })).toBe("Weekly check: no day set");
  });

  it("extraOf reads details as an object or a one-row array", () => {
    expect(extraOf({ details: [{ vin: "V1", inspection_day: 3 }] })).toMatchObject({ vin: "V1", inspectionDay: 3, photo: null });
    expect(extraOf(null).vin).toBeNull();
  });
});
