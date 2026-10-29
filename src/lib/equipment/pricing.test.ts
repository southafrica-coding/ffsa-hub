import { describe, it, expect } from "vitest";
import { isWeekend, periodForDates, quote, unitPrice, type QuoteProduct } from "./pricing";

// The SM58 from frame 46b: R 120 day, R 200 weekend, R 450 week, R 250 deposit.
const sm58: QuoteProduct = {
  id: "sm58",
  price_day_cents: 12_000,
  price_weekend_cents: 20_000,
  price_week_cents: 45_000,
  deposit_cents: 25_000,
  internal_day_cents: 0,
};
const dayOnly: QuoteProduct = {
  id: "fan",
  price_day_cents: 5_000,
  price_weekend_cents: null,
  price_week_cents: null,
  deposit_cents: 0,
  internal_day_cents: 1_000,
};
const settings = { vat_bps: 1500, waiver_bps: 1000 };

// 6 Nov 2026 is a Friday.
const FRI = "2026-11-06";
const MON = "2026-11-09";

describe("rate period", () => {
  it("treats anything inside one Fri → Mon as a weekend", () => {
    expect(isWeekend(FRI, MON)).toBe(true);
    expect(isWeekend("2026-11-07", "2026-11-08")).toBe(true); // Sat–Sun
    expect(isWeekend(FRI, "2026-11-10")).toBe(false); // into Tuesday
    expect(isWeekend("2026-11-04", "2026-11-06")).toBe(false); // starts Wednesday
  });

  it("names 5–7 days a week and anything else days", () => {
    expect(periodForDates(FRI, MON)).toBe("weekend");
    expect(periodForDates("2026-11-02", "2026-11-06")).toBe("week"); // Mon–Fri, 5 days
    expect(periodForDates("2026-11-02", "2026-11-08")).toBe("week"); // 7 days
    expect(periodForDates("2026-11-03", "2026-11-05")).toBe("day"); // Tue–Thu
    expect(periodForDates("2026-11-02", "2026-11-11")).toBe("day"); // 10 days
  });
});

describe("unitPrice: the cheapest period that covers the dates", () => {
  it("uses day × days when that is cheapest", () => {
    expect(unitPrice(sm58, 2, false)).toEqual({ cents: 24_000, period: "day" });
  });
  it("lets a week beat four days", () => {
    expect(unitPrice(sm58, 4, false)).toEqual({ cents: 45_000, period: "week" });
  });
  it("prices 10 days as a week plus three days, not two weeks", () => {
    expect(unitPrice(sm58, 10, false)).toEqual({ cents: 45_000 + 36_000, period: "week" });
  });
  it("prices 13 days as two weeks when that is cheaper", () => {
    expect(unitPrice(sm58, 13, false)).toEqual({ cents: 90_000, period: "week" });
  });
  it("skips periods the product has no price for", () => {
    expect(unitPrice(dayOnly, 4, true)).toEqual({ cents: 20_000, period: "day" });
    expect(unitPrice({ ...dayOnly, price_day_cents: null }, 1, false)).toBeNull();
  });
});

describe("quote", () => {
  it("matches the 46b item box: 2 × SM58 over a weekend", () => {
    const q = quote([{ product: sm58, quantity: 2 }], FRI, MON, "external", settings);
    expect(q.period).toBe("weekend");
    expect(q.days).toBe(4);
    expect(q.lines[0]).toMatchObject({ period: "weekend", unitPriceCents: 20_000, lineTotalCents: 40_000 });
    expect(q.subtotalCents).toBe(40_000);
    expect(q.depositCents).toBe(50_000);
  });

  it("charges VAT on hire plus the waiver (checkout 46d: R 2 350 → R 235 → R 387.75)", () => {
    const p: QuoteProduct = { ...dayOnly, price_day_cents: 235_000 };
    const q = quote([{ product: p, quantity: 1 }], "2026-11-03", "2026-11-03", "external", settings);
    expect(q.subtotalCents).toBe(235_000);
    expect(q.waiverCents).toBe(23_500);
    expect(q.vatCents).toBe(38_775);
    expect(q.totalCents).toBe(235_000 + 23_500 + 38_775);
  });

  it("sums several lines, each on its own cheapest period", () => {
    const q = quote(
      [
        { product: sm58, quantity: 1 },
        { product: dayOnly, quantity: 3 },
      ],
      FRI,
      MON,
      "external",
      settings
    );
    expect(q.lines.map((l) => l.period)).toEqual(["weekend", "day"]);
    expect(q.subtotalCents).toBe(20_000 + 3 * 4 * 5_000);
  });

  it("prices internal orders at the ministry rate, with no deposit or waiver", () => {
    const q = quote(
      [
        { product: sm58, quantity: 2 },
        { product: dayOnly, quantity: 1 },
      ],
      FRI,
      MON,
      "internal",
      settings
    );
    expect(q.subtotalCents).toBe(4 * 1_000);
    expect(q.depositCents).toBe(0);
    expect(q.waiverCents).toBe(0);
    expect(q.vatCents).toBe(600);
  });

  it("flags a line with no price instead of charging it", () => {
    const q = quote(
      [{ product: { ...dayOnly, price_day_cents: null }, quantity: 1 }],
      FRI,
      MON,
      "external",
      settings
    );
    expect(q.lines[0].priced).toBe(false);
    expect(q.totalCents).toBe(0);
  });
});
