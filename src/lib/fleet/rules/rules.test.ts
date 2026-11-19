// SPEC section 10 acceptance tests that are rules (1–9, 13), on the exported data, on
// Tue 17 Nov 2026 unless stated. Expected text is the FFSA Fleet app's.

import { describe, expect, it } from "vitest";
import { seedFleetData, withVehicle } from "../testing/seed";
import {
  B2B_KIND,
  alternatives,
  clashList,
  clashNote,
  kmAlerts,
  odoPatch,
  suggestGap,
  todayTasks,
  vehicleAlerts,
  visitError,
  weekly,
  type FleetData,
  type Trip,
} from "./index";

const TUE = "2026-11-17";
const v = (F: FleetData, id: string) => F.vehicles.find((x) => x.id === id)!;

describe("SPEC 10.1 Today on Tue 17 Nov 2026", () => {
  const { tasks, later } = todayTasks(seedFleetData(TUE));

  it("lists the H1 #1 and H1 #2 weekly checks, due today, about 22 minutes each", () => {
    const routine = tasks.filter((t) => t.title === "Weekly check" || t.title === "Monthly check");
    expect(routine.map((t) => [t.v.name, t.title, t.sub, t.mins])).toEqual([
      ["Hyundai H1 #1", "Weekly check", "Due today", 22],
      ["Hyundai H1 #2", "Weekly check", "Due today", 22],
    ]);
  });

  it("shows what's coming up in the next two days", () => {
    const lines = later.map((l) => `${l.v.name}: ${l.text}`);
    expect(lines).toEqual(
      expect.arrayContaining([
        "Hyundai H1 #3: Weekly check tomorrow",
        "VW Kombi: Weekly check tomorrow",
        "Honda CR-V: Bumper-to-bumper inspection at Motech tomorrow",
        "Hyundai H1 #3: Bumper-to-bumper inspection at Motech Thu, 19 Nov",
        "VW Kombi: Bumper-to-bumper inspection at Motech Thu, 19 Nov",
        "Honda CR-V: Leaves Thu, 19 Nov (Rental, back Sun, 13 Dec): pre-trip check before it goes",
        "Nissan Almera: Leaves Thu, 19 Nov (Rental, back Sun, 13 Dec): pre-trip check before it goes",
      ])
    );
  });
});

describe("SPEC 10.2 Calendar heads-up", () => {
  it("warns the CR-V rental starts the day after its bumper-to-bumper inspection", () => {
    const near = clashList(seedFleetData(TUE)).filter((c) => c.vehicleId === "crv" && c.kind === "near");
    expect(near.map((c) => c.text)).toContain(
      "Rental starts Thu, 19 Nov, the day after the bumper-to-bumper inspection (Wed, 18 Nov): make sure it’s back and checked in time"
    );
  });
});

describe("SPEC 10.3–10.5 services and bumper-to-bumper inspections by km", () => {
  it("10.3 H1 #2: service and inspection due in 80 km, as one visit", () => {
    const F = withVehicle(seedFleetData(TUE), "h1-2", { lastService: { km: 215000 }, odometer: 224920 });
    expect(kmAlerts(F, v(F, "h1-2"))).toEqual([
      { sev: "warn", svc: true, text: "Service and bumper-to-bumper inspection due in 80 km (at 225\u00a0000 km): book it at the workshop" },
    ]);
  });

  it("10.4 Almera: overdue by 153 km, critical", () => {
    const F = withVehicle(seedFleetData(TUE), "almera", { lastService: { km: 121000 }, odometer: 131153 });
    expect(kmAlerts(F, v(F, "almera"))).toEqual([
      { sev: "crit", svc: true, text: "Service and bumper-to-bumper inspection overdue by 153 km (was due at 131\u00a0000 km)" },
    ]);
  });

  it("10.5 CR-V: inspection due at 313\u00a0000 km, booked for Wed 18 Nov", () => {
    const F = withVehicle(seedFleetData(TUE), "crv", { lastB2B: { km: 308000 }, odometer: 312606 });
    expect(kmAlerts(F, v(F, "crv"))).toEqual([
      { sev: "info", svc: false, booked: "2026-11-18", text: "Bumper-to-bumper inspection due at 313\u00a0000 km: booked for Wed, 18 Nov" },
    ]);
  });
});

describe("SPEC 10.6–10.7 clashes", () => {
  it("10.6 a Service visit 25–26 Nov on the rented Almera: no similar car, move it to Mon 14 – Tue 15 Dec", () => {
    const base = seedFleetData(TUE);
    const F: FleetData = {
      ...base,
      visits: [...base.visits, { id: "r-test", vehicleId: "almera", status: "booked", kind: "Service", date: "2026-11-25", until: "2026-11-26", provider: "Motech" }],
    };
    const c = clashList(F).find((x) => x.vehicleId === "almera" && x.kind === "overlap");
    expect(c?.sev).toBe("crit");
    expect(clashNote(F, c!)).toMatch(/^No similar car is free/);
    expect(suggestGap(F, "almera", { ignore: "r-test" })).toEqual({ from: "2026-12-14", to: "2026-12-15" });
  });

  it("10.7 a Kombi booking 19–21 Nov over its workshop visit: H1 #1 and H1 #2 are free; moving it clears the clash", () => {
    const base = seedFleetData(TUE);
    const trip: Trip = { id: "t-test", vehicleId: "kombi", from: "2026-11-19", to: "2026-11-21", label: "HULC" };
    const F: FleetData = { ...base, trips: [...base.trips, trip] };
    expect(clashList(F).some((c) => c.vehicleId === "kombi" && c.kind === "overlap" && c.t?.id === "t-test")).toBe(true);
    expect(alternatives(F, trip).map((x) => x.name)).toEqual(["Hyundai H1 #1", "Hyundai H1 #2"]);
    const moved: FleetData = { ...base, trips: [...base.trips, { ...trip, vehicleId: "h1-1" }] };
    expect(clashList(moved).some((c) => c.t?.id === "t-test" && c.sev === "crit")).toBe(false);
  });
});

describe("SPEC 10.8 Log km", () => {
  it("updates the odometer, keeps the previous reading and warns 10 km before", () => {
    const F = withVehicle(seedFleetData(TUE), "h1-2", { lastService: { km: 215000 }, odometer: 224920 });
    const h = v(F, "h1-2");
    const patch = odoPatch(h, 224990, TUE);
    expect(patch).toEqual({ odometer: 224990, odometerDate: TUE, odoPrev: { km: 224920, date: h.odometerDate } });
    const after = kmAlerts(F, { ...h, ...patch }).find((a) => a.sev !== "info");
    expect(after?.text).toBe("Service and bumper-to-bumper inspection due in 10 km (at 225\u00a0000 km): book it at the workshop");
  });

  it("ignores a reading lower than the last one", () => {
    const F = seedFleetData(TUE);
    expect(odoPatch(v(F, "h1-2"), 1000, TUE)).toEqual({});
  });
});

describe("SPEC 10.9 workshop visit without an odometer reading", () => {
  it("refuses a done bumper-to-bumper inspection with no odometer", () => {
    expect(visitError({ id: "r", status: "done", kind: B2B_KIND, date: TUE, odometer: null })).toBe(
      "Enter the odometer reading: the next service and bumper-to-bumper inspection are worked out from it."
    );
    expect(visitError({ id: "r", status: "done", kind: B2B_KIND, date: TUE, odometer: 313000 })).toBeNull();
    expect(visitError({ id: "r", status: "booked", kind: B2B_KIND, date: TUE })).toBeNull();
  });
});

describe("SPEC 10.13 monthly checks after the weekly-only weeks", () => {
  it("on Tue 1 Dec 2026 the routine checks are monthly again", () => {
    const F = seedFleetData("2026-12-01");
    const types = F.vehicles.map((x) => weekly(F, x).type);
    expect(new Set(types)).toEqual(new Set(["monthly"]));
  });

  it("in the weekly-only week of 16 Nov they are weekly", () => {
    const F = seedFleetData(TUE);
    expect(new Set(F.vehicles.map((x) => weekly(F, x).type))).toEqual(new Set(["weekly"]));
  });
});

describe("Needs attention", () => {
  it("puts the CR-V's clash heads-up and its workshop visit on the vehicle", () => {
    const F = seedFleetData(TUE);
    const texts = vehicleAlerts(F, v(F, "crv")).map((a) => a.text);
    expect(texts).toContain("Workshop visit Wed, 18 Nov (Workshop inspection (bumper to bumper), Motech)");
    expect(texts.some((t) => t.startsWith("Rental starts Thu, 19 Nov, the day after"))).toBe(true);
  });
});
