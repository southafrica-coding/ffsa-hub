// ────────────────────────────────────────────────────────────
// FFSA Hub — Billing Schedule Builder (pure, no I/O)
// ────────────────────────────────────────────────────────────
// Expands a course/tier's fee_charge_items into dated schedule
// rows for one student, honouring their payment preference.
//
// All dates are handled as "YYYY-MM-DD" strings in calendar terms
// (no Date/timezone math on the wire) to avoid TZ drift. The only
// place we touch Date is addDays(), done in UTC.
// ────────────────────────────────────────────────────────────

import type {
  ChargeType,
  Cadence,
  DueAnchor,
  GenerationRule,
  Tier,
} from "@/services/school-billing";

export interface BuilderChargeItem {
  id?: string;
  charge_type: ChargeType;
  label: string;
  amount_zar: number;
  xero_item_code: string | null;
  cadence: Cadence;
  quantity: number;
  due_anchor: DueAnchor;
  due_day: number | null;
  first_due_month: number | null;
  first_due_year: number | null;
  fixed_due_date: string | null;
  arrival_offset_days: number | null;
  generation_rule: GenerationRule;
  generation_fixed_date: string | null;
  generation_lead_days: number | null;
  sort_order: number;
}

export interface BuilderContext {
  acceptanceDate: string; // YYYY-MM-DD (enrolment / acceptance)
  arrivalDate?: string | null; // YYYY-MM-DD (quarter courses)
  groupYear?: number | null; // program_groups.year fallback
  paymentPreference: "standard" | "quarter_prepay" | "full_prepay";
}

export interface ScheduleRow {
  charge_item_id?: string;
  charge_type: ChargeType;
  label: string;
  sequence: number;
  amount_zar: number;
  xero_item_code: string | null;
  scheduled_generation_date: string;
  due_date: string;
  combined_group_key: string | null;
}

export interface BuildResult {
  rows: ScheduleRow[];
  warnings: string[];
}

// ── Calendar helpers (string-based) ─────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");

function daysInMonth(year: number, month1: number): number {
  // month1 = 1..12
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function ymd(year: number, month1: number, day: number): string {
  const d = Math.min(day, daysInMonth(year, month1));
  return `${year}-${pad(month1)}-${pad(d)}`;
}

// Normalise a month index that may overflow past December into year+month.
function rollMonth(year: number, month1: number): { year: number; month1: number } {
  const zeroIdx = month1 - 1;
  const y = year + Math.floor(zeroIdx / 12);
  const m = (((zeroIdx % 12) + 12) % 12) + 1;
  return { year: y, month1: m };
}

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

// 15th of the month preceding `dueDate`.
function precedingMonth15th(dueDate: string): string {
  const [y, m] = dueDate.split("-").map(Number);
  const { year, month1 } = rollMonth(y, m - 1);
  return ymd(year, month1, 15);
}

function yearOf(dateStr: string): number {
  return Number(dateStr.split("-")[0]);
}

// ── Generation-date resolution ──────────────────────────────

function resolveGeneration(
  item: BuilderChargeItem,
  dueDate: string,
  ctx: BuilderContext
): string {
  switch (item.generation_rule) {
    case "immediate":
      return ctx.acceptanceDate;
    case "preceding_month_15th":
      return precedingMonth15th(dueDate);
    case "fixed_date":
      return item.generation_fixed_date ?? ctx.acceptanceDate;
    case "days_before_due":
      return addDays(dueDate, -(item.generation_lead_days ?? 0));
    default:
      return ctx.acceptanceDate;
  }
}

// ── Per-item expansion ──────────────────────────────────────

function expandItem(
  item: BuilderChargeItem,
  ctx: BuilderContext,
  warnings: string[]
): ScheduleRow[] {
  const baseYear =
    item.first_due_year ?? ctx.groupYear ?? yearOf(ctx.acceptanceDate);

  const makeRow = (
    sequence: number,
    dueDate: string,
    labelSuffix = ""
  ): ScheduleRow => ({
    charge_item_id: item.id,
    charge_type: item.charge_type,
    label: item.label + labelSuffix,
    sequence,
    amount_zar: Number(item.amount_zar),
    xero_item_code: item.xero_item_code,
    scheduled_generation_date: resolveGeneration(item, dueDate, ctx),
    due_date: dueDate,
    combined_group_key: null,
  });

  // Monthly recurrence
  if (item.cadence === "monthly") {
    const count = Math.max(1, item.quantity || 1);
    const startMonth = item.first_due_month ?? 1;
    const day = item.due_day ?? 1;
    const rows: ScheduleRow[] = [];
    const MONTH_NAMES = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    for (let i = 0; i < count; i++) {
      const { year, month1 } = rollMonth(baseYear, startMonth + i);
      const due = ymd(year, month1, day);
      rows.push(makeRow(i + 1, due, ` — ${MONTH_NAMES[month1 - 1]} ${year}`));
    }
    return rows;
  }

  // One-off
  let due: string | null = null;
  switch (item.due_anchor) {
    case "acceptance":
      due = ctx.acceptanceDate;
      break;
    case "fixed_date":
      due = item.fixed_due_date ?? null;
      if (!due) warnings.push(`${item.label}: no fixed due date set.`);
      break;
    case "relative_to_arrival":
      if (!ctx.arrivalDate) {
        warnings.push(
          `${item.label}: needs the course arrival date — set it in Billing Setup.`
        );
        return [];
      }
      due = addDays(ctx.arrivalDate, item.arrival_offset_days ?? 0);
      break;
    case "month_day":
      due = ymd(baseYear, item.first_due_month ?? 1, item.due_day ?? 1);
      break;
  }

  if (!due) return [];
  return [makeRow(1, due)];
}

// ── Payment-preference post-processing ──────────────────────

function applyPreference(
  rows: ScheduleRow[],
  ctx: BuilderContext
): ScheduleRow[] {
  if (ctx.paymentPreference === "standard") {
    return rows;
  }

  if (ctx.paymentPreference === "full_prepay") {
    // One combined invoice, generated and due on acceptance.
    return rows.map((r) => ({
      ...r,
      scheduled_generation_date: ctx.acceptanceDate,
      due_date: ctx.acceptanceDate,
      combined_group_key: "FULL",
    }));
  }

  // quarter_prepay: combine consecutive monthly tuition into groups of 3.
  // Each group invoices on the earliest generation date in the group and is
  // due on the earliest due date in the group. Non-monthly rows are untouched.
  const monthly = rows
    .filter((r) => r.charge_type === "monthly_tuition")
    .sort((a, b) => a.sequence - b.sequence);
  const others = rows.filter((r) => r.charge_type !== "monthly_tuition");

  const grouped: ScheduleRow[] = [];
  for (let i = 0; i < monthly.length; i++) {
    const groupIdx = Math.floor(i / 3);
    const key = `Q${groupIdx + 1}`;
    const groupRows = monthly.slice(groupIdx * 3, groupIdx * 3 + 3);
    const earliestGen = groupRows
      .map((r) => r.scheduled_generation_date)
      .sort()[0];
    const earliestDue = groupRows.map((r) => r.due_date).sort()[0];
    grouped.push({
      ...monthly[i],
      scheduled_generation_date: earliestGen,
      due_date: earliestDue,
      combined_group_key: key,
    });
  }

  return [...others, ...grouped];
}

// ── Public API ──────────────────────────────────────────────

export function buildSchedule(
  items: BuilderChargeItem[],
  ctx: BuilderContext
): BuildResult {
  const warnings: string[] = [];
  const active = [...items].sort((a, b) => a.sort_order - b.sort_order);

  const rows: ScheduleRow[] = [];
  for (const item of active) {
    rows.push(...expandItem(item, ctx, warnings));
  }

  const processed = applyPreference(rows, ctx);

  // Stable sort by due date, then generation date.
  processed.sort((a, b) => {
    if (a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1;
    return a.scheduled_generation_date < b.scheduled_generation_date ? -1 : 1;
  });

  if (active.length === 0) {
    warnings.push("No charge items configured for this course/tier.");
  }

  return { rows: processed, warnings };
}

// Total across all rows (each row is one occurrence amount).
export function scheduleTotal(rows: ScheduleRow[]): number {
  return rows.reduce((sum, r) => sum + Number(r.amount_zar), 0);
}
