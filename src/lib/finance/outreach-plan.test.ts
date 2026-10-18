import { describe, expect, it } from "vitest";
import { mondayOf, plannerDays, plannerWeeks, pot, spreadEvenly } from "./outreach-plan";

const TRIP = { tripStart: "2026-10-28", tripEnd: "2026-11-03" }; // Wed → Tue

describe("plannerDays", () => {
  it("one row per trip day, with that day's plan, note and spending", () => {
    const days = plannerDays({
      ...TRIP,
      plans: [{ plan_date: "2026-10-29", amount_zar: "1200.00", note: "market day" }],
      spends: [
        { expense_date: "2026-10-29", zar_amount: 300 },
        { expense_date: "2026-10-29", zar_amount: "50.5" },
      ],
    });
    expect(days).toHaveLength(7);
    expect(days[1]).toEqual({ date: "2026-10-29", planned: 1200, note: "market day", spent: 350.5 });
    expect(days[0]).toEqual({ date: "2026-10-28", planned: 0, note: "", spent: 0 });
  });

  it("stretches to cover a receipt before the trip", () => {
    const days = plannerDays({ ...TRIP, plans: [], spends: [{ expense_date: "2026-10-26", zar_amount: 10 }] });
    expect(days[0].date).toBe("2026-10-26");
  });

  it("groups Monday–Sunday weeks", () => {
    const weeks = plannerWeeks(plannerDays({ ...TRIP, plans: [], spends: [] }));
    expect(weeks.map((w) => [w.start, w.days.length])).toEqual([
      ["2026-10-26", 5],
      ["2026-11-02", 2],
    ]);
  });
});

describe("pot", () => {
  const days = (plans: [string, number][], spends: [string, number][]) =>
    plannerDays({
      ...TRIP,
      plans: plans.map(([plan_date, amount_zar]) => ({ plan_date, amount_zar })),
      spends: spends.map(([expense_date, zar_amount]) => ({ expense_date, zar_amount })),
    });

  it("before the trip: still to plan = budget − everything planned", () => {
    const p = pot({ budget: 10000, today: "2026-10-20", days: days([["2026-10-28", 900], ["2026-10-29", 1200]], []) });
    expect(p).toMatchObject({ available: 10000, committed: 2100, stillToPlan: 7900 });
  });

  it("a day that goes as planned doesn't change what's still to plan", () => {
    const p = pot({
      budget: 10000,
      today: "2026-10-29",
      days: days([["2026-10-28", 900], ["2026-10-29", 1200]], [["2026-10-28", 900]]),
    });
    expect(p).toMatchObject({ available: 9100, committed: 1200, stillToPlan: 7900 });
  });

  it("overspending takes real money away; today's unspent plan stays committed", () => {
    const p = pot({
      budget: 10000,
      today: "2026-10-29",
      days: days([["2026-10-28", 900], ["2026-10-29", 1200]], [["2026-10-28", 1500], ["2026-10-29", 200]]),
    });
    expect(p).toMatchObject({ spent: 1700, available: 8300, committed: 1000, stillToPlan: 7300 });
  });

  it("goes negative when more is planned than the money available", () => {
    expect(pot({ budget: 1000, today: "2026-10-20", days: days([["2026-10-28", 1500]], []) }).stillToPlan).toBe(-500);
  });
});

describe("spreadEvenly", () => {
  it("whole R10s, earlier days get the extra", () => {
    const m = spreadEvenly(7900, ["a", "b", "c"]);
    expect([...m.values()]).toEqual([2640, 2630, 2630]);
    expect([...m.values()].reduce((x, y) => x + y, 0)).toBe(7900);
  });
  it("leaves less than R10 unplanned", () => {
    expect([...spreadEvenly(1005, ["a", "b"]).values()]).toEqual([500, 500]);
  });
  it("nothing to spread → nothing", () => {
    expect(spreadEvenly(0, ["a"]).size).toBe(0);
    expect(spreadEvenly(100, []).size).toBe(0);
  });
});

describe("mondayOf", () => {
  it("weeks start on Monday", () => {
    expect(mondayOf("2026-11-01")).toBe("2026-10-26");
  });
});
