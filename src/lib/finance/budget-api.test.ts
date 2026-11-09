import { describe, expect, it } from "vitest";
import { emptyBudgetDraft, newSheetExpense, newSheetLine } from "./budget-sheet";
import {
  buildWorkbookBody,
  canonicalFromResponse,
  centsToField,
  draftFromCanonical,
  interpretBudgetWrite,
  parseBudgetList,
  parseWorkbookPeriods,
} from "./budget-api";

const LINE = "11111111-1111-4111-8111-111111111111";
const EXPENSE = "22222222-2222-4222-8222-222222222222";
const BUDGET = "33333333-3333-4333-8333-333333333333";
const PERIOD = "44444444-4444-4444-8444-444444444444";
const ORG = "55555555-5555-4555-8555-555555555555";
const OWNER = "66666666-6666-4666-8666-666666666666";

function canonical() {
  return {
    id: BUDGET,
    name: "Worship",
    status: "draft",
    orgId: ORG,
    currency: "ZAR",
    ownerKind: "outreach_team",
    ownerId: OWNER,
    period: { id: PERIOD, kind: "year", label: "2027", start: "2027-01-01", end: "2027-12-31" },
    driverLabel: "Volunteers",
    driverValue: 8,
    fundingGoalCents: null,
    fundsInHandCents: null,
    incomeGoalCents: null,
    fundraisingGoalCents: null,
    notes: "Bring receipts.",
    updatedAt: "2026-11-08T10:00:00.000Z",
    lines: [
      {
        id: LINE,
        kind: "variable",
        name: "Food",
        amountCents: 19000,
        frequency: 12,
        multiplier: 8,
        usesDriver: false,
        lineTotalCents: 1824000,
        notes: null,
        codingStatus: "needs_coding",
        sort: 0,
      },
    ],
    expenses: [
      {
        id: EXPENSE,
        lineId: LINE,
        expenseDate: "2026-02-01",
        vendor: null,
        description: "Groceries",
        amountCents: 5000,
        reference: null,
        notes: null,
      },
    ],
  };
}

describe("canonical budget", () => {
  it("reads the route body and keeps the revision token", () => {
    const parsed = canonicalFromResponse({ budget: canonical(), ignored: ["purpose"] });
    expect(parsed?.budget.updatedAt).toBe("2026-11-08T10:00:00.000Z");
    expect(parsed?.budget.orgId).toBe(ORG);
    expect(parsed?.ignored).toEqual(["purpose"]);
    const draft = draftFromCanonical(parsed!.budget, "local only");
    expect(draft.org_id).toBe(ORG);
    expect(draft.periodId).toBe(PERIOD);
    expect(draft.lines[0].amount).toBe("190.00");
    expect(draft.lines[0].codingStatus).toBe("needs_coding");
    expect(draft.expenses[0].lineId).toBe(LINE);
    expect(draft.purpose).toBe("local only");
  });

  it("refuses a budget that is not rand", () => {
    expect(canonicalFromResponse({ budget: { ...canonical(), currency: "USD" } })).toBeNull();
  });
});

describe("buildWorkbookBody", () => {
  it("sends cents, the period, and the last updatedAt, and does not send a purpose", () => {
    const draft = {
      ...emptyBudgetDraft(),
      name: "Worship",
      ownerKind: "outreach_team" as const,
      ownerId: OWNER,
      org_id: ORG,
      periodId: PERIOD,
      purpose: "not a column",
      lines: [{ ...newSheetLine("variable", LINE), name: "Food", amount: "190", frequency: "12", multiplier: "8" }],
      expenses: [{ ...newSheetExpense(EXPENSE), expenseDate: "2026-02-01", description: "Groceries", amount: "50", lineId: LINE }],
    };
    const built = buildWorkbookBody(draft, "save", "2026-11-08T10:00:00.000Z");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.body.updatedAt).toBe("2026-11-08T10:00:00.000Z");
    expect(built.body.periodId).toBe(PERIOD);
    expect(built.body.orgId).toBe(ORG);
    expect(built.body).not.toHaveProperty("purpose");
    expect(built.body).not.toHaveProperty("currency");
    expect(built.body).not.toHaveProperty("status");
    expect((built.body.lines as { amountCents: number }[])[0].amountCents).toBe(19000);
    expect((built.body.expenses as { lineId: string }[])[0].lineId).toBe(LINE);
  });

  it("refuses a save with no revision token", () => {
    const draft = {
      ...emptyBudgetDraft(),
      name: "Worship",
      ownerKind: "staff_ministry" as const,
      ownerId: OWNER,
      periodId: PERIOD,
    };
    expect(buildWorkbookBody(draft, "save", null)).toEqual({
      ok: false,
      error: "Reload this budget before saving.",
    });
  });
});

describe("interpretBudgetWrite", () => {
  it("keeps a stale save as a reload choice and a duplicate as a rejection", () => {
    const stale = interpretBudgetWrite(409, { error: "Someone else saved this budget. Reload it and try again." });
    expect(stale.kind).toBe("stale");
    const duplicate = interpretBudgetWrite(409, {
      error: "A budget with this name already exists for that owner and period. If a previous save stopped halfway, open that budget and finish it, or archive it first.",
    });
    expect(duplicate.kind).toBe("rejected");
    const southAfrica = interpretBudgetWrite(409, { error: "This budget is not on the active South Africa organisation." });
    expect(southAfrica.kind).toBe("rejected");
  });

  it("names a missing schema and a preview block without treating them as saved", () => {
    expect(interpretBudgetWrite(503, { error: "Saving a budget isn't available yet.", code: "schema_not_applied" }).kind).toBe(
      "unavailable"
    );
    expect(interpretBudgetWrite(403, { error: "preview_writes_disabled", message: "This preview deployment cannot change budgets." }).kind).toBe(
      "forbidden"
    );
    expect(interpretBudgetWrite(201, { budget: canonical(), ignored: [] }).kind).toBe("saved");
  });
});

describe("parseWorkbookPeriods", () => {
  it("reads day periods and rejects an organisation field", () => {
    expect(
      parseWorkbookPeriods({
        periods: [{ id: PERIOD, label: "2026", kind: "year", start: "2026-01-01", end: "2026-12-31", current: true }],
      })
    ).toEqual([{ id: PERIOD, label: "2026", kind: "year", start: "2026-01-01", end: "2026-12-31", current: true }]);
    expect(
      parseWorkbookPeriods({
        periods: [{ id: PERIOD, label: "2026", kind: "year", start: "2026-01-01", end: "2026-12-31", orgId: "npc" }],
      })
    ).toBeNull();
    expect(parseWorkbookPeriods({ periods: [{ id: "not-a-uuid", label: "2026", kind: "year", start: "2026-01-01", end: "2026-12-31" }] })).toBeNull();
  });
});

describe("parseBudgetList", () => {
  it("reads the collection", () => {
    expect(
      parseBudgetList({
        budgets: [{ id: BUDGET, name: "Worship", status: "draft", ownerKind: "outreach_team", ownerId: OWNER, period: { label: "2027" } }],
      })
    ).toEqual([{ id: BUDGET, name: "Worship", status: "draft", ownerKind: "outreach_team", ownerId: OWNER, periodLabel: "2027" }]);
  });
});

describe("centsToField", () => {
  it("round trips a rand amount", () => {
    expect(centsToField(19000)).toBe("190.00");
    expect(centsToField(-50)).toBe("-0.50");
  });
});
