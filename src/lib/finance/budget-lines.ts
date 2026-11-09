/**
 * Budget lines (migration 296): the arithmetic.
 *
 * A line is `amount × frequency × multiplier`, with the amount in cents.
 * The database trigger `budget_lines_before_write` is the source of truth
 * for the stored `line_total_cents`; `lineTotalCents` here is the same sum
 * so a screen can show the total the instant someone types, before a save.
 *
 * It has to agree with Postgres to the cent, so it never multiplies
 * floats: frequency and multiplier are numeric(10,2) columns, so they are
 * rounded to hundredths the way Postgres stores them (half away from
 * zero), and the product is done in BigInt. `15c × 4.1` is 61.5 cents here
 * and in the database (→ 62), where floats say 61.4999… and round down.
 */

// BigInt(…) rather than 100n literals: the tsconfig target predates ES2020.
const ZERO = BigInt(0);
const ONE = BigInt(1);
const HUNDRED = BigInt(100);
const HALF_UNIT = BigInt(5000);
const UNIT = BigInt(10000);

export type BudgetLineKind = "fixed" | "variable";
export type BudgetCodingStatus = "inherited" | "overridden" | "needs_coding";

export type BudgetLineMath = {
  amount_cents: number;
  frequency: number | string;
  multiplier: number | string;
  uses_driver?: boolean;
};

/**
 * A decimal as a whole number of hundredths, rounded half away from zero —
 * what Postgres does when it stores a value in numeric(10,2).
 * 1.155 → 116n, "0.333" → 33n, 12 → 1200n.
 */
export function toHundredths(value: number | string): bigint {
  let s = typeof value === "number" ? String(value) : value.trim();
  if (/e/i.test(s)) s = Number(s).toFixed(20);
  const m = /^([+-])?(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) throw new Error(`Not a number: ${value}`);
  const negative = m[1] === "-";
  const whole = BigInt(m[2] || "0");
  const frac = (m[3] ?? "").padEnd(3, "0");
  let hundredths = whole * HUNDRED + BigInt(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) hundredths += ONE;
  return negative ? -hundredths : hundredths;
}

/** The multiplier a line really uses: the budget's driver when it follows it (none set → 0). */
export function effectiveMultiplier(
  line: Pick<BudgetLineMath, "multiplier" | "uses_driver">,
  driverValue: number | string | null | undefined
): number | string {
  if (!line.uses_driver) return line.multiplier;
  return driverValue ?? 0;
}

/**
 * round(amount_cents × frequency × multiplier), exactly as the trigger
 * computes it. Pass the budget's driver for lines with uses_driver.
 */
export function lineTotalCents(line: BudgetLineMath, driverValue?: number | string | null): number {
  if (!Number.isInteger(line.amount_cents)) throw new Error("amount_cents must be a whole number of cents");
  const amount = BigInt(line.amount_cents);
  const product = amount * toHundredths(line.frequency) * toHundredths(effectiveMultiplier(line, driverValue));
  // product is in ten-thousandths of a cent; round half away from zero.
  const negative = product < ZERO;
  const abs = negative ? -product : product;
  const rounded = (abs + HALF_UNIT) / UNIT;
  return Number(negative ? -rounded : rounded);
}

/** Cents → rand/dollar amount for display arithmetic (never for storage). */
export function centsToAmount(cents: number): number {
  return cents / 100;
}

/** A typed amount ("2,400.50", 2400.5) → whole cents. Blank / junk → null. */
export function amountToCents(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const s = typeof value === "number" ? String(value) : value.replace(/[\s,R$]/g, "");
  if (s === "" || !/^[+-]?\d*(\.\d*)?(e[+-]?\d+)?$/i.test(s)) return null;
  try {
    return Number(toHundredths(s));
  } catch {
    return null;
  }
}
