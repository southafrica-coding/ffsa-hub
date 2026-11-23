// ────────────────────────────────────────────────────────────
// Missio Finance — checking a cash / FundraiseUp entry from the form
// ────────────────────────────────────────────────────────────

import { DEFAULT_FROM_MONTH, isMonthKey, parseAmountToCents, parseRateMicros, formatRate } from "./report";

/** Who may open the finance report and enter amounts: Missio pastors. */
export const MISSIO_FINANCE_ROLES = ["pastor"] as const;

/** Biggest single month we accept, R10m / $1m: a typo guard, not a policy. */
const MAX_ZAR_CENTS = 1_000_000_000;
const MAX_USD_CENTS = 100_000_000;

export type EntryToSave =
  | { source: "cash"; month: string; cashCents: number; note: string | null }
  | { source: "fundraiseup"; month: string; usdCents: number; rate: string; rateNote: string | null; note: string | null };

function text(value: unknown, max: number): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  if (!t) return null;
  return t.length > max ? undefined : t;
}

function amount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? parseAmountToCents(value.toFixed(2)) : null;
  return typeof value === "string" ? parseAmountToCents(value) : null;
}

/**
 * The POST body: { source, month: "YYYY-MM", amount } for cash;
 * { source, month, usd, rate, rateNote? } for FundraiseUp. Months can't be
 * in the future or before the report's first month.
 */
export function readEntryInput(
  raw: unknown,
  today: string
): { ok: true; entry: EntryToSave } | { ok: false; fieldErrors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const source = body.source;
  if (source !== "cash" && source !== "fundraiseup") errors.source = "Choose cash or FundraiseUp.";

  const month = typeof body.month === "string" ? body.month : "";
  if (!isMonthKey(month) || month < DEFAULT_FROM_MONTH || month > today.slice(0, 7)) {
    errors.month = "Choose a month from July 2026 to this month.";
  }

  const note = text(body.note, 500);
  if (note === undefined) errors.note = "Keep the note under 500 characters.";

  if (source === "cash") {
    const cents = amount(body.amount);
    if (cents === null || cents > MAX_ZAR_CENTS) errors.amount = "Enter the rand amount, like 1900 or 1,900.00.";
    if (Object.keys(errors).length) return { ok: false, fieldErrors: errors };
    return { ok: true, entry: { source, month, cashCents: cents!, note: note ?? null } };
  }

  if (source === "fundraiseup") {
    const usd = amount(body.usd);
    if (usd === null || usd > MAX_USD_CENTS) errors.usd = "Enter the dollars after fees, like 1250.40.";
    const micros = typeof body.rate === "string" ? parseRateMicros(body.rate) : typeof body.rate === "number" ? parseRateMicros(String(body.rate)) : null;
    if (micros === null) errors.rate = "Enter rand per dollar, like 18.25.";
    const rateNote = text(body.rateNote, 200);
    if (rateNote === undefined) errors.rateNote = "Keep this under 200 characters.";
    if (Object.keys(errors).length) return { ok: false, fieldErrors: errors };
    return {
      ok: true,
      entry: { source, month, usdCents: usd!, rate: formatRate(micros!), rateNote: rateNote ?? null, note: note ?? null },
    };
  }

  return { ok: false, fieldErrors: errors };
}

export function readEntryKey(params: URLSearchParams): { source: "cash" | "fundraiseup"; month: string } | null {
  const source = params.get("source");
  const month = params.get("month") ?? "";
  if ((source !== "cash" && source !== "fundraiseup") || !isMonthKey(month)) return null;
  return { source, month };
}
