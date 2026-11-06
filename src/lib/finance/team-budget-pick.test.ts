import { describe, expect, it } from "vitest";
import { orgForReceiptCurrency, selectTeamBudget, xeroBook, type TeamBudgetRow } from "./team-budget-pick";

const line = (id: string, name: string) => ({ id, name });

function budget(over: Partial<TeamBudgetRow> & Pick<TeamBudgetRow, "id" | "name">): TeamBudgetRow {
  return {
    status: "approved",
    orgKey: "npc",
    currency: "ZAR",
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    lines: [line("l1", "Food for the team")],
    ...over,
  };
}

const npc2026 = budget({ id: "b-2026", name: "Botswana 2026" });
const npc2025 = budget({
  id: "b-2025",
  name: "Botswana 2025",
  periodStart: "2025-01-01",
  periodEnd: "2025-12-31",
});
const usa2026 = budget({
  id: "b-usa",
  name: "Botswana USA 2026",
  orgKey: "usa",
  currency: "USD",
  lines: [line("l-usa", "Food")],
});

describe("selectTeamBudget", () => {
  it("picks the NPC budget whose period contains the receipt, not every budget for the team", () => {
    const picked = selectTeamBudget([npc2025, npc2026, usa2026], {
      org: "npc",
      expenseDate: "2026-11-06",
      nameHint: null,
    });
    expect(picked).toEqual({ ok: true, budget: npc2026 });
  });

  it("sends a dollar slip to the USA budget in that period", () => {
    const picked = selectTeamBudget([npc2026, usa2026], {
      org: orgForReceiptCurrency("USD"),
      expenseDate: "2026-04-01",
      nameHint: null,
    });
    expect(picked.ok && picked.budget.id).toBe("b-usa");
  });

  it("prefers the approved budget over a draft in the same period", () => {
    const draft = budget({ id: "b-draft", name: "Botswana draft", status: "draft" });
    const picked = selectTeamBudget([npc2026, draft], {
      org: "npc",
      expenseDate: "2026-11-06",
      nameHint: null,
    });
    expect(picked.ok && picked.budget.id).toBe("b-2026");
  });

  it("does not guess when two NPC budgets share the period, unless the note names one", () => {
    const other = budget({ id: "b-other", name: "Vehicle fund" });
    expect(
      selectTeamBudget([npc2026, other], { org: "npc", expenseDate: "2026-06-01", nameHint: "groceries" }).ok
    ).toBe(false);
    const named = selectTeamBudget([npc2026, other], {
      org: "npc",
      expenseDate: "2026-06-01",
      nameHint: "this is for Botswana 2026",
    });
    expect(named.ok && named.budget.id).toBe("b-2026");
  });

  it("ignores an archived budget and a date outside every period", () => {
    const archived = budget({ id: "old", name: "Old", status: "archived" });
    expect(selectTeamBudget([archived], { org: "npc", expenseDate: "2026-06-01", nameHint: null })).toEqual({
      ok: false,
      reason: "none",
    });
    expect(selectTeamBudget([npc2026], { org: "npc", expenseDate: "2027-01-01", nameHint: null }).ok).toBe(false);
  });

  it("matches on currency when the org key is not on the row yet", () => {
    const byCurrency = budget({ id: "cur", name: "USA by currency", orgKey: null, currency: "USD" });
    const picked = selectTeamBudget([npc2026, byCurrency], {
      org: "usa",
      expenseDate: "2026-06-01",
      nameHint: null,
    });
    expect(picked.ok && picked.budget.id).toBe("cur");
  });
});

describe("xeroBook", () => {
  it("posts rand to NPC and dollars to USA", () => {
    expect(
      xeroBook("npc", { localCurrency: "BWP", localAmount: 100, zarAmount: 80, zarConfirmed: false })
    ).toMatchObject({ region: "za", currency: "ZAR", amount: 80, zarConfirmed: false });
    expect(
      xeroBook("usa", { localCurrency: "USD", localAmount: 40, zarAmount: 720, zarConfirmed: false })
    ).toMatchObject({ region: "us", currency: "USD", amount: 40, zarConfirmed: true });
    expect(xeroBook(null, { localCurrency: "ZAR", localAmount: 10, zarAmount: 10, zarConfirmed: true })).toMatchObject({
      region: "za",
      currency: "ZAR",
      amount: 10,
    });
  });
});
