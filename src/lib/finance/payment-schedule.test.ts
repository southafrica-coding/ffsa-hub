import { describe, expect, it } from "vitest";
import {
  compileSchedule,
  designFromCharges,
  emptyPayment,
  type PaymentScheduleDesign,
} from "./payment-schedule";
import { buildSchedule, type BuilderChargeItem } from "./schedule-builder";
import { FFX_2027_PROGRAM_TEMPLATE } from "./billing";

const noArrival = { hasArrivalDate: false };

const design = (over: Partial<PaymentScheduleDesign> = {}): PaymentScheduleDesign => ({
  tierPrices: { A: 120000, B: 99500, C: 80000 },
  payments: [],
  ...over,
});

describe("compileSchedule — amounts", () => {
  it("splits by % and lands exactly on the price with a remainder payment", () => {
    const r = compileSchedule(
      design({
        tierPrices: { A: 100000, B: 33333.33, C: null },
        payments: [
          emptyPayment({ label: "Deposit", amount: { mode: "percent", percent: 20 } }),
          emptyPayment({ label: "2nd payment", amount: { mode: "percent", percent: 33.3333 } }),
          emptyPayment({ label: "Final", amount: { mode: "remainder" } }),
        ],
      }),
      noArrival
    );
    expect(r.errors).toEqual([]);
    expect(r.tiers.map((t) => t.tier)).toEqual(["A", "B"]); // C not offered
    const b = r.tiers.find((t) => t.tier === "B")!;
    expect(b.payments.map((p) => p.total)).toEqual([6666.67, 11111.1, 15555.56]);
    expect(b.total).toBe(33333.33);
    expect(b.difference).toBe(0);
  });

  it("mixes a fixed deposit with a % split of the rest", () => {
    const r = compileSchedule(
      design({
        tierPrices: { A: 120000, B: null, C: null },
        payments: [
          emptyPayment({ label: "Deposit", amount: { mode: "fixed", A: 15000, B: null, C: null } }),
          emptyPayment({ label: "2nd", amount: { mode: "percent", percent: 50 } }),
          emptyPayment({ label: "Final", amount: { mode: "remainder" } }),
        ],
      }),
      noArrival
    );
    expect(r.tiers[0].payments.map((p) => p.total)).toEqual([15000, 60000, 45000]);
  });

  it("splits a % monthly run evenly and pushes the cents into the remainder", () => {
    const r = compileSchedule(
      design({
        tierPrices: { A: 10000, B: null, C: null },
        payments: [
          emptyPayment({
            label: "Monthly",
            amount: { mode: "percent", percent: 100 / 3 },
            timing: { kind: "monthly", count: 3, day: 4, startMonth: 2, startYear: 2027 },
          }),
          emptyPayment({ label: "Final", amount: { mode: "remainder" } }),
        ],
      }),
      noArrival
    );
    const [monthly, final] = r.tiers[0].payments;
    expect(monthly.perOccurrence).toBe(1111.11);
    expect(monthly.total).toBe(3333.33);
    expect(final.total).toBe(6666.67);
    expect(r.tiers[0].difference).toBe(0);
  });

  it("warns, but allows saving, when payments don't add up and nothing absorbs it", () => {
    const r = compileSchedule(
      design({
        tierPrices: { A: 1000, B: null, C: null },
        payments: [emptyPayment({ label: "Only", amount: { mode: "percent", percent: 90 } })],
      }),
      noArrival
    );
    expect(r.errors).toEqual([]);
    expect(r.warnings[0]).toMatch(/add up to R\s?900[.,]00 but the price is R\s?1\D?000[.,]00/);
  });

  it("refuses a remainder that would be negative", () => {
    const r = compileSchedule(
      design({
        tierPrices: { A: 1000, B: null, C: null },
        payments: [
          emptyPayment({ label: "Big", amount: { mode: "fixed", A: 1500, B: null, C: null } }),
          emptyPayment({ label: "Rest", amount: { mode: "remainder" } }),
        ],
      }),
      noArrival
    );
    expect(r.errors.join(" ")).toMatch(/more than the R\s?1\D?000[.,]00 price/);
  });

  it("refuses shapes the engine can't honour", () => {
    const r = compileSchedule(
      design({
        payments: [
          emptyPayment({ label: "", amount: { mode: "remainder" } }),
          emptyPayment({ label: "Two", amount: { mode: "remainder" } }),
          emptyPayment({ label: "Arrive", timing: { kind: "before_arrival", days: 30 }, amount: { mode: "percent", percent: 10 } }),
        ],
      }),
      noArrival
    );
    expect(r.errors).toEqual(
      expect.arrayContaining([
        `Only one payment can be "whatever's left".`,
        "Payment 1 needs a name.",
        expect.stringMatching(/Arrive: "before arrival" needs a course/),
      ])
    );
  });
});

describe("compileSchedule — dates through the real engine", () => {
  const run = (d: PaymentScheduleDesign, acceptanceDate: string, arrivalDate: string | null = null) => {
    const r = compileSchedule(d, { hasArrivalDate: !!arrivalDate });
    expect(r.errors).toEqual([]);
    const items = r.items.filter((i) => i.tier === "A") as unknown as BuilderChargeItem[];
    return buildSchedule(items, {
      acceptanceDate,
      arrivalDate,
      paymentPreference: "standard",
      today: acceptanceDate,
    }).rows;
  };

  it("due N days after acceptance, invoiced N days before due", () => {
    const rows = run(
      design({
        tierPrices: { A: 1000, B: null, C: null },
        payments: [
          emptyPayment({
            label: "Deposit",
            amount: { mode: "percent", percent: 100 },
            timing: { kind: "after_acceptance", days: 14 },
            invoice: { kind: "days_before_due", days: 7 },
          }),
        ],
      }),
      "2027-01-10"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ due_date: "2027-01-24", scheduled_generation_date: "2027-01-17", amount_zar: 1000 });
  });

  it("before arrival, on a fixed date, and a monthly run", () => {
    const rows = run(
      design({
        tierPrices: { A: 1000, B: null, C: null },
        payments: [
          emptyPayment({ label: "First", amount: { mode: "percent", percent: 50 }, timing: { kind: "before_arrival", days: 30 } }),
          emptyPayment({ label: "Fixed", amount: { mode: "percent", percent: 20 }, timing: { kind: "fixed_date", date: "2027-06-01" } }),
          emptyPayment({
            label: "Monthly",
            amount: { mode: "remainder" },
            timing: { kind: "after_acceptance", days: 0 },
          }),
        ],
      }),
      "2027-01-10",
      "2027-07-01"
    );
    expect(rows.map((r) => [r.label, r.due_date, r.amount_zar])).toEqual([
      ["Monthly", "2027-01-10", 300],
      ["First", "2027-06-01", 500],
      ["Fixed", "2027-06-01", 200],
    ]);
  });
});

describe("designFromCharges — FFX 2027 template", () => {
  it("round-trips: same tier totals and the same per-student schedule", () => {
    const d = designFromCharges(FFX_2027_PROGRAM_TEMPLATE.wholeProgram);
    expect(d.tierPrices).toEqual({ A: 120000, B: 99500, C: 80000 });
    expect(d.payments.map((p) => p.label)).toEqual(["Deposit", "Monthly Tuition", "Outreach"]);
    expect(d.payments[1].itemCodes).toEqual({
      A: "FFXYL2027-MON-A",
      B: "FFXYL2027-MON-B",
      C: "FFXYL2027-MON-C",
    });
    expect(d.payments[2].trackingOption).toBe("Gap Year 2027");

    const r = compileSchedule(d, noArrival);
    expect(r.errors).toEqual([]);
    expect(r.tiers.map((t) => t.difference)).toEqual([0, 0, 0]);

    // Same rows as the hand-made template produces for a student.
    const ctx = { acceptanceDate: "2026-11-01", paymentPreference: "standard" as const, today: "2026-11-01" };
    const fromTemplate = buildSchedule(
      FFX_2027_PROGRAM_TEMPLATE.wholeProgram.B as unknown as BuilderChargeItem[],
      ctx
    ).rows.map((r) => [r.due_date, r.amount_zar, r.xero_item_code]);
    const fromDesign = buildSchedule(
      r.items.filter((i) => i.tier === "B") as unknown as BuilderChargeItem[],
      ctx
    ).rows.map((r) => [r.due_date, r.amount_zar, r.xero_item_code]);
    expect(fromDesign).toEqual(fromTemplate);
  });

  it("converts the standalone quarters too, keeping arrival-relative timing", () => {
    const ffbx = FFX_2027_PROGRAM_TEMPLATE.courses.find((c) => c.code.startsWith("FFBX"))!;
    const d = designFromCharges(ffbx.charges);
    expect(d.payments[0].timing).toEqual({ kind: "before_arrival", days: 30 });
    expect(d.payments[1].timing).toEqual({ kind: "before_arrival", days: 0 });
    expect(compileSchedule(d, { hasArrivalDate: true }).tiers.map((t) => t.difference)).toEqual([0, 0, 0]);
  });
});
