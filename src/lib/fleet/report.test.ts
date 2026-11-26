// The vehicle history report (Gideon, 23 Nov 2026).

import { describe, expect, it } from "vitest";
import { seedFleetData } from "./testing/seed";
import { buildVehicleReport, reportFileName, type ReportInput } from "./report";
import { renderVehicleReportPdf } from "./report-pdf";
import { defaultReportFrom } from "@/app/(admin)/bookings/vehicles/fleet/[vehicleId]/report-button";

// Numbers use a non-breaking space; compare with plain spaces.
const sp = (x: string) => x.replace(/\s/g, " ");
const F = seedFleetData("2026-12-20");
const base = (over: Partial<ReportInput> = {}): ReportInput => ({
  vehicle: { name: "VW Kombi", reg: "KLK 556 NW", make: "Volkswagen", model: "T5 Kombi", year: 2015, colour: "Silver", vin: "VIN123" },
  from: "2026-12-01",
  to: "2026-12-31",
  inspections: [
    { id: "i1", vehicleId: "k", type: "workshop", date: "2026-12-02", odometer: 314100, fuel: "", inspector: "Gideon", provider: "Motech", bookingId: null, docs: [], walk: {}, extra: [], summary: "See diagnostic report.", mins: 1, startedAt: "",
      results: { "m25-balljoints": { s: "fix", v: "", n: "Bushes worn", p: [], t: "Ball joints and control arms" }, "m25-oil": { s: "ok", v: "", n: "", p: [], t: "Engine oil" } },
      counts: { fix: 1, mon: 0, ok: 1, na: 0 } },
    { id: "old", vehicleId: "k", type: "weekly", date: "2026-11-20", odometer: 313000, fuel: "", inspector: "", provider: "", bookingId: null, docs: [], walk: {}, extra: [], summary: "", mins: 1, startedAt: "", results: {}, counts: { fix: 0, mon: 0, ok: 0, na: 0 } },
  ] as never,
  visits: [
    { id: "v1", vehicleId: "k", status: "done", kind: "Service", date: "2026-12-05", provider: "Motech", odometer: 314200, cost: 4500, ref: "INV-9", description: "Major service", work: [{ d: "Oil and filters" }] },
    { id: "v2", vehicleId: "k", status: "done", kind: "Mechanical repair", date: "2026-12-10", provider: "Motech", odometer: null, cost: null, work: [{ d: "Bushes", cost: 1200 }, { d: "Labour", cost: 800 }] },
    { id: "v3", vehicleId: "k", status: "booked", kind: "Tyres", date: "2026-12-28", provider: "Tiger Wheel", work: [] },
    { id: "v4", vehicleId: "k", status: "done", kind: "Service", date: "2027-01-03", provider: "Motech", cost: 9999, work: [] },
  ] as never,
  fixes: [{ date: "2026-12-10", point: "Ball joints and control arms", by: "Motech", work: "Replaced the bushes.", was: { s: "fix", d: "2026-12-02", n: "Bushes worn" } }],
  readings: [{ date: "2026-12-15", km: 314900 }, { date: "2027-02-01", km: 320000 }],
  trips: [{ id: "b1:k", vehicleId: "k", from: "2026-11-28", to: "2026-12-03", label: "HULC", source: "hub", who: "Jane Doe" }],
  condition: { "m25-aircon": { s: "fix", d: "2026-12-02", n: "A/C not working", t: "Heater and aircon working" }, "m25-wipers": { s: "mon", d: "2026-12-02", n: "Wipers worn", t: "Wiper blades and horn" }, "m25-oil": { s: "ok" } },
  checklist: F.checklist,
  today: "2026-12-20",
  ...over,
});

describe("buildVehicleReport", () => {
  const r = buildVehicleReport(base());

  it("has only what's in the period, by date (a booking that started before it counts from day one)", () => {
    expect(r.entries.map((e) => sp(`${e.date} ${e.kind} ${e.title}`))).toEqual([
      "2026-12-01 booking Booking: HULC",
      "2026-12-02 inspection Workshop report",
      "2026-12-05 workshop Service · Motech",
      "2026-12-10 workshop Mechanical repair · Motech",
      "2026-12-10 fixed Fixed: Ball joints and control arms",
      "2026-12-15 km 314 900 km",
      "2026-12-28 workshop Tyres · Tiger Wheel",
    ]);
  });

  it("workshop visits carry the work, the km, the reference and the cost (the lines' total when there's no cost)", () => {
    const svc = r.entries.find((e) => e.title === "Service · Motech")!;
    expect(svc.cost).toBe(4500);
    expect(svc.lines.map(sp)).toEqual(["Major service", "• Oil and filters", "314 200 km · Ref INV-9"]);
    expect(r.entries.find((e) => e.title === "Mechanical repair · Motech")!.cost).toBe(2000);
    const booked = r.entries.find((e) => e.title === "Tyres · Tiger Wheel")!;
    expect(booked.cost).toBeNull();
    expect(booked.lines[0]).toBe("Booked, not done yet");
  });

  it("inspections list what they found", () => {
    const i = r.entries.find((e) => e.kind === "inspection")!;
    expect(i.lines).toContain("1 fix now, 0 monitor, 1 OK");
    expect(i.lines).toContain("• Fix now: Ball joints and control arms (Bushes worn)");
    expect(i.lines).not.toContain(expect.stringContaining("Engine oil"));
    expect(i.lines).toContain("See diagnostic report.");
  });

  it("sums up the period: km, spend and counts", () => {
    expect(r.summary).toEqual({ kmStart: 314100, kmEnd: 314900, kmDriven: 800, spend: 6500, workshop: 3, inspections: 1, fixes: 1, bookings: 1 });
  });

  it("lists the issues still open now, Fix now first", () => {
    expect(r.open.map((o) => `${o.state}: ${o.point}`)).toEqual(["Fix now: Heater and aircon working", "Monitor: Wiper blades and horn"]);
  });

  it("names the vehicle and the period", () => {
    expect(r.title).toBe("VW Kombi · KLK 556 NW");
    expect(r.vehicleLine).toBe("2015 Volkswagen T5 Kombi · Silver · VIN VIN123");
    expect(r.period).toBe("01 Dec 2026 – 31 Dec 2026");
    expect(reportFileName("KLK 556 NW", "VW Kombi", "2026-12-01", "2026-12-31")).toBe("ffsa-vehicle-report-KLK556NW-2026-12-01-to-2026-12-31.pdf");
  });

  it("an empty period is an empty report, not an error", () => {
    const e = buildVehicleReport(base({ from: "2030-01-01", to: "2030-01-31" }));
    expect(e.entries).toEqual([]);
    expect(e.summary).toMatchObject({ kmStart: null, kmDriven: null, spend: 0 });
  });
});

describe("the PDF", () => {
  it("renders a real PDF", async () => {
    const pdf = await renderVehicleReportPdf(buildVehicleReport(base()));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(2000);
  }, 30000);
});

describe("Download report's default dates", () => {
  it("from 1 Dec 2026 once that's past; before then from the start of the year", () => {
    expect(defaultReportFrom("2027-03-15")).toBe("2026-12-01");
    expect(defaultReportFrom("2026-12-01")).toBe("2026-12-01");
    expect(defaultReportFrom("2026-11-23")).toBe("2026-01-01");
  });
});
