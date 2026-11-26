import { describe, expect, it } from "vitest";
import { seedFleetData, withVehicle } from "@/lib/fleet/testing/seed";
import type { FleetData } from "@/lib/fleet/rules";
import {
  andList,
  board,
  boards,
  budgetLine,
  changedDays,
  dayLoads,
  kmRows,
  monthlyIn,
  notifyState,
  otherWeeklyOnly,
  scheduleError,
  scheduleForm,
  scheduleSub,
  setWeeklyOnlyList,
  settingsBody,
  slotCard,
  tripRows,
  workshopRows,
} from "./model";

const TUE = "2026-11-17";
const card = (F: FleetData, id: string, ws: string) => slotCard(F, F.vehicles.find((v) => v.id === id)!, ws);

describe("this week and next week", () => {
  it("SPEC 10 test 1: in the week of 16 Nov the H1s are Tuesday weekly checks, due today", () => {
    const F = seedFleetData(TUE);
    const [thisWeek, next] = boards(F);
    expect(thisWeek.title).toBe("This week");
    expect(thisWeek.ws).toBe("2026-11-16");
    expect(next.ws).toBe("2026-11-23");
    expect(thisWeek.weeklyOnly).toBe(true);
    const tue = thisWeek.cols.find((c) => c.d === 2)!;
    expect(tue.today).toBe(true);
    expect(tue.cards.map((c) => c.id)).toEqual(["h1-1", "h1-2"]);
    for (const c of tue.cards) {
      expect(c.monthly).toBe(false);
      expect(c.st).toBe("today");
      expect(c.pill).toBe("Due today");
      expect(c.start).toEqual({ type: "weekly", label: "Start weekly check" });
    }
    expect(thisWeek.cols.map((c) => c.d)).toEqual([2, 3, 4]);
  });

  it("tomorrow's vehicles are planned and can be started early; next week's can't", () => {
    const F = seedFleetData(TUE);
    const kombi = card(F, "kombi", "2026-11-16");
    expect(kombi.st).toBe("planned");
    expect(kombi.pill).toBe("Planned");
    expect(kombi.start?.label).toBe("Start weekly check");
    const nextWeek = card(F, "kombi", "2026-11-23");
    expect(nextWeek.st).toBe("planned");
    expect(nextWeek.start).toBeNull();
  });

  it("a vehicle away on its day shows as away", () => {
    const F = seedFleetData(TUE);
    const almera = card(F, "almera", "2026-11-16");
    expect(almera.st).toBe("away");
    expect(almera.pill).toMatch(/^Away until .*13 Dec \(Rental\)$/);
    expect(almera.start).toBeNull();
  });

  it("this week's planned card notes when the vehicle is at the workshop now", () => {
    const F = withVehicle(seedFleetData(TUE), "kombi", { status: "In workshop" });
    expect(card(F, "kombi", "2026-11-16").pill).toBe("Planned (now at the workshop)");
  });

  it("SPEC 10 test 13: on Tue 1 Dec the routine checks are monthly again", () => {
    const F = seedFleetData("2026-12-01");
    const b = board(F, "This week", "2026-11-30");
    expect(b.weeklyOnly).toBe(false);
    const tue = b.cols.find((c) => c.d === 2)!;
    for (const c of tue.cards) {
      expect(c.monthly).toBe(true);
      expect(c.start).toEqual({ type: "monthly", label: "Start monthly check" });
    }
    expect(monthlyIn(F, "2026-11-30").map((v) => v.id)).toEqual(expect.arrayContaining(["h1-1", "h1-2"]));
  });

  it("a done check shows Done", () => {
    const F = withVehicle(seedFleetData(TUE), "h1-1", { lastCheck: { id: "i1", date: TUE, type: "weekly" } });
    const c = card(F, "h1-1", "2026-11-16");
    expect(c.st).toBe("done");
    expect(c.tone).toBe("good");
    expect(c.start).toBeNull();
  });
});

describe("weekly-only weeks", () => {

  it("adds and removes Mondays, dropping weeks more than 8 weeks back", () => {
    expect(setWeeklyOnlyList(["2026-11-16", "2026-11-23"], "2026-11-23", false, TUE)).toEqual(["2026-11-16"]);
    expect(setWeeklyOnlyList(["2026-11-23"], "2026-11-16", true, TUE)).toEqual(["2026-11-16", "2026-11-23"]);
    expect(setWeeklyOnlyList(["2026-01-05", "2026-11-16"], "2026-12-07", true, TUE)).toEqual(["2026-11-16", "2026-12-07"]);
  });

  it("lists weekly-only weeks beyond next week", () => {
    const F = seedFleetData(TUE);
    expect(otherWeeklyOnly(F)).toEqual([]);
    const G = { ...F, schedule: { ...F.schedule!, weeklyOnly: ["2026-11-16", "2026-11-23", "2026-12-07"] } };
    expect(otherWeeklyOnly(G).map((w) => w.ws)).toEqual(["2026-12-07"]);
  });
});

describe("services and inspections by km", () => {
  const rows = kmRows(seedFleetData(TUE));
  const row = (id: string) => rows.find((r) => r.id === id)!;
  it("shows next inspection/service, km to go, odometer and its age", () => {
    expect(rows).toHaveLength(6);
    const crv = row("crv");
    expect(crv.odo).toMatch(/^Odometer 312.606 km on 16 Oct 2026 \(\d+ days ago: log a new reading\)$/);
    const almera = row("almera");
    expect(almera.text.length).toBeGreaterThan(0);
  });
  it("leaves out vehicles for sale or off the road", () => {
    const F = withVehicle(seedFleetData(TUE), "almera", { status: "For sale" });
    expect(kmRows(F).map((r) => r.id)).not.toContain("almera");
  });
  it("SPEC 10 test 3: H1 #2 combined visit, 80 km to go, with a projection when km a day is known", () => {
    const F = withVehicle(seedFleetData(TUE), "h1-2", {
      lastService: { km: 215000 },
      odometer: 224920,
      odometerDate: "2026-11-10",
      odoPrev: { km: 224500, date: "2026-11-03" },
    });
    const r = kmRows(F).find((x) => x.id === "h1-2")!;
    expect(r.text).toBe("Service and bumper-to-bumper at 225 000 km, 80 km to go");
    expect(r.sev).toBe("warn");
    expect(r.proj).toBe("At about 60 km a day it may already be past 225\u00a0000 km: log a km reading.");
  });
});

describe("workshop bookings and trips", () => {
  it("lists booked visits that haven't ended and upcoming rentals", () => {
    const F = seedFleetData(TUE);
    const ws = workshopRows(F);
    expect(ws.map((w) => w.vehicleId).sort()).toEqual(["crv", "h1-1", "h1-3", "kombi"]);
    expect(ws.map((w) => w.when)).toEqual(["Wed, 18 Nov", "Thu, 19 Nov", "Thu, 19 Nov", "Mon, 23 Nov"]);
    expect(ws[0]).toMatchObject({ vehicleId: "crv", text: "Workshop inspection (bumper to bumper), Motech" });
    expect(ws[0].when).toBe("Wed, 18 Nov");
    const trips = tripRows(F);
    expect(trips.map((t) => t.vehicleId).sort()).toEqual(["almera", "crv"]);
    expect(trips[0].text).toBe("Rental");
    expect(trips[0].when).toBe("Thu, 19 Nov – Sun, 13 Dec");
    expect(trips[0].sev).toBe("warn");
  });
});

describe("inspection days settings", () => {
  const F = seedFleetData(TUE);
  const { saved, ...f } = scheduleForm(F);
  it("reads the saved schedule", () => {
    expect(saved).toBe(true);
    expect(f.days).toEqual([2, 3, 4]);
    expect(f.max).toBe(2);
    expect(f.budgetHours).toBe(5);
    expect(f.assign["h1-1"]).toBe(2);
    expect(dayLoads(f)).toEqual({ 2: 2, 3: 2, 4: 2 });
    expect(scheduleError(f)).toBeNull();
    expect(settingsBody(f)).toEqual({ days: [2, 3, 4], maxPerDay: 2, budgetHours: 5 });
  });
  it("refuses a day with too many vehicles, as the app does", () => {
    expect(scheduleError({ ...f, assign: { ...f.assign, crv: 2 } })).toBe("Tuesday has 3 vehicles; the most per day is 2.");
  });
  it("refuses a vehicle on a day that isn't an inspection day", () => {
    expect(scheduleError({ ...f, assign: { ...f.assign, crv: 5 } })).toBe("Friday isn’t one of the inspection days. Tick it, or move that vehicle to another day.");
    expect(scheduleError({ ...f, days: [] })).toBe("Tick at least one inspection day.");
  });
  it("sends only the check days that changed", () => {
    const out = changedDays(f.assign, { ...f, assign: { ...f.assign, crv: 3, almera: null } });
    expect(out).toHaveLength(2);
    expect(out).toEqual(expect.arrayContaining([{ id: "almera", day: null }, { id: "crv", day: 3 }]));
    expect(changedDays(f.assign, f)).toEqual([]);
  });
  it("time this week against the budget", () => {
    expect(budgetLine(F)).toEqual({ text: "This week so far: 0 min of 5 h.", over: null });
    const G = { ...F, timelog: [{ date: TUE, week: "2026-11-16", kind: "inspection", type: "weekly", mins: 400 }] };
    expect(budgetLine(G).over).toMatch(/^Over the budget/);
  });
});

describe("header and reminders", () => {
  it("the line under the masthead", () => {
    expect(scheduleSub(seedFleetData(TUE))).toBe(
      "Weekly checks on Tuesday, Wednesday and Thursday, at most 2 vehicles a day. The first check each month is the monthly check."
    );
    expect(andList(["A"])).toBe("A");
    expect(andList(["A", "B"])).toBe("A and B");
  });
  it("the reminder switches accept the app's email address or the Hub's on/off", () => {
    expect(notifyState(seedFleetData(TUE))).toEqual({ email: true, slack: true });
    expect(notifyState({ ...seedFleetData(TUE), notify: {} })).toEqual({ email: false, slack: false });
  });
});
