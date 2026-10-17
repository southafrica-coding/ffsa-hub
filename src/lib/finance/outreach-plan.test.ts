import { describe, expect, it } from "vitest";
import { buildPlan, lineDates, mondayOf, periodSummary, splitEvenly, type PlanLine } from "./outreach-plan";

const TRIP = { start: "2026-10-28", end: "2026-11-03" }; // Wed → Tue, 7 days
const line = (over: Partial<PlanLine>): PlanLine => ({ id: "l", description: "x", category_id: "c", total: 0, ...over });

describe("lineDates", () => {
  it("whole trip by default", () => {
    expect(lineDates(line({}), TRIP)).toHaveLength(7);
  });
  it("its own dates, or one day", () => {
    expect(lineDates(line({ plan_kind: "range", plan_start: "2026-10-30", plan_end: "2026-11-01" }), TRIP)).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
    ]);
    expect(lineDates(line({ plan_kind: "day", plan_start: "2026-10-28" }), TRIP)).toEqual(["2026-10-28"]);
  });
  it("can't place a whole-trip line without trip dates", () => {
    expect(lineDates(line({}), { start: null, end: null })).toBeNull();
  });
});

describe("splitEvenly", () => {
  it("adds back up to the cent", () => {
    const parts = splitEvenly(100, 3);
    expect(parts).toEqual([33.34, 33.33, 33.33]);
    expect(parts.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 10);
  });
});

describe("buildPlan", () => {
  const plan = buildPlan({
    trip: TRIP,
    lines: [
      line({ id: "food", description: "Destination A – Food", total: 22800, plan_kind: "range", plan_start: "2026-10-28", plan_end: "2026-11-03" }),
      line({ id: "flights", description: "Flights", total: 30000, plan_kind: "day", plan_start: "2026-10-28" }),
      line({ id: "emergency", description: "Emergency Fund", total: 7000 }),
      line({ id: "visa", description: "Visas", total: 2000, plan_kind: "day", plan_start: "2026-10-20" }), // before the trip
    ],
    expenses: [
      { expense_date: "2026-10-28", zar_amount: 31000, category_id: "c" },
      { expense_date: "2026-10-29", zar_amount: "3000", category_id: "c" },
    ],
  });

  it("puts each line's money on its days", () => {
    const d28 = plan.days.find((d) => d.date === "2026-10-28")!;
    // food 22800/7 + flights 30000 + emergency 1000
    expect(d28.planned).toBeCloseTo(3257.15 + 30000 + 1000, 2);
    expect(d28.spent).toBe(31000);
    expect(d28.items.map((i) => i.lineId).sort()).toEqual(["emergency", "flights", "food"]);
  });

  it("keeps the whole budget — nothing lost to rounding", () => {
    const total = plan.days.reduce((s, d) => s + d.planned, 0);
    expect(total).toBeCloseTo(22800 + 30000 + 7000 + 2000, 2);
  });

  it("runs from the first to the last planned day, gaps included", () => {
    expect(plan.days[0].date).toBe("2026-10-20");
    expect(plan.days.at(-1)!.date).toBe("2026-11-03");
    expect(plan.days).toHaveLength(15);
  });

  it("groups Monday–Sunday weeks", () => {
    expect(plan.weeks.map((w) => [w.start, w.end])).toEqual([
      ["2026-10-19", "2026-10-25"],
      ["2026-10-26", "2026-11-01"],
      ["2026-11-02", "2026-11-08"],
    ]);
    expect(plan.weeks[0].planned).toBe(2000);
    expect(plan.weeks[1].spent).toBe(34000);
  });

  it("summarises a day or week", () => {
    const today = periodSummary(plan, "2026-10-29", "2026-10-29");
    expect(today.planned).toBeCloseTo(3257.15 + 1000, 2); // the spare cents go to the first days
    expect(today.spent).toBe(3000);
  });

  it("reports lines it can't place", () => {
    const p = buildPlan({ trip: { start: null, end: null }, lines: [line({ id: "e", total: 10 })], expenses: [] });
    expect(p.unplaced.map((l) => l.id)).toEqual(["e"]);
  });
});

describe("mondayOf", () => {
  it("weeks start on Monday", () => {
    expect(mondayOf("2026-10-28")).toBe("2026-10-26");
    expect(mondayOf("2026-11-01")).toBe("2026-10-26"); // Sunday
    expect(mondayOf("2026-10-26")).toBe("2026-10-26");
  });
});
