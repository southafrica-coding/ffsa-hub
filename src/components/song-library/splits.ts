/**
 * Writers' splits. Credits / splits can be agreed only when the splits add
 * up to exactly 100%. Amounts are percentages with up to two decimals, so
 * the sum is done in hundredths to avoid float drift (33.33 + 33.33 + 33.34).
 */

export interface SplitRow {
  split_pct: number | null;
}

export type SplitCheck =
  | { ok: true; totalPct: number }
  | { ok: false; totalPct: number; reason: "empty" | "under" | "over" | "missing"; message: string };

function hundredths(value: number): number {
  return Math.round(value * 100);
}

export function splitsTotal(rows: readonly SplitRow[]): number {
  const sum = rows.reduce((acc, row) => acc + (row.split_pct == null ? 0 : hundredths(row.split_pct)), 0);
  return sum / 100;
}

function pct(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(2).replace(/0$/, "")}%`;
}

export function checkSplits(rows: readonly SplitRow[]): SplitCheck {
  const totalPct = splitsTotal(rows);
  if (rows.length === 0) {
    return { ok: false, totalPct, reason: "empty", message: "Add the writers and their splits first." };
  }
  if (rows.some((row) => row.split_pct == null)) {
    return { ok: false, totalPct, reason: "missing", message: "Give every writer a split before credits can be agreed." };
  }
  const total = hundredths(totalPct);
  if (total === 10_000) return { ok: true, totalPct };
  if (total < 10_000) {
    return {
      ok: false,
      totalPct,
      reason: "under",
      message: `Splits add up to ${pct(totalPct)}. Add ${pct((10_000 - total) / 100)} somewhere before credits can be agreed.`,
    };
  }
  return {
    ok: false,
    totalPct,
    reason: "over",
    message: `Splits add up to ${pct(totalPct)}. Take off ${pct((total - 10_000) / 100)} before credits can be agreed.`,
  };
}

/** Whether the credits_splits_agreed checkpoint may be ticked. */
export function canAgreeCredits(rows: readonly SplitRow[]): boolean {
  return checkSplits(rows).ok;
}
