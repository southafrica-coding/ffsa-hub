import { describe, expect, it } from "vitest";
import { budgetLineSentence, choosePlainBudgetLine, type PlainBudgetLine } from "./budget-line-language";

const LINES: PlainBudgetLine[] = [
  { id: "l-food", budgetId: "b1", name: "Food for the team" },
  { id: "l-fuel", budgetId: "b1", name: "Fuel" },
];

describe("budget line in plain words", () => {
  it("joins the line's name with what was bought", () => {
    expect(budgetLineSentence({ lineName: "Food for the team", categoryName: "Food", description: "Groceries" })).toBe(
      "Food for the team — Groceries"
    );
    expect(budgetLineSentence({ lineName: null, categoryName: "Food", description: "Groceries" })).toBe("Food — Groceries");
    expect(budgetLineSentence({ lineName: null, categoryName: null, description: "Groceries" })).toBe(
      "Not on a budget line yet — Groceries"
    );
  });

  it("matches one named line and does not invent one", () => {
    expect(
      choosePlainBudgetLine({
        userNote: null,
        suggested: "Food",
        description: "Groceries",
        categoryName: "Food",
        lines: LINES,
      })
    ).toEqual({
      budget_id: "b1",
      budget_line_id: "l-food",
      budget_line_label: "Food for the team — Groceries",
    });

    expect(
      choosePlainBudgetLine({
        userNote: null,
        suggested: "Medicine",
        description: "Pharmacy",
        categoryName: "Medicine",
        lines: LINES,
      }).budget_line_id
    ).toBeNull();

    expect(
      choosePlainBudgetLine({
        userNote: null,
        suggested: "Food",
        description: "Groceries",
        categoryName: "Food",
        lines: [],
      })
    ).toMatchObject({ budget_line_id: null, budget_line_label: "Food — Groceries" });
  });

  it("does not pick when two lines fit", () => {
    const chosen = choosePlainBudgetLine({
      userNote: "food",
      suggested: null,
      description: "lunch",
      categoryName: null,
      lines: [
        { id: "a", budgetId: "b1", name: "Food" },
        { id: "b", budgetId: "b1", name: "Food for guests" },
      ],
    });
    expect(chosen.budget_line_id).toBeNull();
  });
});
