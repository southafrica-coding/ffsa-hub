import { describe, expect, it } from "vitest";
import {
  BUDGET_SECTION_KEYS,
  TEAM_BUDGET_SECTIONS,
  emptyBudgetDraft,
  formatBudgetMoney,
  lineMath,
  needsYouCopy,
  newSheetLine,
  parseBudgetDraft,
  periodProblem,
  rollup,
  scopeGaps,
  type BudgetSheetDraft,
} from "./budget-sheet";

function draft(partial: Partial<BudgetSheetDraft> = {}): BudgetSheetDraft {
  return { ...emptyBudgetDraft(), ...partial };
}

describe("team budget template", () => {
  it("is the empty six-section sheet, and only fixed and variable hold lines", () => {
    expect(TEAM_BUDGET_SECTIONS.map((section) => section.key)).toEqual([...BUDGET_SECTION_KEYS]);
    expect(TEAM_BUDGET_SECTIONS.filter((section) => section.holdsLines).map((section) => section.key)).toEqual([
      "variable",
      "fixed",
    ]);
    expect(emptyBudgetDraft().lines).toEqual([]);
  });
});

describe("lineMath", () => {
  it("works a repeating cost as amount × frequency × multiplier", () => {
    const line = { ...newSheetLine("variable", "a"), amount: "190", frequency: "12", multiplier: "8" };
    expect(lineMath(line, null)).toEqual({ ok: true, cents: 1824000, driverMissing: false });
  });

  it("keeps a described zero", () => {
    const line = { ...newSheetLine("fixed", "a"), name: "Team debrief", amount: "0", multiplier: "8" };
    expect(lineMath(line, null)).toMatchObject({ ok: true, cents: 0 });
  });

  it("forces frequency to 1 on a fixed line", () => {
    const line = { ...newSheetLine("fixed", "a"), amount: "2400", frequency: "12", multiplier: "2" };
    expect(lineMath(line, null)).toMatchObject({ ok: true, cents: 480000 });
  });

  it("follows the driver and totals zero until the driver is set", () => {
    const line = { ...newSheetLine("variable", "a"), amount: "150", frequency: "1", multiplier: "99", usesDriver: true };
    expect(lineMath(line, null)).toEqual({ ok: true, cents: 0, driverMissing: true });
    expect(lineMath(line, 8)).toEqual({ ok: true, cents: 120000, driverMissing: false });
  });

  it("refuses a negative amount and a blank one", () => {
    expect(lineMath({ ...newSheetLine("variable", "a"), amount: "" }, null).ok).toBe(false);
    expect(lineMath({ ...newSheetLine("variable", "a"), amount: "-5" }, null)).toMatchObject({ ok: false, reason: "amount" });
  });
});

describe("rollup", () => {
  it("sums only ready lines of that kind", () => {
    const lines = [
      { ...newSheetLine("variable", "a"), amount: "10", frequency: "2", multiplier: "3" },
      { ...newSheetLine("variable", "b"), amount: "" },
      { ...newSheetLine("fixed", "c"), amount: "5", multiplier: "1" },
    ];
    expect(rollup(lines, "variable", null)).toEqual({ count: 2, ready: 1, incomplete: 1, cents: 6000 });
    expect(rollup(lines, "fixed", null).cents).toBe(500);
  });
});

describe("period and scope", () => {
  it("requires a named range that ends on or after it starts", () => {
    expect(periodProblem(draft())).toMatch(/year, a term, or an event/);
    expect(periodProblem(draft({ periodKind: "year", periodLabel: "2027", periodStart: "2027-01-01", periodEnd: "2026-12-31" }))).toMatch(/ends before/);
    expect(periodProblem(draft({ periodKind: "year", periodLabel: "2027", periodStart: "2027-01-01", periodEnd: "2027-12-31" }))).toBeNull();
  });

  it("names the missing scope, in order", () => {
    expect(scopeGaps(draft())).toEqual(["name", "owner", "organisation", "period"]);
    const ready = draft({
      name: "Worship",
      ownerKind: "staff_ministry",
      ownerId: "m1",
      org_id: "org1",
      periodKind: "year",
      periodLabel: "2027",
      periodStart: "2027-01-01",
      periodEnd: "2027-12-31",
    });
    expect(scopeGaps(ready)).toEqual([]);
    expect(needsYouCopy([])).toMatch(/not saved/);
    expect(needsYouCopy(["owner", "period"])).toBe(
      "This budget still needs one owner and a real period. A budget is one owner, one organisation, one currency, and one period."
    );
  });
});

describe("parseBudgetDraft", () => {
  it("drops junk and keeps a real sheet", () => {
    expect(parseBudgetDraft(null)).toBeNull();
    expect(parseBudgetDraft({ name: 1 })).toBeNull();
    const parsed = parseBudgetDraft({
      ...emptyBudgetDraft(),
      name: "Worship",
      lines: [
        { id: "a", kind: "variable", name: "Food", amount: "10", frequency: "1", multiplier: "1", usesDriver: false, notes: "" },
        { id: "a", kind: "variable", name: "Duplicate", amount: "1", frequency: "1", multiplier: "1", usesDriver: false, notes: "" },
        { kind: "nope" },
      ],
    });
    expect(parsed?.name).toBe("Worship");
    expect(parsed?.lines.map((line) => line.name)).toEqual(["Food"]);
  });
});

describe("formatBudgetMoney", () => {
  it("prints rand and dollars from cents", () => {
    expect(formatBudgetMoney(1824000, "ZAR")).toMatch(/18/);
    expect(formatBudgetMoney(1824000, "ZAR")).toMatch(/R/);
    expect(formatBudgetMoney(100, "USD")).toMatch(/\$/);
    expect(formatBudgetMoney(0, null)).toMatch(/0/);
  });
});
