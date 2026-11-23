// ────────────────────────────────────────────────────────────
// Missio Finance — the income report, as plain arithmetic
// ────────────────────────────────────────────────────────────
// Everything here is pure: no Supabase, no Xero, no clock. The server loader
// (./server.ts) gathers bank receipts and manual entries and hands them in;
// tests feed made-up figures straight in. Money is integer cents throughout,
// so totals and averages never drift by a cent through float addition.
//
// Shape follows the 19 Nov 2026 income report: a total, four sources, a row
// per month, an average per month across every month in the range, and an
// average across complete calendar months only.

export const SOURCE_KEYS = ["bank", "snapscan", "fundraiseup", "cash"] as const;
export type SourceKey = (typeof SOURCE_KEYS)[number];

export const SOURCE_LABEL: Record<SourceKey, string> = {
  bank: "EFT & other bank",
  snapscan: "SnapScan",
  fundraiseup: "FundraiseUp",
  cash: "Cash",
};

/** Column heads and legend: the report's shorter names. */
export const SOURCE_SHORT: Record<SourceKey, string> = {
  bank: "EFT & other",
  snapscan: "SnapScan",
  fundraiseup: "FundraiseUp",
  cash: "Cash",
};

/** The report starts in July 2026; the page defaults to the same range. */
export const DEFAULT_FROM_MONTH = "2026-07";

/**
 * The 19 Nov report's "full months only" also left out July and called
 * August to October "a fairer picture of a normal month". July is a complete
 * calendar month, so the strict figure keeps it; this list is what the
 * report's second figure leaves out on top. Jack to confirm which is default.
 */
export const NORMAL_MONTH_EXCLUDES: readonly string[] = ["2026-07"];

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** One dated amount for one source. date is YYYY-MM-DD (SAST calendar day). */
export interface SourceAmount {
  source: SourceKey;
  date: string;
  cents: number;
}

export interface MonthRow {
  /** YYYY-MM */
  key: string;
  label: string;
  short: string;
  /** The month that holds today, when today isn't its last day. */
  partial: boolean;
  /** Last day counted: today for the partial month, else the month's last day. */
  through: string;
  /** null = nothing at all for this source this month (shown as "—"). */
  bySource: Record<SourceKey, number | null>;
  total: number;
}

export interface Average {
  cents: number | null;
  months: string[];
  /** "July to November", "August to October", or "" when there are none. */
  span: string;
}

export interface SourceSummary {
  key: SourceKey;
  /** null = nothing for this source anywhere in the range. */
  total: number | null;
  /** Share of the grand total, 0–100, one decimal. null when there's no total. */
  share: number | null;
  /** total ÷ every month in the range, the way the report does it. */
  perMonth: number | null;
}

export interface IncomeReport {
  fromMonth: string;
  /** Today, YYYY-MM-DD. */
  today: string;
  months: MonthRow[];
  sources: SourceSummary[];
  total: number;
  /** True when any source has any amount in the range. */
  hasData: boolean;
  averages: {
    /** Every month in the range, partial current month included. */
    all: Average;
    /** Complete calendar months only (the partial current month left out). */
    fullMonths: Average;
    /** fullMonths, also without NORMAL_MONTH_EXCLUDES: the 19 Nov report's figure. */
    normalMonth: Average | null;
  };
}

// ── Months ──────────────────────────────────────────────────

export function isMonthKey(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function isYmd(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function monthLabel(key: string): string {
  return MONTH_NAMES[Number(key.slice(5, 7)) - 1] ?? key;
}

function lastDayOfMonth(key: string): string {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}

function nextMonth(key: string): string {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** Month keys from `from` through the month holding `today`, oldest first. */
export function monthsInRange(from: string, today: string): string[] {
  const end = today.slice(0, 7);
  const out: string[] = [];
  for (let k = from; k <= end && out.length < 240; k = nextMonth(k)) out.push(k);
  return out;
}

/** Today's calendar date in South Africa, YYYY-MM-DD. */
export function todayInSast(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** "July to November", "October", "July 2025 to February 2026". */
export function monthSpan(keys: readonly string[]): string {
  if (keys.length === 0) return "";
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (first === last) return monthLabel(first);
  const sameYear = first.slice(0, 4) === last.slice(0, 4);
  return sameYear
    ? `${monthLabel(first)} to ${monthLabel(last)}`
    : `${monthLabel(first)} ${first.slice(0, 4)} to ${monthLabel(last)} ${last.slice(0, 4)}`;
}

// ── Averages ────────────────────────────────────────────────

/** Mean of whole cents, rounded half away from zero. null for no months. */
export function averageCents(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  const mean = sum / values.length;
  return Math.sign(mean) * Math.round(Math.abs(mean));
}

function averageOver(rows: readonly MonthRow[]): Average {
  const months = rows.map((r) => r.key);
  return { cents: averageCents(rows.map((r) => r.total)), months, span: monthSpan(months) };
}

// ── The report ──────────────────────────────────────────────

/**
 * Builds the report from dated amounts. Amounts outside the range (before
 * `fromMonth`, after `today`) are left out. A source-month with no amounts is
 * null, not 0, so the page can show "—" rather than R0.00.
 */
export function buildIncomeReport(input: {
  fromMonth: string;
  today: string;
  amounts: readonly SourceAmount[];
}): IncomeReport {
  const { fromMonth, today } = input;
  const keys = monthsInRange(fromMonth, today);
  const currentKey = today.slice(0, 7);
  const firstDay = `${fromMonth}-01`;

  const cells = new Map<string, Record<SourceKey, number | null>>();
  for (const k of keys) cells.set(k, { bank: null, snapscan: null, fundraiseup: null, cash: null });

  for (const a of input.amounts) {
    if (!isYmd(a.date) || a.date < firstDay || a.date > today) continue;
    if (!Number.isInteger(a.cents)) continue;
    const row = cells.get(a.date.slice(0, 7));
    if (!row) continue;
    row[a.source] = (row[a.source] ?? 0) + a.cents;
  }

  const months: MonthRow[] = keys.map((key) => {
    const bySource = cells.get(key)!;
    const partial = key === currentKey && today !== lastDayOfMonth(key);
    const total = SOURCE_KEYS.reduce((sum, s) => sum + (bySource[s] ?? 0), 0);
    return {
      key,
      label: monthLabel(key),
      short: monthLabel(key).slice(0, 3),
      partial,
      through: partial ? today : lastDayOfMonth(key),
      bySource,
      total,
    };
  });

  const total = months.reduce((sum, m) => sum + m.total, 0);
  const sources: SourceSummary[] = SOURCE_KEYS.map((key) => {
    const present = months.filter((m) => m.bySource[key] !== null);
    if (present.length === 0) return { key, total: null, share: null, perMonth: null };
    const t = present.reduce((sum, m) => sum + (m.bySource[key] ?? 0), 0);
    return {
      key,
      total: t,
      share: total > 0 ? Math.round((t / total) * 1000) / 10 : null,
      perMonth: averageCents(months.map((m) => m.bySource[key] ?? 0)),
    };
  });

  const full = months.filter((m) => !m.partial);
  const normal = full.filter((m) => !NORMAL_MONTH_EXCLUDES.includes(m.key));
  const showNormal = normal.length > 0 && normal.length !== full.length;

  return {
    fromMonth,
    today,
    months,
    sources,
    total,
    hasData: sources.some((s) => s.total !== null),
    averages: {
      all: averageOver(months),
      fullMonths: averageOver(full),
      normalMonth: showNormal ? averageOver(normal) : null,
    },
  };
}

// ── Money ───────────────────────────────────────────────────

function group(whole: number): string {
  return String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** 22642656 → "R226,426.56", grouped the way the report is. */
export function formatZar(cents: number): string {
  const sign = cents < 0 ? "−" : "";
  const abs = Math.abs(Math.round(cents));
  return `${sign}R${group(Math.floor(abs / 100))}.${String(abs % 100).padStart(2, "0")}`;
}

/** Whole rand for chart labels: 8362937 → "R83,629". */
export function formatZarWhole(cents: number): string {
  const sign = cents < 0 ? "−" : "";
  return `${sign}R${group(Math.round(Math.abs(cents) / 100))}`;
}

/** Short chart label when columns are narrow: 8362937 → "R84k". */
export function formatZarCompact(cents: number): string {
  const rand = Math.abs(cents) / 100;
  const sign = cents < 0 ? "−" : "";
  if (rand >= 1000) return `${sign}R${Math.round(rand / 1000)}k`;
  return `${sign}R${Math.round(rand)}`;
}

export function formatUsd(cents: number): string {
  const abs = Math.abs(Math.round(cents));
  return `${cents < 0 ? "−" : ""}$${group(Math.floor(abs / 100))}.${String(abs % 100).padStart(2, "0")}`;
}

/** "23 November 2026" */
export function formatLongDate(ymd: string): string {
  return `${Number(ymd.slice(8, 10))} ${monthLabel(ymd.slice(0, 7))} ${ymd.slice(0, 4)}`;
}

/** "R1,234.50" / "1234.5" / "1 234,50" → cents. null when it isn't a plain amount. */
export function parseAmountToCents(value: string): number | null {
  let s = value.trim().replace(/^[Rr$]\s*/, "").replace(/[\s ]/g, "");
  if (!s) return null;
  // "1234,50" (decimal comma, no point) → "1234.50"
  if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
  else s = s.replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** "18.25" → 18250000 (rand per dollar in millionths). null unless 0 < rate < 1000, ≤ 6 decimals. */
export function parseRateMicros(value: string): number | null {
  const s = value.trim().replace(",", ".");
  if (!/^\d{1,3}(\.\d{1,6})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const micros = Number(whole) * 1_000_000 + Number(frac.padEnd(6, "0"));
  return micros > 0 ? micros : null;
}

/**
 * Rand cents for a dollar amount at a stored rate (rand per dollar, in
 * millionths), rounded half up to the cent. Integer maths, so it matches the
 * database's round(usd_cents * usd_zar_rate) in migration 394 exactly.
 */
export function usdToZarCents(usdCents: number, rateMicros: number): number {
  const million = BigInt(1_000_000);
  const product = BigInt(usdCents) * BigInt(rateMicros);
  const q = product / million;
  const r = product % million;
  return Number(r * BigInt(2) >= million ? q + BigInt(1) : q);
}

/** 18250000 → "18.25" for display and for the API. */
export function formatRate(rateMicros: number): string {
  const whole = Math.floor(rateMicros / 1_000_000);
  const frac = String(rateMicros % 1_000_000).padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}
