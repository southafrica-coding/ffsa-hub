import { describe, it, expect } from "vitest";
import { matchStudentInvoices, splitTier, hubStatusForXero, type MatchCharge, type MatchInvoice } from "./xero-match";

const SCHOOL = [
  "FFXYL2027-DEP-A",
  "FFXYL2027-DEP-B",
  "FFXYL2027-DEP-C",
  "FFXYL2027-MON-A",
  "FFXYL2027-MON-B",
  "FFXYL2027-MON-C",
  "FFXOR2027",
];

const charge = (id: string, code: string, due: string, amount = 1000, status = "scheduled"): MatchCharge => ({
  id,
  label: id,
  xero_item_code: code,
  amount_zar: amount,
  due_date: due,
  status,
  xero_invoice_id: null,
});

const inv = (id: string, due: string, lines: Array<[string | null, number]>, status = "AUTHORISED"): MatchInvoice => ({
  invoiceId: id,
  invoiceNumber: `INV-${id}`,
  status,
  dueDate: due,
  date: due,
  amountPaid: 0,
  amountDue: 0,
  lines: lines.map(([itemCode, amount]) => ({ itemCode, description: "", amount })),
});

const planA = [
  charge("dep", "FFXYL2027-DEP-A", "2027-01-04", 15000, "needs_decision"),
  charge("feb", "FFXYL2027-MON-A", "2027-02-04", 6000),
  charge("mar", "FFXYL2027-MON-A", "2027-03-04", 6000),
  charge("apr", "FFXYL2027-MON-A", "2027-04-04", 6000),
  charge("out", "FFXOR2027", "2027-03-04", 45000),
];

describe("splitTier", () => {
  it("splits a tier suffix off", () => {
    expect(splitTier("FFXYL2027-DEP-B")).toEqual({ base: "FFXYL2027-DEP", tier: "B" });
    expect(splitTier("FFXOR2027")).toEqual({ base: "FFXOR2027", tier: null });
  });
});

describe("matchStudentInvoices", () => {
  it("links a hand-made deposit invoice by item code", () => {
    const m = matchStudentInvoices(planA, [inv("1", "2027-01-04", [["FFXYL2027-DEP-A", 15000]])], { schoolCodes: SCHOOL });
    expect(m.links).toHaveLength(1);
    expect(m.links[0]).toMatchObject({ chargeId: "dep", invoiceId: "1", amountDiffers: false });
    expect(m.unmatched).toEqual([]);
  });

  it("puts a repeated monthly code on the charge with the closest due date", () => {
    const m = matchStudentInvoices(
      planA,
      [inv("m", "2027-03-01", [["FFXYL2027-MON-A", 6000]]), inv("f", "2027-02-04", [["FFXYL2027-MON-A", 6000]])],
      { schoolCodes: SCHOOL }
    );
    expect(m.links.map((l) => [l.invoiceId, l.chargeId])).toEqual([
      ["f", "feb"],
      ["m", "mar"],
    ]);
  });

  it("never links two invoices to one charge", () => {
    const m = matchStudentInvoices(
      [charge("dep", "FFXYL2027-DEP-A", "2027-01-04", 15000)],
      [inv("1", "2027-01-04", [["FFXYL2027-DEP-A", 15000]]), inv("2", "2027-01-05", [["FFXYL2027-DEP-A", 15000]])],
      { schoolCodes: SCHOOL }
    );
    expect(m.links).toHaveLength(1);
    expect(m.unmatched).toEqual([expect.objectContaining({ invoiceId: "2", reason: "no_charge_left" })]);
  });

  it("links several lines of one invoice to several charges", () => {
    const m = matchStudentInvoices(
      planA,
      [inv("x", "2027-01-04", [["FFXYL2027-DEP-A", 15000], ["FFXYL2027-MON-A", 6000]])],
      { schoolCodes: SCHOOL }
    );
    expect(m.links.map((l) => l.chargeId).sort()).toEqual(["dep", "feb"]);
  });

  it("reports another tier as a mismatch and suggests it", () => {
    const m = matchStudentInvoices(planA, [inv("b", "2027-01-04", [["FFXYL2027-DEP-B", 15000]])], { schoolCodes: SCHOOL });
    expect(m.links).toEqual([]);
    expect(m.unmatched[0]).toMatchObject({ reason: "tier_mismatch", invoicedTier: "B" });
    expect(m.suggestedTier).toBe("B");
  });

  it("ignores invoices for other things and voided ones", () => {
    const m = matchStudentInvoices(
      planA,
      [
        inv("merch", "2026-11-01", [["MERCH", 300]]),
        inv("void", "2027-01-04", [["FFXYL2027-DEP-A", 15000]], "VOIDED"),
        inv("blank", "2027-01-04", [[null, 50]]),
      ],
      { schoolCodes: SCHOOL }
    );
    expect(m.links).toEqual([]);
    expect(m.otherInvoices).toBe(2);
  });

  it("skips invoices already linked and charges already invoiced", () => {
    const linked = { ...charge("dep", "FFXYL2027-DEP-A", "2027-01-04", 15000, "sent"), xero_invoice_id: "1" };
    const m = matchStudentInvoices([linked], [inv("1", "2027-01-04", [["FFXYL2027-DEP-A", 15000]])], { schoolCodes: SCHOOL });
    expect(m.alreadyLinked).toBe(1);
    expect(m.links).toEqual([]);
  });

  it("flags an amount that differs from the Hub charge", () => {
    const m = matchStudentInvoices(planA, [inv("1", "2027-01-04", [["FFXYL2027-DEP-A", 10000]])], { schoolCodes: SCHOOL });
    expect(m.links[0].amountDiffers).toBe(true);
  });

  it("matches item codes regardless of case", () => {
    const m = matchStudentInvoices(planA, [inv("1", "2027-01-04", [["ffxyl2027-dep-a", 15000]])], { schoolCodes: SCHOOL });
    expect(m.links).toHaveLength(1);
  });
});

describe("hubStatusForXero", () => {
  it("treats drafts as generated and the rest as sent", () => {
    expect(hubStatusForXero("DRAFT")).toBe("generated");
    expect(hubStatusForXero("AUTHORISED")).toBe("sent");
    expect(hubStatusForXero("PAID")).toBe("sent");
  });
});
