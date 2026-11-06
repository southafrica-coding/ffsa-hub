/**
 * Budget actuals come from Xero spend lines, matched to a budget line by
 * its account and tracking. Outreach expense rows are not an actual.
 * A line with no account is left unknown — it is not reported as R0.
 */

export type ActualTracking = { name: string; option: string };

export type ActualLineInput = {
  lineId: string;
  name: string;
  plannedCents: number;
  /** Null until finance has coded the line. Then actuals can't be matched. */
  accountCode: string | null;
  tracking: ActualTracking[];
};

export type XeroActualSpend = {
  bankTransactionId: string;
  accountCode: string | null;
  amountCents: number;
  tracking: ActualTracking[];
};

export type AttributedLine = {
  lineId: string;
  name: string;
  plannedCents: number;
  /** Null when the line isn't coded, or when Xero itself couldn't be read. */
  actualCents: number | null;
  differenceCents: number | null;
};

export type ActualsAttribution = {
  lines: AttributedLine[];
  unmatched: { count: number; cents: number };
};

const norm = (s: string) => s.trim().toLowerCase();

function sameTracking(a: ActualTracking, b: ActualTracking): boolean {
  return norm(a.name) === norm(b.name) && norm(a.option) === norm(b.option);
}

function matches(line: ActualLineInput, spend: XeroActualSpend): boolean {
  if (!line.accountCode || !spend.accountCode) return false;
  if (norm(line.accountCode) !== norm(spend.accountCode)) return false;
  // A line with no tracking does not swallow every spend on that account.
  // It only matches a spend that also has no tracking.
  if (line.tracking.length === 0) return spend.tracking.length === 0;
  return line.tracking.every((t) => spend.tracking.some((s) => sameTracking(t, s)));
}

/** Positive spend only. A refund (negative line) is not turned into spend. */
export function xeroLineSpendCents(amount: number): number | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 100);
}

/**
 * Each Xero line is given to at most one budget line, including lines
 * passed in from other budgets. Two lines that fit equally well leave the
 * spend unmatched, so it is never counted twice. A line with no tracking
 * does not take spend that has tracking.
 */
export function attributeActuals(lines: ActualLineInput[], spends: XeroActualSpend[]): ActualsAttribution {
  const assigned = new Map<string, number>();
  let unmatchedCount = 0;
  let unmatchedCents = 0;

  for (const spend of spends) {
    const hits = lines.filter((line) => matches(line, spend));
    const best = hits.reduce((max, line) => Math.max(max, line.tracking.length), -1);
    const winners = hits.filter((line) => line.tracking.length === best);
    if (winners.length !== 1) {
      unmatchedCount += 1;
      unmatchedCents += spend.amountCents;
      continue;
    }
    assigned.set(winners[0].lineId, (assigned.get(winners[0].lineId) ?? 0) + spend.amountCents);
  }

  return {
    lines: lines.map((line) => {
      if (!line.accountCode) {
        return { lineId: line.lineId, name: line.name, plannedCents: line.plannedCents, actualCents: null, differenceCents: null };
      }
      const actualCents = assigned.get(line.lineId) ?? 0;
      return {
        lineId: line.lineId,
        name: line.name,
        plannedCents: line.plannedCents,
        actualCents,
        differenceCents: line.plannedCents - actualCents,
      };
    }),
    unmatched: { count: unmatchedCount, cents: unmatchedCents },
  };
}

/** Xero's Date is either yyyy-mm-dd or /Date(ms+0000)/. */
export function xeroDateOnly(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  if (iso) return iso[1];
  const ms = /\/Date\((-?\d+)/.exec(value);
  if (!ms) return null;
  const date = new Date(Number(ms[1]));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

export function regionForBudgetCurrency(currency: string | null | undefined): "za" | "us" {
  return (currency ?? "").toUpperCase() === "USD" ? "us" : "za";
}

/** PostgREST / Postgres when the budget tables from the updated PR #475 are not applied yet. */
export function isMissingRelation(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const msg = `${error.code ?? ""} ${error.message ?? ""}`;
  return error.code === "42P01" || error.code === "PGRST205" || /could not find the table|does not exist|schema cache/i.test(msg);
}
