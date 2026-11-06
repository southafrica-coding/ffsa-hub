import { describe, expect, it } from "vitest";
import {
  amountToCents,
  isSouthAfricaOrg,
  lineTotalCents,
  parseWorkbookWrite,
  periodOrgDecision,
  roundNumeric,
} from "./budget-workbook";

const OWNER = "33333333-3333-4333-8333-333333333333";

describe("line totals", () => {
  it("rounds amount × frequency × multiplier half away from zero", () => {
    expect(lineTotalCents({ amount_cents: 15, frequency: 1, multiplier: 4.1 })).toBe(62);
    expect(lineTotalCents({ amount_cents: 19000, frequency: 12, multiplier: 8 })).toBe(1_824_000);
  });

  it("treats a typed rand amount as cents", () => {
    expect(amountToCents("190")).toBe(19000);
    expect(amountToCents("2,400.50")).toBe(240050);
    expect(roundNumeric("1.005")).toBe(1.01);
  });
});

describe("South Africa org", () => {
  const npc = { id: "npc", key: "npc", name: "FFSA NPC", record_currency: "ZAR", is_active: true };
  const usa = { id: "usa", key: "usa", name: "FF USA Inc", record_currency: "USD", is_active: true };

  it("accepts the active NPC rand org and rejects a US org", () => {
    expect(isSouthAfricaOrg(npc)).toBe(true);
    expect(isSouthAfricaOrg(usa)).toBe(false);
    expect(isSouthAfricaOrg({ ...npc, record_currency: "USD" })).toBe(false);
    expect(isSouthAfricaOrg({ ...npc, is_active: false })).toBe(false);
  });

  it("uses the period's org and does not rewrite a US org onto NPC", () => {
    expect(periodOrgDecision({ periodOrg: usa, passedOrgId: "npc" })).toEqual({
      ok: false,
      error: "Budgets are for South Africa only, in rand.",
    });
    expect(periodOrgDecision({ periodOrg: npc, passedOrgId: "usa" })).toEqual({
      ok: false,
      error: "The organisation comes from the period.",
    });
    expect(periodOrgDecision({ periodOrg: npc, passedOrgId: "npc" })).toEqual({ ok: true, orgId: "npc" });
    expect(periodOrgDecision({ periodOrg: npc })).toEqual({ ok: true, orgId: "npc" });
  });
});

describe("parseWorkbookWrite", () => {
  const createBody = {
    name: "DTS 2027",
    ownerKind: "outreach_team",
    ownerId: OWNER,
    periodKind: "year",
    periodLabel: "2027",
    periodStart: "2027-01-01",
    periodEnd: "2027-12-31",
  };

  it("keeps fixed frequency at 1 and reads a sheet amount", () => {
    const parsed = parseWorkbookWrite(
      {
        ...createBody,
        lines: [{ kind: "fixed", name: "Van", amount: "2400.50", frequency: "4", multiplier: "2" }],
      },
      "create"
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.lines?.[0]).toMatchObject({
      kind: "fixed",
      amountCents: 240050,
      frequency: 1,
      multiplier: 2,
    });
    expect(parsed.value.ignored).toContain("fixedFrequency");
  });

  it("lets a variable line follow the driver", () => {
    const parsed = parseWorkbookWrite(
      {
        ...createBody,
        driverLabel: "Volunteers",
        driverValue: "8",
        lines: [{ kind: "variable", name: "Food", amount: "190", frequency: "12", multiplier: "1", usesDriver: true }],
      },
      "create"
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.driverValue).toBe(8);
    expect(parsed.value.lines?.[0].usesDriver).toBe(true);
  });

  it("does not treat what this covers as a stored field", () => {
    const parsed = parseWorkbookWrite({ ...createBody, purpose: "Food for the team", notes: "Bring receipts." }, "create");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.notes).toBe("Bring receipts.");
    expect(parsed.value.ignored).toContain("purpose");
    expect("purpose" in parsed.value).toBe(false);
  });

  it("rejects a US org key and any currency other than rand", () => {
    expect(parseWorkbookWrite({ ...createBody, orgKey: "usa" }, "create")).toEqual({
      ok: false,
      error: "Budgets are for South Africa only, in rand.",
    });
    expect(parseWorkbookWrite({ ...createBody, currency: "EUR" }, "create").ok).toBe(false);
  });

  it("rejects a currency and a Xero code", () => {
    expect(parseWorkbookWrite({ ...createBody, currency: "USD" }, "create")).toEqual({
      ok: false,
      error: "Amounts stay in rand. There's no currency to choose.",
    });
    const coded = parseWorkbookWrite(
      { ...createBody, lines: [{ kind: "fixed", name: "Van", amountCents: 100, accountCode: "400" }] },
      "create"
    );
    expect(coded.ok).toBe(false);
    if (coded.ok) return;
    expect(coded.error).toMatch(/Xero code/);
  });

  it("rejects Xero spend on the sheet", () => {
    const parsed = parseWorkbookWrite({ ...createBody, budget_xero_spends: [] }, "create");
    expect(parsed.ok).toBe(false);
  });

  it("reads an expense tracker row and ignores checked", () => {
    const parsed = parseWorkbookWrite(
      {
        ...createBody,
        expenses: [{ date: "2027-02-01", what: "Groceries", amount: "45.50", proof: "slip-1", checked: true }],
      },
      "create"
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.expenses?.[0]).toMatchObject({
      expenseDate: "2027-02-01",
      description: "Groceries",
      amountCents: 4550,
      reference: "slip-1",
      lineId: null,
    });
    expect(parsed.value.ignored).toContain("checked");
  });
});
