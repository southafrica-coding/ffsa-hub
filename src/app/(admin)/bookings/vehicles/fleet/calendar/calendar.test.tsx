import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { seedFleetData, withVehicle } from "@/lib/fleet/testing/seed";
import type { FleetData, Trip, WorkshopVisit } from "@/lib/fleet/rules";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/" }));

import { buildVisitCtx, lastProvider } from "../[vehicleId]/visit-ctx";
import type { BookCtx } from "./calendar-client";
import { calMoveHref, calStartOf, calendarGrid, clashItems, dueItems, gapChoices, listItems, missingServiceText, noneDueText } from "./model";
import { BookSection, ClashSection, Legend, ListSection, Timeline } from "./sections";

const TUE = "2026-11-17";
const MON = "2026-11-16";
const seed = () => seedFleetData(TUE);
const withVisit = (F: FleetData, r: WorkshopVisit): FleetData => ({ ...F, visits: [...F.visits, r] });
const withTrip = (F: FleetData, t: Trip): FleetData => ({ ...F, trips: [...F.trips, t] });

// SPEC 10 test 6: a Service visit booked 25–26 Nov on the Almera, which is on rental.
const almeraService: WorkshopVisit = { id: "r-alm", vehicleId: "almera", status: "booked", kind: "Service", date: "2026-11-25", until: "2026-11-26", provider: "Motech" };
// SPEC 10 test 7: a Kombi booking 19–21 Nov over its 19 Nov workshop visit (a Hub booking).
const kombiTrip: Trip = { id: "b-1:kombi", vehicleId: "kombi", from: "2026-11-19", to: "2026-11-21", label: "HULC", source: "hub" };

const ctxsOf = (F: FleetData): Record<string, BookCtx> =>
  Object.fromEntries(
    F.vehicles.map((v) => [v.id, { ctx: buildVisitCtx(F, F.providers as Record<string, unknown>[], v.id), provider: lastProvider(F, v.id, F.providers as Record<string, unknown>[]) }])
  );
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const html = (el: (p: any) => React.ReactElement, props: Record<string, unknown>) => renderToStaticMarkup(createElement(el, props));

describe("calStartOf / calMoveHref", () => {
  it("defaults to this week's Monday and snaps ?start= to its Monday", () => {
    expect(calStartOf(undefined, TUE)).toBe(MON);
    expect(calStartOf("2026-11-26", TUE)).toBe("2026-11-23");
    expect(calStartOf(["2026-12-01"], TUE)).toBe("2026-11-30");
  });
  it("ignores a ?start= that isn't a date", () => {
    expect(calStartOf("tomorrow", TUE)).toBe(MON);
    expect(calStartOf("2026-02-31", TUE)).toBe(MON);
  });
  it("Week back / This week / Week forward", () => {
    expect(calMoveHref("/c", MON, -7)).toBe("/c?start=2026-11-09");
    expect(calMoveHref("/c", MON, 0)).toBe("/c");
    expect(calMoveHref("/c", MON, 7)).toBe("/c?start=2026-11-23");
  });
});

describe("calendarGrid", () => {
  const g = calendarGrid(seed(), MON);
  const row = (id: string) => g.rows.find((r) => r.id === id)!;
  const cell = (id: string, d: string) => row(id).cells.find((c) => c.date === d)!;

  it("four weeks from Monday, weekends shaded, today highlighted", () => {
    expect(g.days).toHaveLength(28);
    expect(g.end).toBe("2026-12-13");
    expect(g.label).toBe("16 Nov 2026 – 13 Dec 2026");
    expect(g.days[0]).toMatchObject({ dow: "Mo", num: 16, weekend: false, today: false });
    expect(g.days[1].today).toBe(true);
    expect(g.days.filter((d) => d.weekend)).toHaveLength(8);
  });

  it("one row per vehicle in use", () => {
    expect(g.rows.map((r) => r.id)).toEqual(seed().vehicles.map((v) => v.id));
    const F = withVehicle(seed(), "kombi", { status: "For sale" });
    expect(calendarGrid(F, MON).rows.map((r) => r.id)).not.toContain("kombi");
  });

  it("CR-V: workshop visit on Wed 18 Nov, then the rental to the end", () => {
    expect(cell("crv", "2026-11-18")).toMatchObject({ mark: { c: "ws", s: true, e: true }, tip: "Bumper-to-bumper inspection at Motech: Wed, 18 Nov" });
    expect(cell("crv", "2026-11-19")).toMatchObject({ mark: { c: "trip", s: true, e: false }, tip: "Rental: Thu, 19 Nov – Sun, 13 Dec" });
    expect(cell("crv", "2026-11-25").mark).toEqual({ c: "trip", s: false, e: false });
    expect(cell("crv", "2026-12-13").mark).toEqual({ c: "trip", s: false, e: true });
  });

  it("inspection days show as a ring with the check's state", () => {
    const c = cell("h1-1", TUE);
    expect(c.check).toBe("plan");
    expect(c.tip).toContain("Due today");
    // Nothing for past weeks.
    const past = calendarGrid(seed(), "2026-11-02");
    expect(past.rows.flatMap((r) => r.cells).filter((x) => x.date < MON && x.check)).toHaveLength(0);
  });

  it("SPEC 10 test 6 on the timeline: the Almera's Service visit is a clash", () => {
    const F = withVisit(seed(), almeraService);
    const c = calendarGrid(F, MON).rows.find((r) => r.id === "almera")!.cells.find((x) => x.date === "2026-11-25")!;
    expect(c.mark).toEqual({ c: "clash", s: true, e: false });
    expect(c.tip).toBe("Clash: Service and Rental");
  });
});

describe("clashes and heads-ups", () => {
  it("SPEC 10 test 2: the CR-V heads-up", () => {
    const items = clashItems(seed());
    const crv = items.find((c) => c.vehicleId === "crv")!;
    expect(crv.sev).toBe("warn");
    expect(`${crv.vehicleName} · ${crv.text}`).toBe(
      "Honda CR-V · Rental starts Thu, 19 Nov, the day after the bumper-to-bumper inspection (Wed, 18 Nov): make sure it’s back and checked in time"
    );
    expect(crv.note).toBe("");
    expect(crv.moves).toEqual([]);
    expect(crv.wsMove).toBeNull();
  });

  it("SPEC 10 test 6: clash, no similar car, move the workshop visit to Mon 14 – Tue 15 Dec", () => {
    const items = clashItems(withVisit(seed(), almeraService));
    expect(items[0].sev).toBe("crit"); // worst first
    const c = items.find((x) => x.vehicleId === "almera" && x.sev === "crit")!;
    expect(c.note).toBe("No similar car is free for those dates. Move the workshop visit, or tell the renter they can wait until it’s back or make other plans.");
    expect(c.moves).toEqual([]);
    expect(c.wsMove).toMatchObject({ from: "2026-12-14", to: "2026-12-15", visit: { id: "r-alm" } });
  });

  it("SPEC 10 test 7: Kombi clash, free vans H1 #1 and H1 #2; moving it to H1 #1 clears it", () => {
    const F = withTrip(seed(), kombiTrip);
    const c = clashItems(F).find((x) => x.vehicleId === "kombi" && x.sev === "crit")!;
    expect(c.note).toBe("Free vans for those dates: Hyundai H1 #1 (9 seats), Hyundai H1 #2 (9 seats).");
    expect(c.moves.map((m) => m.to.id)).toEqual(["h1-1", "h1-2"]);
    expect(c.moves[0].trip).toEqual({ id: "b-1:kombi", label: "HULC", from: "2026-11-19", to: "2026-11-21" });
    expect(c.wsMove?.visit.id).toBe("r-bk-kombi");
    const moved = { ...F, trips: F.trips.map((t) => (t.id === kombiTrip.id ? { ...t, vehicleId: "h1-1" } : t)) };
    expect(clashItems(moved).filter((x) => x.sev === "crit")).toEqual([]);
  });

  it("only Hub bookings get Move … to …", () => {
    const F = withTrip(seed(), { ...kombiTrip, source: "manual" });
    expect(clashItems(F).find((x) => x.vehicleId === "kombi" && x.sev === "crit")!.moves).toEqual([]);
  });
});

describe("book a workshop visit", () => {
  // SPEC 10 tests 3 and 4.
  const F = withVehicle(withVehicle(seed(), "h1-2", { lastService: { km: 215000 } }), "almera", { lastService: { km: 121000 } });

  it("vehicles due by km with the first free 48 hours and what to book", () => {
    const due = dueItems(F);
    const alm = due.find((x) => x.id === "almera")!;
    expect(alm).toMatchObject({ sev: "crit", text: "Service and bumper-to-bumper inspection overdue by 153 km (was due at 131\u00a0000 km)", kind: "Service" });
    expect(alm.when).toBe("First free 48 hours: Mon, 14 Dec – Tue, 15 Dec");
    expect(alm.gap).toEqual({ from: "2026-12-14", to: "2026-12-15" });
    const h12 = due.find((x) => x.id === "h1-2")!;
    expect(h12).toMatchObject({ sev: "warn", text: "Service and bumper-to-bumper inspection due in 80 km (at 225\u00a0000 km)", kind: "Service" });
    expect(h12.when).toBe("First free 48 hours: Wed, 18 Nov – Thu, 19 Nov");
  });

  it("no service km on record", () => {
    expect(missingServiceText(F)).toBe(
      "No service km on record yet for Hyundai H1 #1, Hyundai H1 #3, VW Kombi, Honda CR-V, so their next service can’t be worked out."
    );
    expect(noneDueText()).toBe("No service or bumper-to-bumper inspection is due within 500 km.");
  });

  it("every vehicle in use has a first free 48 hours for the picker", () => {
    const g = gapChoices(seed());
    expect(g.map((x) => x.id)).toEqual(seed().vehicles.map((v) => v.id));
    expect(g.find((x) => x.id === "crv")!.gap).toEqual({ from: "2026-12-14", to: "2026-12-15" });
  });
});

describe("list view", () => {
  it("trips and workshop visits in the four weeks, by start date", () => {
    const items = listItems(seed(), MON);
    expect(items.map((x) => x.date)).toEqual([...items.map((x) => x.date)].sort());
    expect(items[0]).toMatchObject({ vehicleId: "crv", dot: "warn", text: "Bumper-to-bumper inspection at Motech · Wed, 18 Nov" });
    expect(items.filter((x) => x.dot === "info").map((x) => x.text)).toEqual(["Rental · Thu, 19 Nov – Sun, 13 Dec", "Rental · Thu, 19 Nov – Sun, 13 Dec"]);
    // As the app: anything not over by today that starts by the last day shown.
    expect(listItems(seed(), "2026-10-05")).toEqual([]);
  });
});

describe("Calendar renders", () => {
  it("the timeline scrolls inside its own box with the names held on the left", () => {
    const out = html(Timeline, { grid: calendarGrid(seed(), MON) });
    expect(out).toContain("overflow-x-auto");
    expect(out).toContain("sticky left-0");
    expect(out).toContain('title="Rental: Thu, 19 Nov – Sun, 13 Dec"');
    expect(out).toContain("Honda CR-V");
    expect(html(Legend, {})).toContain("Inspection day");
  });

  it("clashes with Move buttons for a manager", () => {
    const F = withTrip(withVisit(seed(), almeraService), kombiTrip);
    const out = html(ClashSection, { items: clashItems(F), ctxs: ctxsOf(F), canWrite: true });
    expect(out).toContain("Move HULC to Hyundai H1 #1");
    expect(out).toContain("Move HULC to Hyundai H1 #2");
    expect(out).toContain("Move the workshop visit to Mon, 14 Dec – Tue, 15 Dec");
    expect(out).toContain("A heads-up is a trip that starts within 7 days after a workshop visit.");
  });

  it("no buttons without manage access", () => {
    const F = withTrip(withVisit(seed(), almeraService), kombiTrip);
    const out = html(ClashSection, { items: clashItems(F), ctxs: {}, canWrite: false });
    expect(out).not.toContain("<button");
    expect(out).toContain("Free vans for those dates");
    const F2 = withVehicle(seed(), "h1-2", { lastService: { km: 215000 } });
    const book = html(BookSection, { due: dueItems(F2), noneDue: noneDueText(), missing: "", choices: gapChoices(F2), ctxs: {}, canWrite: false });
    expect(book).not.toContain("<button");
    expect(book).toContain("Find a free 48 hours for");
  });

  it("book section with Book buttons, and the empty states", () => {
    const F = withVehicle(seed(), "h1-2", { lastService: { km: 215000 } });
    const out = html(BookSection, { due: dueItems(F), noneDue: noneDueText(), missing: missingServiceText(F), choices: gapChoices(F), ctxs: ctxsOf(F), canWrite: true });
    expect(out).toMatch(/>Book<\/button>/);
    expect(out).toContain("No service km on record yet for");
    expect(html(ClashSection, { items: [], ctxs: {}, canWrite: true })).toContain("No clashes. Every workshop visit fits around the trips and rentals.");
    expect(html(ListSection, { items: [] })).toContain("Nothing booked in these four weeks.");
  });
});
