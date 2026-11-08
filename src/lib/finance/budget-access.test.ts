import { describe, expect, it } from "vitest";
import { canOpenBudgetSheet } from "./budget-access";

describe("canOpenBudgetSheet", () => {
  it("follows view-all, an active lead, or an existing budget membership", () => {
    expect(canOpenBudgetSheet({ viewAll: true, leadsMinistry: false, memberOfBudget: false })).toBe(true);
    expect(canOpenBudgetSheet({ viewAll: false, leadsMinistry: true, memberOfBudget: false })).toBe(true);
    expect(canOpenBudgetSheet({ viewAll: false, leadsMinistry: false, memberOfBudget: true })).toBe(true);
    expect(canOpenBudgetSheet({ viewAll: false, leadsMinistry: false, memberOfBudget: false })).toBe(false);
  });
});
