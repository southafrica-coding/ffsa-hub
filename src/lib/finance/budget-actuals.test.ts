import { describe, expect, it } from "vitest";
import { attributeActuals, isMissingRelation, regionForBudgetCurrency, xeroDateOnly, xeroLineSpendCents, type ActualLineInput, type XeroActualSpend } from "./budget-actuals";

const food: ActualLineInput = {
  lineId: "food",
  name: "Food for the team",
  plannedCents: 100_000,
  accountCode: "400",
  tracking: [{ name: "Ministries", option: "Botswana" }],
};
const fuel: ActualLineInput = {
  lineId: "fuel",
  name: "Fuel",
  plannedCents: 50_000,
  accountCode: "410",
  tracking: [{ name: "Ministries", option: "Botswana" }],
};
const uncoded: ActualLineInput = {
  lineId: "unsure",
  name: "Not sure yet",
  plannedCents: 0,
  accountCode: null,
  tracking: [],
};

function spend(over: Partial<XeroActualSpend>): XeroActualSpend {
  return {
    bankTransactionId: "bt-1",
    accountCode: "400",
    amountCents: 18_000,
    tracking: [{ name: "Ministries", option: "Botswana" }],
    ...over,
  };
}

describe("attributeActuals", () => {
  it("sums Xero spend onto the matching line and leaves an uncoded line unknown", () => {
    const result = attributeActuals(
      [food, fuel, uncoded],
      [spend({}), spend({ bankTransactionId: "bt-2", amountCents: 2_500 })]
    );
    const byId = Object.fromEntries(result.lines.map((l) => [l.lineId, l]));
    expect(byId.food).toMatchObject({ actualCents: 20_500, differenceCents: 79_500 });
    expect(byId.fuel).toMatchObject({ actualCents: 0, differenceCents: 50_000 });
    expect(byId.unsure.actualCents).toBeNull();
    expect(result.unmatched).toEqual({ count: 0, cents: 0 });
  });

  it("does not give one spend to two lines, and ignores a different project", () => {
    const shared: ActualLineInput = { ...food, lineId: "food-2", name: "Food again" };
    const result = attributeActuals(
      [food, shared, fuel],
      [
        spend({ bankTransactionId: "tie" }),
        spend({ bankTransactionId: "other", accountCode: "400", tracking: [{ name: "Ministries", option: "Eswatini" }], amountCents: 900 }),
      ]
    );
    expect(result.lines.find((l) => l.lineId === "food")?.actualCents).toBe(0);
    expect(result.lines.find((l) => l.lineId === "food-2")?.actualCents).toBe(0);
    expect(result.unmatched).toEqual({ count: 2, cents: 18_900 });
  });

  it("does not let a line with no tracking take every spend on the account", () => {
    const bare: ActualLineInput = { ...food, lineId: "bare", name: "Bare", tracking: [] };
    const result = attributeActuals([bare], [spend({})]);
    expect(result.lines[0].actualCents).toBe(0);
    expect(result.unmatched).toEqual({ count: 1, cents: 18_000 });
  });

  it("counts one spend on one line when two budgets share the account and tracking", () => {
    const other: ActualLineInput = { ...food, lineId: "other-budget", name: "Same line elsewhere" };
    const result = attributeActuals([food, other], [spend({})]);
    expect(result.lines.every((line) => line.actualCents === 0)).toBe(true);
    expect(result.unmatched.count).toBe(1);
  });

  it("does not turn a refund into spend", () => {
    expect(xeroLineSpendCents(-50)).toBeNull();
    expect(xeroLineSpendCents(0)).toBeNull();
    expect(xeroLineSpendCents(18.5)).toBe(1850);
  });

  it("prefers the line with more tracking when both accounts match", () => {
    const broad: ActualLineInput = { ...food, lineId: "broad", tracking: [] };
    const result = attributeActuals([broad, food], [spend({})]);
    expect(result.lines.find((l) => l.lineId === "food")?.actualCents).toBe(18_000);
    expect(result.lines.find((l) => l.lineId === "broad")?.actualCents).toBe(0);
    expect(result.unmatched.count).toBe(0);
  });
});

describe("xero dates and schema errors", () => {
  it("reads both Xero date shapes", () => {
    expect(xeroDateOnly("2026-11-06T00:00:00")).toBe("2026-11-06");
    expect(xeroDateOnly("/Date(1762387200000+0000)/")).toBe("2025-11-06");
    expect(xeroDateOnly(null)).toBeNull();
  });

  it("notices when the budget tables are not there yet", () => {
    expect(isMissingRelation({ code: "PGRST205", message: "Could not find the table public.budgets in the schema cache" })).toBe(true);
    expect(isMissingRelation({ code: "42501", message: "permission denied" })).toBe(false);
    expect(regionForBudgetCurrency("USD")).toBe("us");
    expect(regionForBudgetCurrency("ZAR")).toBe("za");
  });
});
