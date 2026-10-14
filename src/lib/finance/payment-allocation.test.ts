import { describe, expect, it } from "vitest";
import { allocateInvoicePayments, type ChargeOnInvoice } from "./payment-allocation";

const NOW = "2027-03-10T08:00:00.000Z";
const charge = (id: string, amount: number, due: string, over: Partial<ChargeOnInvoice> = {}): ChargeOnInvoice => ({
  id,
  amount_zar: amount,
  due_date: due,
  status: "sent",
  amount_paid_zar: 0,
  sent_at: "2027-02-15T05:00:00Z",
  paid_at: null,
  ...over,
});

describe("allocateInvoicePayments", () => {
  it("fills the earliest-due charge first, then the next", () => {
    const u = allocateInvoicePayments(
      [charge("outreach", 45000, "2027-03-04"), charge("march", 6000, "2027-03-04", { sequence: 2 }), charge("deposit", 15000, "2027-01-04")],
      { status: "AUTHORISED", amountPaid: 20000, fullyPaidOn: null },
      NOW
    );
    expect(u).toEqual([
      { id: "deposit", amount_paid_zar: 15000, status: "paid", paid_at: NOW },
      { id: "outreach", amount_paid_zar: 5000, status: "sent", paid_at: null },
    ]);
  });

  it("marks everything paid when Xero says PAID, dated by Xero", () => {
    const u = allocateInvoicePayments(
      [charge("a", 1000.005, "2027-01-01"), charge("b", 0.01, "2027-01-02")],
      { status: "PAID", amountPaid: 1000.0, fullyPaidOn: "2027-03-01" },
      NOW
    );
    expect(u.map((x) => [x.id, x.status, x.paid_at])).toEqual([
      ["a", "paid", "2027-03-01T00:00:00Z"],
      ["b", "paid", "2027-03-01T00:00:00Z"],
    ]);
  });

  it("is a no-op when nothing changed", () => {
    const u = allocateInvoicePayments(
      [charge("a", 1000, "2027-01-01", { amount_paid_zar: 400 })],
      { status: "AUTHORISED", amountPaid: 400, fullyPaidOn: null },
      NOW
    );
    expect(u).toEqual([]);
  });

  it("takes a payment back off when it's removed in Xero", () => {
    const u = allocateInvoicePayments(
      [charge("a", 1000, "2027-01-01", { status: "paid", amount_paid_zar: 1000, paid_at: "2027-02-01T00:00:00Z" })],
      { status: "AUTHORISED", amountPaid: 0, fullyPaidOn: null },
      NOW
    );
    expect(u).toEqual([{ id: "a", amount_paid_zar: 0, status: "sent", paid_at: null }]);
  });

  it("keeps 'generated' for a never-emailed draft that's part-paid", () => {
    const u = allocateInvoicePayments(
      [charge("a", 1000, "2027-01-01", { status: "generated", sent_at: null })],
      { status: "AUTHORISED", amountPaid: 100, fullyPaidOn: null },
      NOW
    );
    expect(u).toEqual([{ id: "a", amount_paid_zar: 100, status: "generated", paid_at: null }]);
  });

  it("leaves voided invoices and cancelled charges alone", () => {
    expect(
      allocateInvoicePayments([charge("a", 10, "2027-01-01")], { status: "VOIDED", amountPaid: 0, fullyPaidOn: null }, NOW)
    ).toEqual([]);
    expect(
      allocateInvoicePayments(
        [charge("x", 10, "2027-01-01", { status: "cancelled" }), charge("y", 10, "2027-01-02")],
        { status: "AUTHORISED", amountPaid: 10, fullyPaidOn: null },
        NOW
      ).map((u) => u.id)
    ).toEqual(["y"]);
  });

  it("never records more than a charge's amount, even if Xero shows an overpayment", () => {
    const u = allocateInvoicePayments(
      [charge("a", 500, "2027-01-01")],
      { status: "AUTHORISED", amountPaid: 900, fullyPaidOn: null },
      NOW
    );
    expect(u[0]).toMatchObject({ amount_paid_zar: 500, status: "paid" });
  });
});
