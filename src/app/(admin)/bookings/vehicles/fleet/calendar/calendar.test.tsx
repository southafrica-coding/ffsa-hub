import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { seedFleetData, withVehicle } from "@/lib/fleet/testing/seed";
import type { FleetData, Trip, WorkshopVisit } from "@/lib/fleet/rules";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/" }));

import { buildVisitCtx, lastProvider } from "../[vehicleId]/visit-ctx";
import type { BookCtx } from "./calendar-client";
import { clashItems, dueItems, gapChoices, missingServiceText, noneDueText } from "./model";
import { BookSection, ClashSection } from "./sections";

const TUE = "2026-11-17";
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

describe("Fleet's sections on the board render", () => {
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
  });
});

// ── Fleet part 5b: the booking board's Fleet lane, and "Let them know" ─────────

import { boardOverlay } from "./model";

describe("boardOverlay (Fleet on the booking board)", () => {
  it("draws each workshop visit in the window, flagged when a booking overlaps it", () => {
    const F = withTrip(seed(), kombiTrip);
    const o = boardOverlay(F, TUE, 30);
    const kombi = o.lanes.kombi.visits;
    expect(kombi.length).toBeGreaterThan(0);
    const v19 = kombi.find((v) => v.from <= "2026-11-19" && "2026-11-19" <= v.to)!;
    expect(v19.clash).toBe(true);
    expect(v19.label).toMatch(/·/);
    expect(o.clashBookingIds).toContain("b-1");
  });

  it("leaves out visits outside the window, and vehicles with nothing to show", () => {
    const o = boardOverlay(seed(), "2027-06-01", 30);
    for (const lane of Object.values(o.lanes)) for (const v of lane.visits) expect(v.to >= "2027-06-01").toBe(true);
  });

  it("marks inspection days from this week on, never on a day the vehicle is out", () => {
    const F = seed();
    const o = boardOverlay(F, TUE, 30);
    const checks = Object.entries(o.lanes).flatMap(([vid, l]) => l.checks.map((c) => ({ vid, ...c })));
    expect(checks.length).toBeGreaterThan(0);
    for (const c of checks) {
      expect(["plan", "done", "late"]).toContain(c.st);
      expect(F.trips.some((t) => t.vehicleId === c.vid && t.from <= c.date && c.date <= t.to)).toBe(false);
    }
  });

  it("a heads-up (booking just after a visit) isn't a clash on the board", () => {
    const F = withTrip(seed(), { id: "b-2:kombi", vehicleId: "kombi", from: "2026-11-23", to: "2026-11-24", label: "Camp", source: "hub" });
    expect(boardOverlay(F, TUE, 30).clashBookingIds).not.toContain("b-2");
  });
});

describe("Let them know", () => {
  it("a Hub booking over a workshop visit offers the notice, with the text it would send", () => {
    const F = withTrip(seed(), kombiTrip);
    const c = clashItems(F).find((x) => x.notify?.bookingId === "b-1")!;
    expect(c.notify!.visitId).toBeTruthy();
    expect(c.notify!.text).toMatch(/is booked in for a .+ during HULC/);
    const out = html(ClashSection, { items: [c], ctxs: ctxsOf(F), canWrite: true });
    expect(out).toContain("Let them know");
  });

  it("isn't offered to someone who can only view Fleet", () => {
    const F = withTrip(seed(), kombiTrip);
    const c = clashItems(F).find((x) => x.notify?.bookingId === "b-1")!;
    expect(html(ClashSection, { items: [c], ctxs: {}, canWrite: false })).not.toContain("Let them know");
  });

  it("isn't offered for a trip from the old app (not a Hub booking)", () => {
    const F = withTrip(seed(), { ...kombiTrip, id: "t-old", source: "app" });
    expect(clashItems(F).some((x) => x.notify?.bookingId === "t-old")).toBe(false);
  });
});
