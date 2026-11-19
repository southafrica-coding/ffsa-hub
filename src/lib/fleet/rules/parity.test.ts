// Parity: the TypeScript rules give exactly the same results as the reference app's own
// functions (vehicles-module/app/ffsa-fleet.html), every day for ten weeks, on the seed data
// and on variants that exercise the km, clash, trip and in-car guide rules.

import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { seedFleetData } from "../testing/seed";
import { addDays, clashList, todayTasks, vehicleAlerts, weekly, type FleetData } from "./index";

const require = createRequire(import.meta.url);
const loadAppRules = require("../testing/app-rules.cjs") as (p: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
const app = loadAppRules(path.resolve(__dirname, "../../../../vehicles-module/app/ffsa-fleet.html"));

function toApp(F: FleetData) {
  const S = app.S;
  S.vehicles = F.vehicles.map((v) => JSON.parse(JSON.stringify(v)));
  S.vmap = Object.fromEntries(S.vehicles.map((v: { id: string }) => [v.id, v]));
  S.trips = F.trips;
  S.bookings = F.visits.filter((r) => r.status === "booked");
  S.checklist = F.checklist;
  S.sched = F.schedule;
  S.notify = F.notify;
  S.providers = F.providers || [];
  S.timelog = F.timelog || [];
  app.setToday(F.today);
}

const actionKey = (a: ReturnType<typeof todayTasks>["tasks"][number]["action"]) =>
  !a ? "" : a.kind === "start" ? "start:" + a.type : a.kind === "book" ? `book:${a.visitKind}:${a.from ? a.from + ">" + a.to : ""}` : a.kind;
const appActionKey = (btn: string) =>
  !btn ? "" : btn.startsWith("start:") || btn.startsWith("book:") ? btn : /ws-dropoff/.test(btn) ? "dropoff" : /ws-collect/.test(btn) ? "collect" : /#calendar/.test(btn) ? "calendar" : btn;

function compare(F: FleetData) {
  toApp(F);
  for (const v of F.vehicles) {
    const av = app.S.vmap[v.id];
    expect(vehicleAlerts(F, v), `${F.today} ${v.id} alerts`).toEqual(JSON.parse(JSON.stringify(app.vehicleAlerts(av))));
    const w = weekly(F, v);
    const aw = app.weekly(av);
    expect([w.st, w.label, w.type, w.name], `${F.today} ${v.id} weekly`).toEqual([aw.st, aw.label, aw.type, aw.name]);
  }
  const mine = todayTasks(F);
  const theirs = app.todayTasks();
  expect(
    mine.tasks.map((t) => [t.o, t.sev, t.v.id, t.title, t.sub, t.mins, actionKey(t.action)]),
    `${F.today} today`
  ).toEqual(theirs.tasks.map((t: any) => [t.o, t.sev, t.v.id, t.title, t.sub, t.mins, appActionKey(t.btn)])); // eslint-disable-line @typescript-eslint/no-explicit-any
  expect(mine.later.map((l) => [l.v.id, l.d, l.text])).toEqual(theirs.later.map((l: any) => [l.v.id, l.d, l.text])); // eslint-disable-line @typescript-eslint/no-explicit-any
  expect(clashList(F).map((c) => [c.sev, c.kind, c.vehicleId, c.text])).toEqual(
    app.clashList().map((c: any) => [c.sev, c.kind, c.vehicleId, c.text]) // eslint-disable-line @typescript-eslint/no-explicit-any
  );
}

function variant(today: string): FleetData {
  const F = seedFleetData(today);
  const km: Record<string, object> = {
    "h1-2": { lastService: { km: 215000, date: "2026-03-01" }, serviceMonths: 12 },
    almera: { lastService: { km: 121000 }, licenceExpiry: "2026-12-10" },
    crv: { lastB2B: { km: 308000 }, odoPrev: { km: 311000, date: "2026-09-01" }, cardPrinted: { date: "2026-06-01", sig: "x" } },
    "h1-1": { lastService: { km: 220000 }, lastB2B: { km: 226000 }, condition: { "ext-front": { s: "fix", d: "2026-11-02" }, "tyr-fl": { s: "mon", d: "2026-11-02" } } },
    "h1-3": { status: "In workshop", statusSince: "2026-11-19", lastCheck: { date: "2026-11-11", type: "weekly" } },
    kombi: { status: "For sale" },
  };
  return {
    ...F,
    vehicles: F.vehicles.map((v) => ({ ...v, ...(km[v.id] || {}) })),
    trips: [
      ...F.trips,
      { id: "t-kombi", vehicleId: "kombi", from: "2026-11-19", to: "2026-11-21", label: "HULC" },
      { id: "t-h12", vehicleId: "h1-2", from: "2026-11-25", to: "2026-11-27", label: "Airport" },
      { id: "t-h12b", vehicleId: "h1-2", from: "2026-11-27", to: "2026-11-29", label: "Outreach" },
    ],
    visits: [...F.visits, { id: "r-x", vehicleId: "almera", status: "booked", kind: "Service", date: "2026-11-25", until: "2026-11-26", provider: "Motech" }],
    timelog: [
      { date: "2026-11-10", week: "2026-11-09", kind: "inspection", type: "weekly", mins: 18 },
      { date: "2026-11-11", week: "2026-11-09", kind: "inspection", type: "weekly", mins: 26 },
    ],
  };
}

describe("parity with the FFSA Fleet app", () => {
  const days = Array.from({ length: 70 }, (_, i) => addDays("2026-11-16", i));

  it("matches on the exported data, every day for ten weeks", () => {
    for (const d of days) compare(seedFleetData(d));
  });

  it("matches on variants (km due and overdue, clashes, double bookings, workshop, for sale, flags, guides)", () => {
    for (const d of days) compare(variant(d));
  });
});
