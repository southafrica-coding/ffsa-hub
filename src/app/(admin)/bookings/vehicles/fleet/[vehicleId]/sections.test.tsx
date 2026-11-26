import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { seedFleetData, withVehicle } from "@/lib/fleet/testing/seed";
import { VSTATUS, cardStatus, vehicleAlerts, whereList } from "@/lib/fleet/rules";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/" }));

import { ConditionTab, HistoryTab, ManualTab, OverviewTab, PhotosTab } from "./sections";
import {
  attentionRows,
  bookedVisits,
  conditionView,
  historyItems,
  keyDates,
  manualStages,
  photoGroups,
  recentTrips,
  vehicleDetails,
  watchPointOptions,
  type Visit,
} from "./model";
import { vehicleFormOf } from "./vehicle-form";
import { extraOf } from "../vehicles/model";

const TUE = "2026-11-17";
const F = withVehicle(seedFleetData(TUE), "h1-1", { condition: { "ext-front": { s: "fix", d: "2026-11-10", i: "i1", n: "Cracked" } } });
const v = F.vehicles.find((x) => x.id === "h1-1")!;
const visits = F.visits.filter((r) => r.vehicleId === "h1-1") as unknown as Visit[];
const x = extraOf({ details: { vin: "VIN1", notes: "Spare key in the safe" } });
const ctx = { vehicle: { id: v.id, name: v.name, odometer: v.odometer ?? null }, providers: ["Kia"], trips: [], gaps: {}, today: TUE };
const watch = { vehicleId: v.id, watch: v.watch || [], rows: attentionRows(F.checklist, v, TUE, visits), options: watchPointOptions(F.checklist), weak: null, canWrite: true, today: TUE };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const html = (el: (p: any) => React.ReactElement, props: Record<string, unknown>) => renderToStaticMarkup(createElement(el, props));

describe("vehicle page tabs render", () => {
  it("Overview: to do, the booked visit with Record the outcome, key dates, details and notes", () => {
    const out = html(OverviewTab, {
      v,
      alerts: vehicleAlerts(F, v),
      booked: bookedVisits(visits),
      keyDates: keyDates(v, visits, TUE),
      watch,
      trips: recentTrips(F, v.id),
      details: vehicleDetails(v, x),
      notes: x.notes,
      ctx,
      canWrite: true,
    });
    expect(out).toContain("Record the outcome");
    expect(out).toContain("Booked at the workshop");
    expect(out).toContain("Workshop spend, last 12 months");
    expect(out).toContain("VIN1");
    expect(out).toContain("Spare key in the safe");
    expect(out).toContain("Keep an eye on");
    expect(out).toContain("&amp;f=issues");
  });

  it("Overview shows the follow-up with Mark done when nothing is booked", () => {
    const fv = { ...v, followUp: { date: "2026-12-01", kind: "Service", recId: "r1" } };
    const out = html(OverviewTab, { v: fv, alerts: [], booked: [], keyDates: [], watch, trips: [], details: [], notes: null, ctx, canWrite: true });
    expect(out).toContain("Follow-up: Service, 01 Dec 2026.");
    expect(out).toContain("Mark done");
  });

  it("Overview for a viewer has no write buttons", () => {
    const out = html(OverviewTab, {
      v,
      alerts: [],
      booked: bookedVisits(visits),
      keyDates: keyDates(v, visits, TUE),
      watch: { ...watch, canWrite: false },
      trips: [],
      details: vehicleDetails(v, x),
      notes: null,
      ctx,
      canWrite: false,
    });
    expect(out).not.toContain("Record the outcome");
    expect(out).not.toContain("Add trip or rental");
    expect(out).not.toContain(">Remove<");
    expect(out).toContain("Nothing due or flagged.");
  });

  it("Condition, History, Photos, Manual", () => {
    expect(html(ConditionTab, { vehicleId: v.id, view: conditionView(F.checklist, v, "issues"), f: "issues", today: TUE })).toContain("Cracked");
    // Mark as fixed (Gideon, 23 Nov 2026): on Fix now points, for people who can manage Fleet.
    expect(html(ConditionTab, { vehicleId: v.id, view: conditionView(F.checklist, v, "issues"), f: "issues", today: TUE, canWrite: true })).toContain("Mark as fixed");
    expect(html(ConditionTab, { vehicleId: v.id, view: conditionView(F.checklist, v, "issues"), f: "issues", today: TUE })).not.toContain("Mark as fixed");
    const fixedV = { ...v, condition: { "ext-front": { s: "ok", d: "2026-11-16", n: "Fixed by Motech: New grille", f: { by: "Motech", work: "New grille", recordedAt: "", was: { s: "fix", d: "2026-11-10", n: "Cracked" } } } } };
    const fixedOut = html(ConditionTab, { vehicleId: v.id, view: conditionView(F.checklist, fixedV as never, "ok"), f: "ok", today: TUE, canWrite: true });
    expect(fixedOut).toContain("Fixed 16 Nov 2026 by Motech:");
    expect(fixedOut).toContain("New grille");
    expect(fixedOut).toContain("Was Fix now (10 Nov 2026): Cracked");
    expect(fixedOut).not.toContain("Mark as fixed");
    // …and on Monitor points (Gideon, 25 Nov 2026), with the History saying it was Monitor.
    const monV = { ...v, condition: { "ext-front": { s: "mon", d: "2026-11-10", n: "Small chip" } } };
    expect(html(ConditionTab, { vehicleId: v.id, view: conditionView(F.checklist, monV as never, "issues"), f: "issues", today: TUE, canWrite: true })).toContain("Mark as fixed");
    const hist = html(HistoryTab, { items: historyItems([], visits, []), ctx, canWrite: true });
    expect(hist).toContain("Body repair");
    expect(hist).toContain("Edit");
    expect(html(HistoryTab, { items: [], ctx, canWrite: false })).toContain("No inspections or workshop visits recorded yet.");
    // Fixes (358) are kept in the History for good, whatever a later inspection says.
    const fixHist = html(HistoryTab, {
      items: historyItems([], [], [], [{ id: "f1", date: "2026-11-22", point: "Ball joints and control arms", by: "Motech", work: "Replaced the bushes.", was: { s: "fix", d: "2026-11-19", n: "Bushes worn" }, createdAt: "" }]),
      ctx,
      canWrite: true,
    });
    expect(fixHist).toContain("Fixed: Ball joints and control arms");
    expect(fixHist).toContain("By Motech:");
    expect(fixHist).toContain("Was Fix now (19 Nov 2026): Bushes worn");
    const monHist = html(HistoryTab, {
      items: historyItems([], [], [], [{ id: "f2", date: "2026-11-22", point: "Front", by: "Motech", work: "Polished out.", was: { s: "mon", d: "2026-11-10", n: "Small chip" }, createdAt: "" }]),
      ctx,
      canWrite: true,
    });
    expect(monHist).toContain("Was Monitor (10 Nov 2026): Small chip");
    expect(html(PhotosTab, { groups: photoGroups([], visits) })).toContain("Resale evaluation · 23 Mar 2026");
    expect(html(PhotosTab, { groups: [] })).toContain("No photos yet.");
    const man = html(ManualTab, {
      name: v.name,
      card: cardStatus(v, F.notify, TUE),
      where: whereList(v),
      watch,
      stages: manualStages(F.checklist, v, TUE, visits),
      edit: { vehicle: { ...vehicleFormOf(v, x), id: v.id, reg: "", fuel: "", seats: "", lastServiceProvider: "", lastB2BProvider: "" }, statuses: VSTATUS, today: TUE },
      canWrite: true,
    });
    expect(man).toContain("the PDFs come in a later update");
    expect(man).toContain("Where things are on this vehicle");
    expect(man).toContain("How to inspect " + v.name);
    expect(man).toContain("Why it matters");
  });
});
