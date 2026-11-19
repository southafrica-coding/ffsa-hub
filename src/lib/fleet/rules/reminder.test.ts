// SPEC 10.14: the daily reminder matches the claude.ai scheduled task. These are the same
// cases as vehicles-module/test/api.test.js, run against the TypeScript port.

import { describe, expect, it } from "vitest";
import { seedFleetData } from "../testing/seed";
import { buildReminder, type FleetData, type FleetVehicle } from "./index";

const empty = (vehicles: FleetVehicle[], extra: Partial<FleetData> = {}): FleetData => ({
  today: "2026-11-17",
  vehicles,
  trips: [],
  visits: [],
  checklist: { sections: [] },
  schedule: { assign: {} },
  ...extra,
});
const van = (extra: Partial<FleetVehicle>): FleetVehicle => ({ id: "a", name: "Van", reg: "X", status: "In service", ...extra });
const opts = { appUrl: "X" };

describe("daily reminder", () => {
  it("for Tue 17 Nov 2026 matches the scheduled task", () => {
    const r = buildReminder(seedFleetData("2026-11-17"), "2026-11-17", opts);
    expect(r.subject).toBe("FFSA inspections – Tuesday, 17 Nov: 2 due today");
    expect(r.sections.today).toEqual(["Hyundai H1 #1 (KVS 119 NW) – weekly check", "Hyundai H1 #2 (JYD 637 NW) – weekly check"]);
    expect(r.sections.tomorrow).toEqual(["Hyundai H1 #3 (KPH 387 NW) – weekly check", "VW Kombi (KLK 556 NW) – weekly check"]);
    expect(r.sections.in2).toHaveLength(0);
    expect(r.sections.postponed).toHaveLength(2);
    expect(r.sections.workshop[0]).toMatch(/Honda CR-V .*Motech, tomorrow/);
    expect(r.sections.cards).toHaveLength(0);
    expect(r.text.endsWith("Open the inspection app: X")).toBe(true);
  });

  it("monthly checks come back in the week of 30 Nov", () => {
    const r = buildReminder(seedFleetData("2026-12-01"), "2026-12-01", opts);
    expect(r.sections.today.length).toBeGreaterThan(0);
    expect(r.sections.today.every((l) => l.endsWith("monthly check"))).toBe(true);
  });

  it("km rules: inspection every 5000, service every 10000, combined visit, booked as inspection only", () => {
    let r = buildReminder(empty([van({ odometer: 109600, lastService: { km: 100000 }, lastB2B: { km: 105000 } })]), "2026-11-17", opts);
    expect(r.sections.km).toEqual(["Van (X): Service and bumper-to-bumper inspection due in 400 km (at 110 000 km), book it at the workshop"]);
    r = buildReminder(empty([van({ odometer: 104700, lastService: { km: 100000 } })]), "2026-11-17", opts);
    expect(r.sections.km).toEqual(["Van (X): Bumper-to-bumper inspection due in 300 km (at 105 000 km), book it at the workshop"]);
    r = buildReminder(empty([van({ odometer: 105200, lastService: { km: 100000 } })]), "2026-11-17", opts);
    expect(r.sections.km[0]).toMatch(/overdue by 200 km/);
    r = buildReminder(
      empty([van({ odometer: 109800, lastService: { km: 100000 }, lastB2B: { km: 105000 }, followUp: { date: "2026-11-20", kind: "Workshop inspection (bumper to bumper)" } })]),
      "2026-11-17",
      opts
    );
    expect(r.sections.km[0]).toMatch(/booked 20 Nov as an inspection only: ask for a service too/);
    r = buildReminder(
      empty([van({ odometer: 109800, lastService: { km: 100000 }, lastB2B: { km: 105000 }, followUp: { date: "2026-11-20", kind: "Service" } })]),
      "2026-11-17",
      opts
    );
    expect(r.sections.km).toHaveLength(0);
  });

  it("clashes and double bookings", () => {
    const r = buildReminder(
      empty([van({})], {
        visits: [{ id: "r1", vehicleId: "a", status: "booked", kind: "Service", date: "2026-11-20", until: "2026-11-21" }],
        trips: [
          { id: "t1", vehicleId: "a", from: "2026-11-21", to: "2026-11-25", label: "HULC" },
          { id: "t2", vehicleId: "a", from: "2026-11-24", to: "2026-11-26", label: "Rental" },
        ],
      }),
      "2026-11-17",
      opts
    );
    expect(r.sections.clashes).toHaveLength(2);
    expect(r.sections.clashes[0]).toMatch(/Service \(20 Nov – 21 Nov\) clashes with HULC/);
    expect(r.sections.clashes[1]).toMatch(/double booked, HULC .* and Rental/);
  });

  it("is empty when there's nothing to say", () => {
    expect(buildReminder(empty([]), "2026-11-17", opts).empty).toBe(true);
  });
});
