/**
 * Sheet-shaped budget workbook: the empty "Team budget (standard)" shape.
 *
 * Money is integer cents of the South Africa organisation's record currency
 * (ZAR). A line total is round(amount × frequency × multiplier), the same
 * sum the database trigger stores. Fixed lines keep frequency 1. A variable
 * line may follow the budget driver instead of a typed multiplier.
 *
 * "What this covers" has no column. The Notes tab is budgets.notes.
 * Coding is not accepted here.
 */

const ZERO = BigInt(0);
const ONE = BigInt(1);
const HUNDRED = BigInt(100);
const HALF_UNIT = BigInt(5000);
const UNIT = BigInt(10000);

export const TEAM_BUDGET_TEMPLATE_KEY = "team_standard";

export const BUDGET_OWNER_KINDS = [
  "staff_ministry",
  "ministry_subcategory",
  "program",
  "event",
  "outreach_team",
] as const;

export type BudgetOwnerKind = (typeof BUDGET_OWNER_KINDS)[number];

export const PERIOD_KINDS = ["year", "term", "event"] as const;
export type PeriodKind = (typeof PERIOD_KINDS)[number];

export const SCHEMA_NOT_APPLIED = {
  error: "Saving a budget isn't available yet. The workbook tables aren't in the database.",
  code: "schema_not_applied" as const,
};

const MAX_LINES = 400;
const MAX_EXPENSES = 400;
const MAX_CENTS = 100_000_000_000_000;

const CODING_KEYS = [
  "accountId",
  "account_id",
  "accountCode",
  "account_code",
  "glCode",
  "gl_code",
  "xeroCode",
  "xero_code",
  "xeroAccountId",
  "xero_account_id",
  "trackingOption1Id",
  "tracking_option_1_id",
  "trackingOption2Id",
  "tracking_option_2_id",
  "orgRegion",
  "org_region",
  "coding",
  "budget_line_coding",
  "budgetLineCoding",
  "categoryId",
  "category_id",
] as const;

const XERO_SPEND_KEYS = ["xeroSpends", "xero_spends", "budget_xero_spends", "budgetXeroSpends"] as const;

export type WorkbookLineInput = {
  id?: string;
  kind: "fixed" | "variable";
  name: string;
  amountCents: number;
  frequency: number;
  multiplier: number;
  usesDriver: boolean;
  notes: string | null;
  sort: number;
};

export type WorkbookExpenseInput = {
  id?: string;
  lineId: string | null;
  expenseDate: string;
  vendor: string | null;
  description: string;
  amountCents: number;
  reference: string | null;
  notes: string | null;
};

export type WorkbookPeriodInput = {
  kind: PeriodKind;
  label: string;
  start: string;
  end: string;
};

export type WorkbookWrite = {
  name?: string;
  ownerKind?: BudgetOwnerKind;
  ownerId?: string;
  /** Checked against the South Africa org. Never used to pick a US org. */
  orgId?: string;
  periodId?: string;
  period?: WorkbookPeriodInput;
  driverLabel?: string | null;
  driverValue?: number | null;
  fundingGoalCents?: number | null;
  fundsInHandCents?: number | null;
  incomeGoalCents?: number | null;
  fundraisingGoalCents?: number | null;
  notes?: string | null;
  lines?: WorkbookLineInput[];
  expenses?: WorkbookExpenseInput[];
  /** Sent status, when the caller echoed the current one. A change is rejected earlier. */
  status?: string;
  present: {
    name: boolean;
    ownerKind: boolean;
    ownerId: boolean;
    periodId: boolean;
    period: boolean;
    driverLabel: boolean;
    driverValue: boolean;
    fundingGoalCents: boolean;
    fundsInHandCents: boolean;
    incomeGoalCents: boolean;
    fundraisingGoalCents: boolean;
    notes: boolean;
    lines: boolean;
    expenses: boolean;
    status: boolean;
  };
  ignored: string[];
};

export type SouthAfricaOrg = {
  id: string;
  key: string;
  name: string;
  record_currency: string;
  is_active: boolean;
};

export function isSouthAfricaOrg(org: Partial<SouthAfricaOrg> | null | undefined): org is SouthAfricaOrg {
  return !!org && org.key === "npc" && org.record_currency === "ZAR" && org.is_active !== false && typeof org.id === "string";
}

export function isBudgetSchemaMissing(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const msg = `${error.code ?? ""} ${error.message ?? ""}`;
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    error.code === "PGRST202" ||
    error.code === "42883" ||
    /could not find the table|could not find the function|schema cache/i.test(msg) ||
    /function .* does not exist|relation .* does not exist/i.test(msg)
  );
}

/** Hundredths, rounded half away from zero — numeric(10,2) as Postgres stores it. */
export function toHundredths(value: number | string): bigint {
  let s = typeof value === "number" ? String(value) : value.trim();
  if (/e/i.test(s)) s = Number(s).toFixed(20);
  const match = /^([+-])?(\d*)(?:\.(\d*))?$/.exec(s);
  if (!match || (match[2] === "" && (match[3] ?? "") === "")) throw new Error(`Not a number: ${value}`);
  const negative = match[1] === "-";
  const whole = BigInt(match[2] || "0");
  const frac = (match[3] ?? "").padEnd(3, "0");
  let hundredths = whole * HUNDRED + BigInt(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) hundredths += ONE;
  return negative ? -hundredths : hundredths;
}

export function roundNumeric(value: number | string): number {
  return Number(toHundredths(value)) / 100;
}

/** A typed amount ("2,400.50", 190) → whole cents. Blank or junk → null. */
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

/**
 * round(amount_cents × frequency × multiplier). Pass the driver already
 * applied, or the typed multiplier. Half away from zero, in cents.
 */
export function lineTotalCents(line: {
  amount_cents: number;
  frequency: number | string;
  multiplier: number | string;
}): number {
  if (!Number.isInteger(line.amount_cents)) throw new Error("amount_cents must be a whole number of cents");
  const product = BigInt(line.amount_cents) * toHundredths(line.frequency) * toHundredths(line.multiplier);
  const negative = product < ZERO;
  const abs = negative ? -product : product;
  const rounded = (abs + HALF_UNIT) / UNIT;
  return Number(negative ? -rounded : rounded);
}

/** The multiplier a variable line stores when it follows the driver. None set → 0. */
export function multiplierForLine(line: { multiplier: number; usesDriver: boolean }, driverValue: number | null): number {
  if (!line.usesDriver) return line.multiplier;
  return driverValue ?? 0;
}

/** The stored total, or null when it cannot be represented as a safe integer of cents. */
export function safeLineTotal(line: { amount_cents: number; frequency: number; multiplier: number }): number | null {
  try {
    const total = lineTotalCents(line);
    if (!Number.isSafeInteger(total)) return null;
    return total;
  } catch {
    return null;
  }
}

export function numberFromDb(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

export function centsFromDb(value: unknown): number | null {
  const n = numberFromDb(value);
  if (n === null) return null;
  return Math.round(n);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function isOwnerKind(value: string): value is BudgetOwnerKind {
  return (BUDGET_OWNER_KINDS as readonly string[]).includes(value);
}

function isPeriodKind(value: string): value is PeriodKind {
  return (PERIOD_KINDS as readonly string[]).includes(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  return value.slice(0, max);
}

function hasCodingKey(record: Record<string, unknown>): boolean {
  return CODING_KEYS.some((key) => record[key] !== undefined);
}

function hasXeroSpendKey(record: Record<string, unknown>): boolean {
  return XERO_SPEND_KEYS.some((key) => record[key] !== undefined);
}

type ParseResult = { ok: true; value: WorkbookWrite } | { ok: false; error: string };

function parseOptionalCents(
  record: Record<string, unknown>,
  centsKey: string,
  majorKey: string
): { ok: true; present: boolean; cents: number | null } | { ok: false; error: string } {
  const hasCents = record[centsKey] !== undefined;
  const hasMajor = record[majorKey] !== undefined;
  if (!hasCents && !hasMajor) return { ok: true, present: false, cents: null };
  if (hasCents) {
    if (record[centsKey] === null) return { ok: true, present: true, cents: null };
    if (typeof record[centsKey] !== "number" || !Number.isInteger(record[centsKey])) {
      return { ok: false, error: "Amounts are whole cents, or a number of rand." };
    }
    if (record[centsKey] < 0 || record[centsKey] > MAX_CENTS) {
      return { ok: false, error: "That amount is out of range." };
    }
    if (hasMajor && record[majorKey] !== null && record[majorKey] !== "") {
      const major = amountToCents(record[majorKey] as number | string);
      if (major !== record[centsKey]) return { ok: false, error: "Send the amount once, in cents or in rand." };
    }
    return { ok: true, present: true, cents: record[centsKey] };
  }
  if (record[majorKey] === null || record[majorKey] === "") return { ok: true, present: true, cents: null };
  if (typeof record[majorKey] !== "string" && typeof record[majorKey] !== "number") {
    return { ok: false, error: "Amounts are whole cents, or a number of rand." };
  }
  const cents = amountToCents(record[majorKey]);
  if (cents === null || cents < 0 || cents > MAX_CENTS) return { ok: false, error: "Use a number, or leave it blank." };
  return { ok: true, present: true, cents };
}

function parseDriver(record: Record<string, unknown>, ignored: string[]): ParseResult | { driverLabel?: string | null; driverValue?: number | null; label: boolean; value: boolean } {
  const labelPresent = record.driverLabel !== undefined || record.driver_label !== undefined;
  const valuePresent = record.driverValue !== undefined || record.driver_value !== undefined;
  let driverLabel: string | null | undefined;
  let driverValue: number | null | undefined;
  if (labelPresent) {
    const raw = record.driverLabel !== undefined ? record.driverLabel : record.driver_label;
    if (raw === null || raw === "") driverLabel = null;
    else if (typeof raw !== "string") return { ok: false, error: "The driver needs a name." };
    else driverLabel = raw.trim().slice(0, 80) || null;
  }
  if (valuePresent) {
    const raw = record.driverValue !== undefined ? record.driverValue : record.driver_value;
    if (raw === null || raw === "") driverValue = null;
    else {
      const parsed = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : NaN;
      if (!Number.isFinite(parsed) || parsed < 0) return { ok: false, error: "The driver count has to be zero or more." };
      try {
        driverValue = roundNumeric(parsed);
      } catch {
        return { ok: false, error: "The driver count has to be zero or more." };
      }
    }
  }
  if (record.purpose !== undefined || record.whatThisCovers !== undefined || record.what_this_covers !== undefined || record.covers !== undefined) {
    const raw = record.purpose ?? record.whatThisCovers ?? record.what_this_covers ?? record.covers;
    if (typeof raw === "string" && raw.trim()) ignored.push("purpose");
  }
  return { driverLabel, driverValue, label: labelPresent, value: valuePresent };
}

function parseFactor(value: unknown, fallback: number | null): number | null {
  if (value === undefined || value === null || value === "") return fallback;
  let n: number;
  if (typeof value === "number") n = value;
  else if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return fallback;
    if (!/^\d*(\.\d*)?$/.test(trimmed) || trimmed === ".") return null;
    n = Number(trimmed);
  } else return null;
  if (!Number.isFinite(n) || n < 0 || n > 99_999_999.99) return null;
  try {
    return roundNumeric(n);
  } catch {
    return null;
  }
}

function parseLines(value: unknown): { ok: true; lines: WorkbookLineInput[]; ignored: string[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) return { ok: false, error: "Lines have to be a list." };
  if (value.length > MAX_LINES) return { ok: false, error: "A budget can hold 400 lines." };
  const lines: WorkbookLineInput[] = [];
  const seen = new Set<string>();
  let coercedFixed = false;
  for (const item of value) {
    const line = asRecord(item);
    if (!line) return { ok: false, error: "Each line needs a name and an amount." };
    if (hasCodingKey(line)) return { ok: false, error: "This save doesn't set a Xero code. Finance maps those later." };
    const kind = line.kind;
    if (kind !== "fixed" && kind !== "variable") return { ok: false, error: "A line is either fixed or variable." };
    const nameRaw = text(line.name, 200);
    if (typeof nameRaw !== "string" || !nameRaw.trim()) return { ok: false, error: "Every line needs a name." };
    let amountCents: number | null = null;
    if (line.amountCents !== undefined || line.amount_cents !== undefined) {
      const raw = line.amountCents !== undefined ? line.amountCents : line.amount_cents;
      if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw > MAX_CENTS) {
        return { ok: false, error: "Enter an amount for each line." };
      }
      amountCents = raw;
    } else if (line.amount !== undefined) {
      amountCents = amountToCents(line.amount as number | string);
      if (amountCents === null || amountCents < 0 || amountCents > MAX_CENTS) {
        return { ok: false, error: "Enter an amount for each line." };
      }
    } else {
      return { ok: false, error: "Enter an amount for each line." };
    }
    const usesDriver = line.usesDriver === true || line.uses_driver === true;
    if (line.usesDriver !== undefined && typeof line.usesDriver !== "boolean" && line.uses_driver === undefined) {
      return { ok: false, error: "Say whether the line follows the driver." };
    }
    const frequency = kind === "fixed" ? 1 : parseFactor(line.frequency, 1);
    if (frequency === null) return { ok: false, error: "Enter how many times for each variable line." };
    if (kind === "fixed" && line.frequency !== undefined && parseFactor(line.frequency, 1) !== 1) coercedFixed = true;
    const multiplier = usesDriver ? parseFactor(line.multiplier, 0) ?? 0 : parseFactor(line.multiplier, 1);
    if (multiplier === null) return { ok: false, error: "Enter how many for each line." };
    let id: string | undefined;
    if (line.id !== undefined && line.id !== null && line.id !== "") {
      if (!isUuid(line.id)) return { ok: false, error: "A line id has to be a real id." };
      if (seen.has(line.id)) return { ok: false, error: "Each line needs its own id." };
      seen.add(line.id);
      id = line.id;
    }
    const notesRaw = text(line.notes, 2000);
    if (line.notes !== undefined && notesRaw === undefined) return { ok: false, error: "Line notes have to be text." };
    lines.push({
      id,
      kind,
      name: nameRaw.trim(),
      amountCents,
      frequency,
      multiplier,
      usesDriver,
      notes: notesRaw?.trim() ? notesRaw.trim() : null,
      sort: lines.length,
    });
  }
  return { ok: true, lines, ignored: coercedFixed ? ["fixedFrequency"] : [] };
}

function parseExpenses(value: unknown): { ok: true; expenses: WorkbookExpenseInput[]; ignored: string[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) return { ok: false, error: "Expenses have to be a list." };
  if (value.length > MAX_EXPENSES) return { ok: false, error: "A budget can hold 400 expense rows." };
  const expenses: WorkbookExpenseInput[] = [];
  const seen = new Set<string>();
  let ignoredChecked = false;
  for (const item of value) {
    const row = asRecord(item);
    if (!row) return { ok: false, error: "Each expense needs a date, what it was for, and an amount." };
    if (hasCodingKey(row)) return { ok: false, error: "This save doesn't set a Xero code. Finance maps those later." };
    if (row.checked !== undefined) ignoredChecked = true;
    const dateRaw = row.expenseDate ?? row.expense_date ?? row.date;
    if (typeof dateRaw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
      return { ok: false, error: "Each expense needs a date." };
    }
    const descriptionRaw = row.description ?? row.what ?? row.whatItWasFor;
    if (typeof descriptionRaw !== "string" || !descriptionRaw.trim()) {
      return { ok: false, error: "Say what the expense was for." };
    }
    let amountCents: number | null = null;
    if (row.amountCents !== undefined || row.amount_cents !== undefined) {
      const raw = row.amountCents !== undefined ? row.amountCents : row.amount_cents;
      if (typeof raw !== "number" || !Number.isInteger(raw) || raw === 0 || Math.abs(raw) > MAX_CENTS) {
        return { ok: false, error: "An expense needs an amount that isn't zero." };
      }
      amountCents = raw;
    } else if (row.amount !== undefined) {
      amountCents = amountToCents(row.amount as number | string);
      if (amountCents === null || amountCents === 0 || Math.abs(amountCents) > MAX_CENTS) {
        return { ok: false, error: "An expense needs an amount that isn't zero." };
      }
    } else {
      return { ok: false, error: "An expense needs an amount that isn't zero." };
    }
    const lineRaw = row.lineId !== undefined ? row.lineId : row.line_id !== undefined ? row.line_id : row.budgetLineId;
    let lineId: string | null = null;
    if (lineRaw !== undefined && lineRaw !== null && lineRaw !== "") {
      if (!isUuid(lineRaw)) return { ok: false, error: "An expense has to name a line on this budget, or none." };
      lineId = lineRaw;
    }
    let id: string | undefined;
    if (row.id !== undefined && row.id !== null && row.id !== "") {
      if (!isUuid(row.id)) return { ok: false, error: "An expense id has to be a real id." };
      if (seen.has(row.id)) return { ok: false, error: "Each expense needs its own id." };
      seen.add(row.id);
      id = row.id;
    }
    const vendor = text(row.vendor, 200);
    if (row.vendor !== undefined && vendor === undefined) return { ok: false, error: "The vendor has to be text." };
    const referenceRaw = row.reference !== undefined ? row.reference : row.proof;
    const reference = text(referenceRaw, 500);
    if (referenceRaw !== undefined && reference === undefined) return { ok: false, error: "The proof has to be text." };
    const notes = text(row.notes, 2000);
    if (row.notes !== undefined && notes === undefined) return { ok: false, error: "Expense notes have to be text." };
    expenses.push({
      id,
      lineId,
      expenseDate: dateRaw,
      vendor: vendor?.trim() ? vendor.trim() : null,
      description: descriptionRaw.trim().slice(0, 500),
      amountCents,
      reference: reference?.trim() ? reference.trim() : null,
      notes: notes?.trim() ? notes.trim() : null,
    });
  }
  return { ok: true, expenses, ignored: ignoredChecked ? ["checked"] : [] };
}

function parsePeriod(record: Record<string, unknown>): { ok: true; present: boolean; period?: WorkbookPeriodInput } | { ok: false; error: string } {
  const nested = asRecord(record.period);
  const kindRaw = nested?.kind ?? record.periodKind;
  const labelRaw = nested?.label ?? record.periodLabel;
  const startRaw = nested?.start ?? nested?.start_date ?? record.periodStart;
  const endRaw = nested?.end ?? nested?.end_date ?? record.periodEnd;
  const any = record.period !== undefined || record.periodKind !== undefined || record.periodLabel !== undefined || record.periodStart !== undefined || record.periodEnd !== undefined;
  if (!any) return { ok: true, present: false };
  if (kindRaw === undefined && labelRaw === undefined && startRaw === undefined && endRaw === undefined && record.period === undefined) {
    return { ok: true, present: false };
  }
  if (typeof kindRaw !== "string" || !isPeriodKind(kindRaw)) return { ok: false, error: "Choose a year, a term, or an event." };
  if (typeof labelRaw !== "string" || !labelRaw.trim()) return { ok: false, error: "Name the period." };
  if (typeof startRaw !== "string" || typeof endRaw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(startRaw) || !/^\d{4}-\d{2}-\d{2}$/.test(endRaw)) {
    return { ok: false, error: "A period needs a start date and an end date." };
  }
  if (endRaw < startRaw) return { ok: false, error: "The period ends before it starts." };
  return { ok: true, present: true, period: { kind: kindRaw, label: labelRaw.trim().slice(0, 120), start: startRaw, end: endRaw } };
}

/**
 * Reads a create or save body. Create requires a name, one owner, and a period.
 * Save may send only the parts that changed. Lines, when sent, are the full list.
 */
export function parseWorkbookWrite(body: unknown, mode: "create" | "save"): ParseResult {
  const record = asRecord(body);
  if (!record) return { ok: false, error: "Invalid JSON body" };
  if (hasCodingKey(record) || hasXeroSpendKey(record)) {
    return { ok: false, error: "This save doesn't set a Xero code, and it doesn't record Xero spend." };
  }
  if (record.currency !== undefined || record.record_currency !== undefined) {
    const currency = String(record.currency ?? record.record_currency).trim().toUpperCase();
    if (currency !== "" && currency !== "ZAR") {
      return { ok: false, error: "Amounts stay in rand. There's no currency to choose." };
    }
  }

  const ignored: string[] = [];
  if (record.currency !== undefined || record.record_currency !== undefined) ignored.push("currency");

  const namePresent = record.name !== undefined;
  let name: string | undefined;
  if (namePresent) {
    if (typeof record.name !== "string" || !record.name.trim()) return { ok: false, error: "Name the budget." };
    name = record.name.trim().slice(0, 200);
  }

  const ownerKindPresent = record.ownerKind !== undefined || record.owner_kind !== undefined;
  let ownerKind: BudgetOwnerKind | undefined;
  if (ownerKindPresent) {
    const raw = String(record.ownerKind ?? record.owner_kind);
    if (!isOwnerKind(raw)) return { ok: false, error: "Choose one owner." };
    ownerKind = raw;
  }
  const ownerIdPresent = record.ownerId !== undefined || record.owner_id !== undefined;
  let ownerId: string | undefined;
  if (ownerIdPresent) {
    const raw = record.ownerId ?? record.owner_id;
    if (!isUuid(raw)) return { ok: false, error: "Choose one owner." };
    ownerId = raw;
  }

  let orgId: string | undefined;
  if (record.orgId !== undefined || record.org_id !== undefined) {
    const raw = record.orgId ?? record.org_id;
    if (raw !== null && raw !== "") {
      if (!isUuid(raw)) return { ok: false, error: "Budgets are for South Africa only, in rand." };
      orgId = raw;
    }
  }

  const periodIdPresent = record.periodId !== undefined || record.period_id !== undefined;
  let periodId: string | undefined;
  if (periodIdPresent) {
    const raw = record.periodId ?? record.period_id;
    if (!isUuid(raw)) return { ok: false, error: "That period isn't available." };
    periodId = raw;
  }
  const periodParsed = parsePeriod(record);
  if (!periodParsed.ok) return periodParsed;

  const driver = parseDriver(record, ignored);
  if ("ok" in driver) return driver;

  const funding = parseOptionalCents(record, "fundingGoalCents", "fundingGoal");
  if (!funding.ok) return funding;
  const inHand = parseOptionalCents(record, "fundsInHandCents", "fundsInHand");
  if (!inHand.ok) return inHand;
  const income = parseOptionalCents(record, "incomeGoalCents", "incomeGoal");
  if (!income.ok) return income;
  const fundraising = parseOptionalCents(record, "fundraisingGoalCents", "fundraisingGoal");
  if (!fundraising.ok) return fundraising;

  const notesPresent = record.notes !== undefined;
  let notes: string | null | undefined;
  if (notesPresent) {
    const raw = text(record.notes, 8000);
    if (raw === undefined) return { ok: false, error: "Notes have to be text." };
    notes = raw?.trim() ? raw.trim() : null;
  }

  let lines: WorkbookLineInput[] | undefined;
  if (record.lines !== undefined) {
    const parsed = parseLines(record.lines);
    if (!parsed.ok) return parsed;
    lines = parsed.lines;
    ignored.push(...parsed.ignored);
  }
  let expenses: WorkbookExpenseInput[] | undefined;
  if (record.expenses !== undefined) {
    const parsed = parseExpenses(record.expenses);
    if (!parsed.ok) return parsed;
    expenses = parsed.expenses;
    ignored.push(...parsed.ignored);
  }

  const statusPresent = record.status !== undefined;
  let status: string | undefined;
  if (statusPresent) {
    if (typeof record.status !== "string") return { ok: false, error: "This save doesn't submit or approve a budget." };
    status = record.status;
  }

  if (mode === "create") {
    if (!name) return { ok: false, error: "Name the budget." };
    if (!ownerKind || !ownerId) return { ok: false, error: "Choose one owner." };
    if (!periodId && !periodParsed.period) return { ok: false, error: "A budget needs a period with a start and an end." };
  }

  return {
    ok: true,
    value: {
      name,
      ownerKind,
      ownerId,
      orgId,
      periodId,
      period: periodParsed.period,
      driverLabel: driver.driverLabel,
      driverValue: driver.driverValue,
      fundingGoalCents: funding.present ? funding.cents : undefined,
      fundsInHandCents: inHand.present ? inHand.cents : undefined,
      incomeGoalCents: income.present ? income.cents : undefined,
      fundraisingGoalCents: fundraising.present ? fundraising.cents : undefined,
      notes,
      lines,
      expenses,
      status,
      present: {
        name: namePresent,
        ownerKind: ownerKindPresent,
        ownerId: ownerIdPresent,
        periodId: periodIdPresent,
        period: periodParsed.present,
        driverLabel: driver.label,
        driverValue: driver.value,
        fundingGoalCents: funding.present,
        fundsInHandCents: inHand.present,
        incomeGoalCents: income.present,
        fundraisingGoalCents: fundraising.present,
        notes: notesPresent,
        lines: record.lines !== undefined,
        expenses: record.expenses !== undefined,
        status: statusPresent,
      },
      ignored,
    },
  };
}

export function ownerColumn(kind: BudgetOwnerKind): string {
  switch (kind) {
    case "staff_ministry":
      return "staff_ministry_id";
    case "ministry_subcategory":
      return "subcategory_id";
    case "program":
      return "program_id";
    case "event":
      return "event_id";
    case "outreach_team":
      return "outreach_team_id";
  }
}

export function ownerIdFromRow(row: {
  staff_ministry_id?: string | null;
  subcategory_id?: string | null;
  program_id?: string | null;
  event_id?: string | null;
  outreach_team_id?: string | null;
}): string | null {
  return row.staff_ministry_id ?? row.subcategory_id ?? row.program_id ?? row.event_id ?? row.outreach_team_id ?? null;
}
