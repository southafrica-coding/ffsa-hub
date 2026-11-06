/**
 * How the budget sheet reads GET /api/finance/budgets/[id]/actuals.
 *
 * The route lives on the finance backend. This file only interprets its
 * JSON. A missing table (503 schema_not_applied), a failed read, or an
 * uncoded line is unknown — never a made-up R0. Outreach expenses are
 * not an input here.
 */

import { currencyFromRecord, formatBudgetMoney, type BudgetCurrency } from "@/lib/finance/budget-sheet";

export type BudgetActualLine = {
  lineId: string;
  name: string;
  plannedCents: number;
  actualCents: number | null;
  differenceCents: number | null;
};

export type BudgetActualsBody = {
  budgetId: string;
  name: string;
  currency: string;
  source: "xero";
  period: { start: string; end: string };
  region: string;
  lines: BudgetActualLine[];
  unmatched: { count: number; cents: number };
  xero: { ok: true; partial: boolean } | { ok: false; reason: string };
};

export type ActualsView =
  | { kind: "unavailable"; message: string }
  | { kind: "ready"; data: BudgetActualsBody };

const NOT_ZERO = "They are not shown as zero.";

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function wholeCents(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(value);
}

function parseLine(value: unknown): BudgetActualLine | null {
  const row = record(value);
  if (!row) return null;
  const lineId = typeof row.lineId === "string" ? row.lineId : "";
  const name = typeof row.name === "string" ? row.name : "";
  const plannedCents = wholeCents(row.plannedCents);
  if (!lineId || !name || plannedCents === null) return null;
  const actualCents = row.actualCents === null ? null : wholeCents(row.actualCents);
  const differenceCents = row.differenceCents === null ? null : wholeCents(row.differenceCents);
  if (row.actualCents !== null && actualCents === null) return null;
  if (row.differenceCents !== null && differenceCents === null) return null;
  return { lineId, name, plannedCents, actualCents, differenceCents };
}

export function parseBudgetActuals(value: unknown): BudgetActualsBody | null {
  const body = record(value);
  if (!body || body.source !== "xero") return null;
  const budgetId = typeof body.budgetId === "string" ? body.budgetId : "";
  const name = typeof body.name === "string" ? body.name : "";
  const currency = typeof body.currency === "string" ? body.currency : "";
  const period = record(body.period);
  const start = typeof period?.start === "string" ? period.start : "";
  const end = typeof period?.end === "string" ? period.end : "";
  const region = typeof body.region === "string" ? body.region : "";
  const unmatched = record(body.unmatched);
  const count = wholeCents(unmatched?.count);
  const cents = wholeCents(unmatched?.cents);
  const xero = record(body.xero);
  if (!budgetId || !name || !currency || !start || !end || !region || count === null || cents === null || !xero) return null;
  if (!Array.isArray(body.lines)) return null;
  const lines: BudgetActualLine[] = [];
  for (const item of body.lines) {
    const line = parseLine(item);
    if (!line) return null;
    lines.push(line);
  }
  if (xero.ok === true && typeof xero.partial === "boolean") {
    return {
      budgetId,
      name,
      currency,
      source: "xero",
      period: { start, end },
      region,
      lines,
      unmatched: { count, cents },
      xero: { ok: true, partial: xero.partial },
    };
  }
  if (xero.ok === false && typeof xero.reason === "string") {
    return {
      budgetId,
      name,
      currency,
      source: "xero",
      period: { start, end },
      region,
      lines,
      unmatched: { count, cents },
      xero: { ok: false, reason: xero.reason },
    };
  }
  return null;
}

export function interpretActuals(status: number, body: unknown): ActualsView {
  const error = typeof record(body)?.error === "string" ? String(record(body)?.error) : "";
  const code = record(body)?.code;
  if (status === 503 || code === "schema_not_applied") {
    return {
      kind: "unavailable",
      message:
        error ||
        `Budget tables are not in the database yet. Actuals stay unread until then. ${NOT_ZERO}`,
    };
  }
  if (status === 403) {
    return { kind: "unavailable", message: "You don't have permission to see finance data from Xero." };
  }
  if (status === 404) {
    if (/budget not found/i.test(error)) {
      return { kind: "unavailable", message: `That budget wasn't found, so actuals weren't read. ${NOT_ZERO}` };
    }
    return { kind: "unavailable", message: `Xero actuals aren't available on the Hub yet. ${NOT_ZERO}` };
  }
  if (status === 400) {
    return {
      kind: "unavailable",
      message: error || `This budget can't be read against Xero yet. ${NOT_ZERO}`,
    };
  }
  if (status !== 200) {
    return { kind: "unavailable", message: `Xero actuals couldn't be read. ${NOT_ZERO}` };
  }
  const data = parseBudgetActuals(body);
  if (!data) {
    return { kind: "unavailable", message: `Xero actuals came back in a shape this sheet doesn't understand. ${NOT_ZERO}` };
  }
  return { kind: "ready", data };
}

export function xeroProblemCopy(reason: string): string {
  if (reason === "not_connected") return "Xero isn't connected. Actuals are unknown, not zero.";
  if (reason === "xero") return "Xero didn't answer. Actuals are unknown, not zero.";
  return "Xero couldn't be read. Actuals are unknown, not zero.";
}

/** Null is unknown (uncoded, or Xero unread). Zero is a real coded line with no spend. */
export function actualAmountLabel(cents: number | null, currency: string | null): string {
  if (cents === null) return "Unknown";
  return formatBudgetMoney(cents, currencyFromRecord(currency));
}

export function actualsCurrency(currency: string | null | undefined): BudgetCurrency | null {
  return currencyFromRecord(currency);
}

/** A total of actuals only when every line was coded and read. */
export function actualsTotalCents(lines: BudgetActualLine[]): number | null {
  if (lines.length === 0) return null;
  let total = 0;
  for (const line of lines) {
    if (line.actualCents === null) return null;
    total += line.actualCents;
  }
  return total;
}
