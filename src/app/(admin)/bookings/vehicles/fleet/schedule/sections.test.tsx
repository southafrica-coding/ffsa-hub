import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { seedFleetData } from "@/lib/fleet/testing/seed";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/" }));

import { boards, kmRows, notifyState, scheduleForm, tripRows, workshopRows } from "./model";
import { BoardView, CoordinatorPanel, DatedList, KmPanel } from "./sections";
import { ScheduleSettings } from "./schedule-client";

const TUE = "2026-11-17";
const F = seedFleetData(TUE);
const list = F.schedule!.weeklyOnly!;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const html = (el: (p: any) => React.ReactElement, props: Record<string, unknown>) => renderToStaticMarkup(createElement(el, props));
const coordinator = { userId: "u1", name: "Jack Smith", phone: "082 123 4567", email: "jack@example.org", slackUserId: null };

describe("Schedule renders", () => {
  it("this week: day columns, Start for the co-ordinator, the weekly-only switch", () => {
    const out = html(BoardView, { b: boards(F)[0], canWrite: true, today: TUE, weeklyOnlyList: list });
    expect(out).toContain("This week");
    expect(out).toContain("Tue, 17 Nov");
    expect(out).toContain("Hyundai H1 #1");
    expect(out).toContain("Due today");
    expect(out).toContain("Start weekly check");
    expect(out).toContain("/fleet/h1-1/inspect?type=weekly");
    expect(out).toContain("Weekly checks only this week (the monthly check moves to the next week)");
    // Phone first: one column, side by side only from sm up.
    expect(out).toContain("grid-cols-1");
  });

  it("viewers see the week but no Start button or switch", () => {
    const out = html(BoardView, { b: boards(F)[0], canWrite: false, today: TUE, weeklyOnlyList: list });
    expect(out).toContain("Due today");
    expect(out).not.toContain("Start weekly check");
    expect(out).not.toContain('type="checkbox"');
    expect(out).toContain("Weekly checks only this week.");
  });

  it("services and inspections by km with Log km for the co-ordinator only", () => {
    const rows = kmRows(F);
    const out = html(KmPanel, { rows, canWrite: true, today: TUE });
    expect(out).toContain("Services and inspections by km");
    expect(out).toContain("Log km");
    expect(out).toContain("log a new reading");
    expect(out).toContain("Edit details");
    const view = html(KmPanel, { rows, canWrite: false, today: TUE });
    expect(view).not.toContain("Log km");
    expect(view).not.toContain("Edit details");
  });

  it("workshop bookings and trips", () => {
    expect(html(DatedList, { title: "Workshop bookings", rows: workshopRows(F), empty: "No workshop visits booked." })).toContain("Motech");
    expect(html(DatedList, { title: "Trips and rentals", rows: tripRows(F), empty: "None booked." })).toContain("Thu, 19 Nov – Sun, 13 Dec");
    expect(html(DatedList, { title: "Trips and rentals", rows: [], empty: "None booked." })).toContain("None booked.");
  });

  it("the co-ordinator comes from the role; reminder switches only for managers", () => {
    const out = html(CoordinatorPanel, { coordinator, notify: notifyState(F), canWrite: true });
    expect(out).toContain("Jack Smith");
    expect(out).toContain("tel:0821234567");
    expect(out).toContain("printed on every in-car guide");
    expect(out).toContain("Save reminder settings");
    expect(out).toContain("No Slack account on their Hub profile");
    const none = html(CoordinatorPanel, { coordinator: null, notify: notifyState(F), canWrite: false });
    expect(none).toContain("No one has the Vehicle Coordinator role yet: ask an admin to give it to someone in Users &amp; Roles.");
    expect(none).not.toContain("Save reminder settings");
    expect(none).toContain("Reminders: by email and on Slack");
  });

  it("schedule settings: days, most per day, budget and each vehicle's day", () => {
    const { saved, ...initial } = scheduleForm(F);
    const out = html(ScheduleSettings, {
      initial,
      stored: initial.assign,
      saved,
      vehicles: F.vehicles.map((v) => ({ id: v.id, name: v.name, reg: v.reg || null })),
    });
    expect(out).toContain("Most vehicles per day");
    expect(out).toContain("Time budget per week");
    expect(out).toContain("Inspection day for Hyundai H1 #1");
    expect(out).toContain("Tuesday: 2 of 2");
    expect(out).toContain("Save schedule");
    expect(out).not.toContain('role="alert"');
  });
});
