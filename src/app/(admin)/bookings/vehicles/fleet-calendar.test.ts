// The booking board's fleet calendar shows 30 days from today (SA), not a calendar month.

import { afterEach, describe, expect, it, vi } from "vitest";
import { calendarWindow } from "./fleet-calendar";

afterEach(() => vi.useRealTimers());
const at = (isoUtc: string) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(isoUtc));
};

describe("calendarWindow", () => {
  it("starts today and runs 30 days into the next month", () => {
    at("2026-11-19T10:00:00Z");
    const w = calendarWindow();
    expect(w).toMatchObject({ from: "2026-11-19", to: "2026-12-18", prev: "2026-10-20", next: "2026-12-19", isToday: true });
  });

  it("uses South African today, not UTC, just before midnight UTC", () => {
    at("2026-11-19T22:30:00Z"); // 00:30 on the 20th in SA
    expect(calendarWindow().from).toBe("2026-11-20");
  });

  it("back and forward move 30 days", () => {
    at("2026-11-19T10:00:00Z");
    const w = calendarWindow("2026-12-19");
    expect(w).toMatchObject({ from: "2026-12-19", to: "2027-01-17", isToday: false });
  });

  it("old ?month= links still open: this month from today, another on the 1st", () => {
    at("2026-11-19T10:00:00Z");
    expect(calendarWindow("2026-11").from).toBe("2026-11-19");
    expect(calendarWindow("2027-01").from).toBe("2027-01-01");
  });

  it("ignores a malformed date", () => {
    at("2026-11-19T10:00:00Z");
    expect(calendarWindow("nonsense").from).toBe("2026-11-19");
  });
});

// Fleet part 5b: with Fleet's overlay the board calendar draws a workshop lane and
// inspection days under each vehicle, and a red border on clashes. Without it, nothing changes.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FleetCalendar } from "./fleet-calendar";

describe("FleetCalendar with Fleet's lane", () => {
  const vehicles = [{ id: "v1", name: "VW Kombi", registration_plate: "KLK 556 NW", seats: 8, vehicle_type: "van", status: "active" }] as never[];
  const bookings = [
    { id: "b1", booking_name: "HULC", status: "approved", checkout_date: "2026-11-25", return_date: "2026-11-27", point_person: null, assignments: [{ vehicle: { id: "v1" } }] },
  ] as never[];
  const overlay = {
    lanes: { v1: { visits: [{ id: "w1", from: "2026-11-26", to: "2026-11-27", label: "Service · Motech", tip: "Service at Motech: 26–27 Nov", clash: true }], checks: [{ date: "2026-11-23", st: "plan" as const, tip: "Weekly check: Mon" }] } },
    clashBookingIds: ["b1"],
  };
  const render = (o: typeof overlay | null) => {
    at("2026-11-19T10:00:00Z");
    return renderToStaticMarkup(createElement(FleetCalendar, { vehicles, bookings, overlay: o }));
  };

  it("draws the visit, the inspection day, the clash and the extra legend", () => {
    const out = render(overlay);
    expect(out).toContain("CLASH · SERVICE · MOTECH");
    expect(out).toContain("Weekly check: Mon");
    expect(out).toContain("CLASH · </span>");
    for (const l of ["AT THE WORKSHOP", "CLASH", "INSPECTION DAY", "CHECKED", "CHECK OVERDUE"]) expect(out).toContain(l);
  });

  it("is the board as before for someone without Fleet", () => {
    const out = render(null);
    expect(out).not.toContain("AT THE WORKSHOP");
    expect(out).not.toContain("CLASH");
    expect(out).toContain("HULC");
  });
});

describe("FleetCalendar: a vehicle out of action (Fleet 5c)", () => {
  const vehicles = [{ id: "v1", name: "VW Kombi", registration_plate: "KLK 556 NW", seats: 8, vehicle_type: "van", status: "maintenance" }] as never[];
  const bookings = [
    { id: "b1", booking_name: "HULC", status: "approved", checkout_date: "2026-11-18", return_date: "2026-11-21", point_person: null, assignments: [{ vehicle: { id: "v1" } }] },
  ] as never[];
  const lane = { visits: [], checks: [], out: { since: "2026-11-19", label: "BROKEN DOWN" } };

  it("Fleet users see its bookings, with the out-of-action bar in the lane", () => {
    at("2026-11-19T10:00:00Z");
    const out = renderToStaticMarkup(createElement(FleetCalendar, { vehicles, bookings, overlay: { lanes: { v1: lane }, clashBookingIds: [] } }));
    expect(out).toContain("HULC");
    expect(out).toContain("BROKEN DOWN · UNTIL IT’S BACK");
    expect(out).not.toContain("OFF THE ROAD · MAINTENANCE");
  });

  it("everyone else still sees the row blacked out", () => {
    at("2026-11-19T10:00:00Z");
    const out = renderToStaticMarkup(createElement(FleetCalendar, { vehicles, bookings }));
    expect(out).toContain("OFF THE ROAD · MAINTENANCE");
  });
});
