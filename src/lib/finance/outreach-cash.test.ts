import { describe, expect, it } from "vitest";
import { alertToSend, cashInHand, daysLeft, recentDailySpend, spentFromSent } from "./outreach-cash";

describe("spentFromSent", () => {
  it("counts cash, card and transfers — not base prepayments or reimbursements", () => {
    expect(
      spentFromSent([
        { zar_amount: 1000, payment_method: "cash" },
        { zar_amount: "250.50", payment_method: "card" },
        { zar_amount: 100, payment_method: "bank_transfer" },
        { zar_amount: 9000, payment_method: "prepayment" },
        { zar_amount: 75, payment_method: "reimbursement" },
      ])
    ).toBe(1350.5);
  });
});

describe("cashInHand", () => {
  it("works out what's left of what was sent", () => {
    expect(cashInHand({ sent: 20000, spent: 15200 })).toMatchObject({ left: 4800, pctLeft: 24, level: "low" });
  });
  it("levels: ok above 30%, low at 30% and under, critical at 15% and under or overspent", () => {
    expect(cashInHand({ sent: 100, spent: 69 }).level).toBe("ok");
    expect(cashInHand({ sent: 100, spent: 70 }).level).toBe("low");
    expect(cashInHand({ sent: 100, spent: 85 }).level).toBe("critical");
    expect(cashInHand({ sent: 100, spent: 120 })).toMatchObject({ left: -20, level: "critical" });
  });
  it("respects a team's own thresholds", () => {
    expect(cashInHand({ sent: 100, spent: 55, lowPct: 50, criticalPct: 20 }).level).toBe("low");
  });
  it("says nothing before any money is sent", () => {
    expect(cashInHand({ sent: 0, spent: 300 })).toMatchObject({ pctLeft: null, level: "none" });
  });
});

describe("burn rate", () => {
  const exp = [
    { zar_amount: 700, payment_method: "cash", expense_date: "2026-10-20" },
    { zar_amount: 700, payment_method: "card", expense_date: "2026-10-14" },
    { zar_amount: 5000, payment_method: "prepayment", expense_date: "2026-10-19" },
    { zar_amount: 9999, payment_method: "cash", expense_date: "2026-10-13" }, // 8 days ago
  ];
  it("averages the last 7 days of team spending", () => {
    expect(recentDailySpend(exp, "2026-10-20")).toBe(200);
  });
  it("turns money left into days", () => {
    expect(daysLeft(900, 200)).toBe(4);
    expect(daysLeft(900, 0)).toBeNull();
    expect(daysLeft(-5, 200)).toBe(0);
  });
});

describe("alertToSend", () => {
  it("alerts once per level, only getting worse", () => {
    expect(alertToSend(null, "ok")).toBeNull();
    expect(alertToSend("ok", "low")).toBe("low");
    expect(alertToSend("low", "low")).toBeNull();
    expect(alertToSend("low", "critical")).toBe("critical");
    expect(alertToSend("ok", "critical")).toBe("critical");
    expect(alertToSend("critical", "low")).toBeNull();
  });
  it("alerts again after money is sent and it runs low again", () => {
    // Sending money resets the stored level to ok; the next dip alerts.
    expect(alertToSend("ok", "low")).toBe("low");
  });
});
