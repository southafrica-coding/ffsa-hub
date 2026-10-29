import { describe, expect, it } from "vitest";
import { amountToCents, effectiveMultiplier, lineTotalCents, toHundredths } from "./budget-lines";

describe("toHundredths — what numeric(10,2) stores", () => {
  it.each([
    [12, BigInt(1200)],
    [1.15, BigInt(115)],
    [1.155, BigInt(116)],
    [1.145, BigInt(115)],
    ["0.333", BigInt(33)],
    ["0.335", BigInt(34)],
    [0.005, BigInt(1)],
    [0.004, BigInt(0)],
    ["  8 ", BigInt(800)],
    [".5", BigInt(50)],
    ["7.", BigInt(700)],
    [1e-7, BigInt(0)],
    [-1.155, BigInt(-116)],
  ] as const)("%s → %s", (input, expected) => {
    expect(toHundredths(input)).toBe(expected);
  });

  it("refuses things that are not numbers", () => {
    expect(() => toHundredths("")).toThrow();
    expect(() => toHundredths("abc")).toThrow();
    expect(() => toHundredths(".")).toThrow();
  });
});

describe("lineTotalCents — mirrors the migration 278 trigger", () => {
  it("repeating cost: R190 × 12 times × 8 people = R18,240", () => {
    expect(lineTotalCents({ amount_cents: 19000, frequency: 12, multiplier: 8 })).toBe(1824000);
  });

  it("one-off purchase: R2,400 × 1 × 2 items = R4,800", () => {
    expect(lineTotalCents({ amount_cents: 240000, frequency: 1, multiplier: 2 })).toBe(480000);
  });

  it("rounds half away from zero like Postgres, where floats would round down", () => {
    // 15c × 4.1 = 61.5 exactly; in floats it is 61.49999999999999 and rounds to 61.
    expect(Math.round(15 * 4.1)).toBe(61);
    expect(lineTotalCents({ amount_cents: 15, frequency: 4.1, multiplier: 1 })).toBe(62);
    expect(lineTotalCents({ amount_cents: 1, frequency: 1.15, multiplier: 10 })).toBe(12);
  });

  it("uses frequency and multiplier as stored (2 decimals), not as typed", () => {
    // 0.333 is stored as 0.33: 333 × 0.33 = 109.89 → 110 (with 0.333 it would be 111).
    expect(lineTotalCents({ amount_cents: 333, frequency: 0.333, multiplier: 1 })).toBe(110);
  });

  it("accepts the strings Supabase returns for numeric columns", () => {
    expect(lineTotalCents({ amount_cents: 19000, frequency: "12.00", multiplier: "8.00" })).toBe(1824000);
  });

  it("zero anywhere gives zero", () => {
    expect(lineTotalCents({ amount_cents: 0, frequency: 12, multiplier: 8 })).toBe(0);
    expect(lineTotalCents({ amount_cents: 500, frequency: 0, multiplier: 8 })).toBe(0);
  });

  it("follows the budget's driver when uses_driver is on, ignoring the typed multiplier", () => {
    const line = { amount_cents: 15000, frequency: 1, multiplier: 99, uses_driver: true };
    expect(lineTotalCents(line, 8)).toBe(120000);
    expect(lineTotalCents(line, "8.00")).toBe(120000);
    expect(lineTotalCents(line, null)).toBe(0); // no driver set yet → 0, as in the trigger
    expect(lineTotalCents({ ...line, uses_driver: false }, 8)).toBe(1485000);
  });

  it("stays exact for large budgets", () => {
    // R9,999,999.99 × 9,999.99 × 1 — beyond float precision once in hundredths.
    expect(lineTotalCents({ amount_cents: 999999999, frequency: "9999.99", multiplier: 1 })).toBe(9999989990000);
  });

  it("refuses fractional cents", () => {
    expect(() => lineTotalCents({ amount_cents: 1.5, frequency: 1, multiplier: 1 })).toThrow();
  });
});

describe("effectiveMultiplier", () => {
  it("is the typed multiplier unless the line follows the driver", () => {
    expect(effectiveMultiplier({ multiplier: 3, uses_driver: false }, 8)).toBe(3);
    expect(effectiveMultiplier({ multiplier: 3, uses_driver: true }, 8)).toBe(8);
    expect(effectiveMultiplier({ multiplier: 3, uses_driver: true }, undefined)).toBe(0);
  });
});

describe("amountToCents", () => {
  it.each([
    ["2,400.50", 240050],
    ["R 190", 19000],
    [190, 19000],
    ["0.005", 1],
    ["", null],
    ["abc", null],
    [null, null],
  ] as const)("%s → %s", (input, expected) => {
    expect(amountToCents(input)).toBe(expected);
  });
});
