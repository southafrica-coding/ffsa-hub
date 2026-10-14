import { describe, expect, it } from "vitest";
import { computeBalance, sumBalances, todayInSouthAfrica, type BalanceCharge } from "./student-balance";

const c = (amount: number, status: string, due: string, paid = 0): BalanceCharge => ({
  amount_zar: amount,
  amount_paid_zar: paid,
  status,
  due_date: due,
});
const TODAY = "2027-03-10";

describe("computeBalance", () => {
  it("splits a schedule into paid / overdue / invoiced / not invoiced, adding up exactly", () => {
    const b = computeBalance(
      [
        c(15000, "paid", "2027-01-04", 15000),
        c(6000, "sent", "2027-02-04", 2000), // part-paid and overdue
        c(6000, "sent", "2027-03-04"), // overdue
        c(45000, "generated", "2027-03-15"), // invoiced, not due
        c(6000, "scheduled", "2027-04-04"),
        c(6000, "needs_decision", "2027-01-04"),
        c(9999, "cancelled", "2027-01-01"),
      ],
      TODAY
    );
    expect(b).toMatchObject({
      total: 84000,
      paid: 17000,
      overdue: 10000,
      invoicedNotDue: 45000,
      notInvoiced: 12000,
      outstanding: 67000,
      heldCount: 1,
      percentPaid: 20.2,
    });
    expect(b.paid + b.overdue + b.invoicedNotDue + b.notInvoiced).toBe(b.total);
    // Earliest owing: the held January charge.
    expect(b.next).toEqual({ dueDate: "2027-01-04", amount: 6000 });
  });

  it("a charge due today isn't overdue yet", () => {
    expect(computeBalance([c(100, "sent", TODAY)], TODAY)).toMatchObject({ overdue: 0, invoicedNotDue: 100 });
  });

  it("caps an overpaid charge at its amount and never shows 100% early", () => {
    expect(computeBalance([c(100, "paid", "2027-01-01", 150)], TODAY)).toMatchObject({ paid: 100, percentPaid: 100 });
    expect(computeBalance([c(1000, "sent", "2027-01-01", 999.99)], TODAY).percentPaid).toBe(99.9);
  });

  it("combines charges due the same day into one next payment", () => {
    expect(
      computeBalance([c(45000, "scheduled", "2027-03-04"), c(6000, "scheduled", "2027-03-04")], TODAY).next
    ).toEqual({ dueDate: "2027-03-04", amount: 51000 });
  });

  it("is all zeros with nothing scheduled", () => {
    expect(computeBalance([], TODAY)).toMatchObject({ total: 0, percentPaid: 0, next: null });
  });
});

describe("sumBalances", () => {
  it("adds school totals", () => {
    const s = sumBalances([
      computeBalance([c(100, "paid", "2027-01-01", 100)], TODAY),
      computeBalance([c(300, "sent", "2027-01-01")], TODAY),
    ]);
    expect(s).toMatchObject({ total: 400, paid: 100, overdue: 300, outstanding: 300, percentPaid: 25 });
  });
});

describe("todayInSouthAfrica", () => {
  it("is already tomorrow in SA at 23:30 UTC", () => {
    expect(todayInSouthAfrica(new Date("2027-03-10T23:30:00Z"))).toBe("2027-03-11");
  });
});
