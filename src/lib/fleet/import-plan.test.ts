// The import plan matches the seed to the Hub's six vehicles by registration, and the data
// survives the round trip seed → import rows → mapping → rules unchanged.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { planFleetImport, normReg, type HubBooking, type HubVehicle } from "./import-plan";
import { fleetDataFromRows } from "./mapping";
import { defaultChecklist } from "./content";
import { seedFleetData } from "./testing/seed";
import { buildReminder, todayTasks, vehicleAlerts } from "./rules";

const SEED = path.resolve(__dirname, "testing/fixture"); // the fake data set, shaped like an export
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(SEED, f), "utf8"));
const seed = {
  fleet: read("db/fleet.json"),
  records: read("db/records.json"),
  trips: read("db/trips.json"),
  providers: read("db/providers.json"),
  odometer: read("db/odometer.json"),
  timelog: read("db/timelog.json"),
  inspections: read("db/inspections.json"),
  config: read("db/config.json"),
  files: read("files/index.json"),
};

// public.vehicles as migration 103 seeds them
const HUB: (HubVehicle & Record<string, unknown>)[] = [
  ["VW Bus (Kombi)", "KLK 556 NW", "VW Kombi", "diesel", 8, 10],
  ["Hyundai H1", "KVS 119 NW", "Hyundai H1", "diesel", 9, 20],
  ["Hyundai H2", "JYD 637 NW", "Hyundai H2", "diesel", 9, 30],
  ["Hyundai H3", "KPH 387 NW", "Hyundai H3", "diesel", 9, 40],
  ["Honda CRV", "KKC 267 NW", "Honda CRV", "petrol", 5, 50],
  ["Nissan Almera", "KPC 152 NW", "Nissan Almera", "petrol", 5, 60],
].map(([name, reg, mm, fuel, seats, sort], i) => ({
  id: `00000000-0000-0000-0000-00000000000${i + 1}`,
  name: name as string,
  registration_plate: reg as string,
  make_model: mm,
  fuel_type: fuel,
  seats,
  sort_order: sort,
  status: "active",
}));
const none = { providers: {}, visits: {}, files: new Set<string>() };

describe("fleet import plan", () => {
  const plan = planFleetImport(seed, HUB, [], none);

  it("matches all six vehicles by registration", () => {
    expect(plan.matches.every((m) => m.hubId)).toBe(true);
    expect(plan.details).toHaveLength(6);
    expect(normReg("kvs 119 nw")).toBe(normReg("KVS119NW"));
  });

  it("keeps the Hub's names (no name of its own), and the file ids", () => {
    const h12 = plan.details.find((d) => d.legacy_id === "h1-2")!;
    expect("display_name" in h12).toBe(false);
    expect(plan.files).toHaveLength(19);
    expect(plan.files.every((f) => /^[0-9a-f]{32}$/.test(f.row.id))).toBe(true);
    expect(plan.files.filter((f) => f.row.owner_type === "vehicle")).toHaveLength(5);
  });

  it("points each vehicle's follow-up at the imported visit", () => {
    const crv = plan.details.find((d) => d.legacy_id === "crv")!;
    const visit = plan.visits.find((v) => v.legacy_id === "r-bk-crv")!;
    expect(crv.follow_up?.recId).toBe(visit.id);
  });

  it("reports the two rentals that aren't Hub bookings yet, and creates none", () => {
    expect(plan.tripReport.map((t) => [t.vehicle, t.booking])).toEqual([
      ["Nissan Almera", null],
      ["Honda CR-V", null],
    ]);
    expect(plan.warnings.filter((w) => w.includes("is not imported (bookings are uploaded separately)"))).toHaveLength(2);
  });

  it("recognises a rental that is already a Hub booking", () => {
    const crvId = plan.details.find((d) => d.legacy_id === "crv")!.vehicle_id;
    const bookings: HubBooking[] = [{ id: "b1", booking_name: "CR-V rental", checkout_date: "2026-11-19", return_date: "2026-12-13", status: "approved", vehicle_ids: [crvId] }];
    const p = planFleetImport(seed, HUB, bookings, none);
    expect(p.tripReport.find((t) => t.legacy === "t-crv-rental")?.booking).toBe("CR-V rental (approved)");
  });

  it("re-uses ids on a second run", () => {
    const again = planFleetImport(seed, HUB, [], {
      providers: Object.fromEntries(plan.providers.map((p) => [p.legacy_id, p.id])),
      visits: Object.fromEntries(plan.visits.map((v) => [v.legacy_id, v.id])),
      files: new Set(plan.files.map((f) => f.row.id)),
    });
    expect(again.visits.map((v) => v.id)).toEqual(plan.visits.map((v) => v.id));
    expect(again.files.every((f) => f.exists)).toBe(true);
  });

  it("gives the same Today, alerts and reminder after the round trip", () => {
    for (const today of ["2026-11-17", "2026-11-19", "2026-12-01", "2026-12-14"]) {
      const direct = seedFleetData(today);
      const bookings = Object.entries(seed.trips).map(([id, t]: [string, any]) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
        id,
        booking_name: t.label,
        checkout_date: t.from,
        return_date: t.to,
        assignments: [{ vehicle_id: plan.details.find((d) => d.legacy_id === t.vehicleId)!.vehicle_id }],
      }));
      const viaDb = fleetDataFromRows({
        today,
        // Names come from the Hub now (H1, H2, …). To compare everything else, give the
        // Hub rows here the app's names.
        vehicles: HUB.map((h) => {
          const details = plan.details.find((d) => d.vehicle_id === h.id)!;
          return { ...h, name: seed.fleet[details.legacy_id].name, details };
        }),
        bookings,
        visits: plan.visits,
        settings: plan.settings,
        fallbackChecklist: defaultChecklist(),
      });
      const byName = <T extends { v: { name: string } }>(xs: T[]) => xs.map((x) => ({ ...x, v: x.v.name }));
      const a = todayTasks(direct),
        b = todayTasks(viaDb);
      expect(byName(b.tasks).map(({ action, ...t }) => ({ ...t, action: action?.kind }))).toEqual(
        byName(a.tasks).map(({ action, ...t }) => ({ ...t, action: action?.kind }))
      );
      expect(byName(b.later)).toEqual(byName(a.later));
      for (const v of direct.vehicles) {
        const other = viaDb.vehicles.find((x) => x.name === v.name)!;
        expect(vehicleAlerts(viaDb, other), `${today} ${v.name}`).toEqual(vehicleAlerts(direct, v));
      }
      expect(buildReminder(viaDb, today, { appUrl: "X" })).toEqual(buildReminder(direct, today, { appUrl: "X" }));
    }
  });
});

describe("default checklist", () => {
  it("has the same 124 points and sections as the live one", () => {
    const d = defaultChecklist();
    const live = seed.config.checklist as { sections: { id: string; items: { id: string }[] }[] };
    expect(d.sections.map((s) => s.id)).toEqual(live.sections.map((s) => s.id));
    expect(d.sections.flatMap((s) => s.items.map((i) => i.id))).toEqual(live.sections.flatMap((s) => s.items.map((i) => i.id)));
  });
});
