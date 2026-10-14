// ────────────────────────────────────────────────────────────
// FFSA Hub — per-school payment schedule designs (migration 236)
// ────────────────────────────────────────────────────────────
// Finance designs a school's payment schedule as a price per tier plus an
// ordered list of payments. Each payment's amount is a % of the price, a
// fixed rand amount per tier, or "whatever's left" — so rounding always lands
// exactly on the price.
//
// compileSchedule() turns a design into ordinary charge items, which the
// existing engine (schedule-builder.ts) expands per student. Pure: no
// database, so the money maths is tested directly.
// ────────────────────────────────────────────────────────────

import type { Tier } from "@/services/school-billing";
import type { BuilderChargeItem } from "@/lib/finance/schedule-builder";
import { formatZAR } from "@/lib/finance/billing";

export const SCHEDULE_TIERS: Tier[] = ["A", "B", "C"];

export type PaymentAmount =
  | { mode: "percent"; percent: number }
  | { mode: "fixed"; A: number | null; B: number | null; C: number | null }
  | { mode: "remainder" };

export type PaymentTiming =
  | { kind: "after_acceptance"; days: number }
  | { kind: "fixed_date"; date: string } // YYYY-MM-DD
  | { kind: "before_arrival"; days: number }
  | { kind: "monthly"; count: number; day: number; startMonth: number; startYear: number };

/** When the invoice for a payment is created. */
export type InvoiceTiming =
  | { kind: "on_acceptance" }
  | { kind: "month_before_15th" }
  | { kind: "days_before_due"; days: number };

export interface SchedulePayment {
  /** Stable id; compiled charge rows carry it as schedule_payment_key. */
  key: string;
  label: string;
  amount: PaymentAmount;
  timing: PaymentTiming;
  invoice: InvoiceTiming;
  itemCodes: Record<Tier, string | null>;
  trackingOption: string | null;
}

export interface PaymentScheduleDesign {
  /** Null = the school doesn't offer that tier; no charges are made for it. */
  tierPrices: Record<Tier, number | null>;
  payments: SchedulePayment[];
}

export interface CompiledPayment {
  key: string;
  label: string;
  /** Rand amount of each invoice for this payment. */
  perOccurrence: number;
  occurrences: number;
  total: number;
}

export interface CompiledTier {
  tier: Tier;
  price: number;
  payments: CompiledPayment[];
  total: number;
  /** total − price. 0 when the schedule adds up exactly. */
  difference: number;
}

/** A charge row ready to insert, minus its program_id / course_id. */
export type CompiledChargeItem = Omit<BuilderChargeItem, "id"> & {
  tier: Tier;
  schedule_payment_key: string;
  active: boolean;
};

export interface CompileResult {
  tiers: CompiledTier[];
  items: CompiledChargeItem[];
  /** Must be fixed before saving. */
  errors: string[];
  /** Worth a look, but saving is allowed. */
  warnings: string[];
}

const cents = (n: number) => Math.round(n * 100) / 100;
const rand = (n: number) => formatZAR(n);

export function newPaymentKey(): string {
  return `p_${Math.random().toString(36).slice(2, 10)}`;
}

export function emptyPayment(overrides: Partial<SchedulePayment> = {}): SchedulePayment {
  return {
    key: newPaymentKey(),
    label: "",
    amount: { mode: "percent", percent: 0 },
    timing: { kind: "after_acceptance", days: 0 },
    invoice: { kind: "on_acceptance" },
    itemCodes: { A: null, B: null, C: null },
    trackingOption: null,
    ...overrides,
  };
}

function occurrencesOf(p: SchedulePayment): number {
  return p.timing.kind === "monthly" ? Math.max(1, Math.floor(p.timing.count || 1)) : 1;
}

/**
 * Compile a design. `hasArrivalDate` says whether the target has an arrival
 * date to anchor "before arrival" payments to (courses do; whole-program
 * pricing doesn't).
 */
export function compileSchedule(
  design: PaymentScheduleDesign,
  opts: { hasArrivalDate: boolean }
): CompileResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const name = (p: SchedulePayment, i: number) => p.label.trim() || `Payment ${i + 1}`;

  // ── Shape checks, independent of tier ──
  const remainders = design.payments.filter((p) => p.amount.mode === "remainder");
  if (remainders.length > 1) errors.push(`Only one payment can be "whatever's left".`);
  design.payments.forEach((p, i) => {
    if (!p.label.trim()) errors.push(`Payment ${i + 1} needs a name.`);
    if (p.amount.mode === "remainder" && p.timing.kind === "monthly") {
      errors.push(`${name(p, i)}: a monthly run can't be "whatever's left" — use a % or a fixed amount.`);
    }
    if (p.amount.mode === "percent" && !(p.amount.percent > 0)) {
      errors.push(`${name(p, i)}: enter a % above 0.`);
    }
    if (p.timing.kind === "before_arrival" && !opts.hasArrivalDate) {
      errors.push(`${name(p, i)}: "before arrival" needs a course with an arrival date. Whole-program pricing has none.`);
    }
    if (p.timing.kind === "fixed_date" && !/^\d{4}-\d{2}-\d{2}$/.test(p.timing.date)) {
      errors.push(`${name(p, i)}: pick a due date.`);
    }
    if (p.timing.kind === "monthly") {
      const t = p.timing;
      if (!(t.count >= 1)) errors.push(`${name(p, i)}: how many monthly payments?`);
      if (!(t.day >= 1 && t.day <= 28)) errors.push(`${name(p, i)}: day of the month must be 1–28.`);
      if (!(t.startMonth >= 1 && t.startMonth <= 12) || !(t.startYear >= 2000)) {
        errors.push(`${name(p, i)}: pick the month the run starts.`);
      }
    }
    if (p.invoice.kind === "days_before_due" && !(p.invoice.days >= 0)) {
      errors.push(`${name(p, i)}: invoice lead time can't be negative.`);
    }
  });
  if (design.payments.length === 0) errors.push("Add at least one payment.");

  const offered = SCHEDULE_TIERS.filter((t) => {
    const price = design.tierPrices[t];
    return price != null && price > 0;
  });
  if (offered.length === 0) errors.push("Set a price for at least one tier.");

  // ── Per-tier amounts ──
  const tiers: CompiledTier[] = [];
  for (const tier of offered) {
    const price = cents(design.tierPrices[tier]!);
    const payments: CompiledPayment[] = [];
    let remainderIdx = -1;

    design.payments.forEach((p, i) => {
      const n = occurrencesOf(p);
      let per = 0;
      if (p.amount.mode === "percent") {
        // A % covers the whole payment; a monthly run splits it evenly.
        per = cents((price * p.amount.percent) / 100 / n);
      } else if (p.amount.mode === "fixed") {
        // A fixed amount is per invoice — for a monthly run, each month.
        const v = p.amount[tier];
        if (v == null || !(v >= 0)) {
          errors.push(`${name(p, i)}: enter the tier ${tier} amount.`);
        } else {
          per = cents(v);
        }
      } else {
        remainderIdx = i;
      }
      payments.push({ key: p.key, label: name(p, i), perOccurrence: per, occurrences: n, total: cents(per * n) });
    });

    if (remainderIdx >= 0) {
      const others = payments.reduce((s, p, i) => (i === remainderIdx ? s : s + p.total), 0);
      const left = cents(price - others);
      if (left < 0) {
        errors.push(`Tier ${tier}: the other payments come to ${rand(others)}, more than the ${rand(price)} price — nothing is left.`);
      } else if (left === 0) {
        warnings.push(`Tier ${tier}: "${payments[remainderIdx].label}" comes to R0.00 — the other payments already cover the price.`);
      }
      payments[remainderIdx] = { ...payments[remainderIdx], perOccurrence: Math.max(0, left), total: Math.max(0, left) };
    }

    const total = cents(payments.reduce((s, p) => s + p.total, 0));
    const difference = cents(total - price);
    if (difference !== 0) {
      warnings.push(
        `Tier ${tier}: payments add up to ${rand(total)} but the price is ${rand(price)} (${difference > 0 ? "+" : ""}${rand(difference)}).` +
          (remainderIdx < 0 ? ` Make the last payment "whatever's left" to land exactly on the price.` : "")
      );
    }
    tiers.push({ tier, price, payments, total, difference });
  }

  // ── Charge rows ──
  const items: CompiledChargeItem[] = [];
  for (const t of tiers) {
    design.payments.forEach((p, i) => {
      const c = t.payments[i];
      if (c.perOccurrence <= 0) return; // a R0 payment makes no invoice
      const base: CompiledChargeItem = {
        tier: t.tier,
        schedule_payment_key: p.key,
        active: true,
        charge_type: p.timing.kind === "monthly" ? "monthly_tuition" : "instalment",
        label: c.label,
        amount_zar: c.perOccurrence,
        xero_item_code: p.itemCodes[t.tier]?.trim() || null,
        xero_tracking_option: p.trackingOption?.trim() || null,
        cadence: p.timing.kind === "monthly" ? "monthly" : "once",
        quantity: c.occurrences,
        due_anchor: "acceptance",
        due_day: null,
        first_due_month: null,
        first_due_year: null,
        fixed_due_date: null,
        arrival_offset_days: null,
        acceptance_offset_days: null,
        generation_rule: "immediate",
        generation_fixed_date: null,
        generation_lead_days: null,
        sort_order: i,
      };
      switch (p.timing.kind) {
        case "after_acceptance":
          base.due_anchor = "acceptance";
          base.acceptance_offset_days = Math.max(0, Math.floor(p.timing.days || 0));
          break;
        case "fixed_date":
          base.due_anchor = "fixed_date";
          base.fixed_due_date = p.timing.date;
          break;
        case "before_arrival":
          base.due_anchor = "relative_to_arrival";
          base.arrival_offset_days = -Math.max(0, Math.floor(p.timing.days || 0));
          break;
        case "monthly":
          base.due_anchor = "month_day";
          base.due_day = p.timing.day;
          base.first_due_month = p.timing.startMonth;
          base.first_due_year = p.timing.startYear;
          break;
      }
      switch (p.invoice.kind) {
        case "on_acceptance":
          base.generation_rule = "immediate";
          break;
        case "month_before_15th":
          base.generation_rule = "preceding_month_15th";
          break;
        case "days_before_due":
          base.generation_rule = "days_before_due";
          base.generation_lead_days = Math.max(0, Math.floor(p.invoice.days || 0));
          break;
      }
      items.push(base);
    });
  }

  return { tiers, items, errors: [...new Set(errors)], warnings };
}

// ── Converting existing per-tier charge lists into a design ──────────

/** The subset of a charge item the converter needs (template or DB row). */
export interface ChargeLike {
  charge_type: string;
  label: string;
  amount_zar: number;
  xero_item_code?: string | null;
  xero_tracking_option?: string | null;
  cadence?: string;
  quantity?: number;
  due_anchor?: string;
  due_day?: number | null;
  first_due_month?: number | null;
  first_due_year?: number | null;
  fixed_due_date?: string | null;
  arrival_offset_days?: number | null;
  acceptance_offset_days?: number | null;
  generation_rule?: string;
  generation_lead_days?: number | null;
  sort_order?: number;
}

/**
 * Turn per-tier charge lists (the FFX 2027 template, or a school's existing
 * hand-made charges) into a design with fixed amounts. Charges are matched
 * across tiers by type + label, so tier A's "Deposit" and tier B's "Deposit"
 * become one payment with two amounts. Each tier's price is its total.
 */
export function designFromCharges(byTier: Partial<Record<Tier, ChargeLike[]>>): PaymentScheduleDesign {
  const payments: SchedulePayment[] = [];
  const index = new Map<string, SchedulePayment>();
  const tierPrices: Record<Tier, number | null> = { A: null, B: null, C: null };

  for (const tier of SCHEDULE_TIERS) {
    const list = [...(byTier[tier] ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    if (list.length === 0) continue;
    let total = 0;
    for (const c of list) {
      const n = c.cadence === "monthly" ? Math.max(1, c.quantity ?? 1) : 1;
      total += Number(c.amount_zar) * n;
      const id = `${c.charge_type}::${c.label}`;
      let p = index.get(id);
      if (!p) {
        p = emptyPayment({
          label: c.label,
          amount: { mode: "fixed", A: null, B: null, C: null },
          timing: timingFrom(c),
          invoice: invoiceFrom(c),
          trackingOption: c.xero_tracking_option ?? null,
        });
        index.set(id, p);
        payments.push(p);
      }
      if (p.amount.mode === "fixed") p.amount[tier] = Number(c.amount_zar);
      p.itemCodes[tier] = c.xero_item_code ?? null;
    }
    tierPrices[tier] = cents(total);
  }
  return { tierPrices, payments };
}

function timingFrom(c: ChargeLike): PaymentTiming {
  if (c.cadence === "monthly") {
    return {
      kind: "monthly",
      count: Math.max(1, c.quantity ?? 1),
      day: c.due_day ?? 1,
      startMonth: c.first_due_month ?? 1,
      startYear: c.first_due_year ?? new Date().getUTCFullYear(),
    };
  }
  switch (c.due_anchor) {
    case "fixed_date":
      return { kind: "fixed_date", date: c.fixed_due_date ?? "" };
    case "relative_to_arrival":
      return { kind: "before_arrival", days: Math.abs(c.arrival_offset_days ?? 0) };
    case "month_day":
      // A one-off on a month/day: closest equivalent is that exact date.
      return {
        kind: "fixed_date",
        date: `${c.first_due_year ?? new Date().getUTCFullYear()}-${String(c.first_due_month ?? 1).padStart(2, "0")}-${String(c.due_day ?? 1).padStart(2, "0")}`,
      };
    default:
      return { kind: "after_acceptance", days: c.acceptance_offset_days ?? 0 };
  }
}

function invoiceFrom(c: ChargeLike): InvoiceTiming {
  switch (c.generation_rule) {
    case "preceding_month_15th":
      return { kind: "month_before_15th" };
    case "days_before_due":
      return { kind: "days_before_due", days: c.generation_lead_days ?? 0 };
    default:
      return { kind: "on_acceptance" };
  }
}

/** Parse a stored design defensively — jsonb from the database is untrusted shape. */
export function parseDesign(row: { tier_prices?: unknown; payments?: unknown } | null): PaymentScheduleDesign | null {
  if (!row) return null;
  const tp = (row.tier_prices ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    tierPrices: { A: num(tp.A), B: num(tp.B), C: num(tp.C) },
    payments: Array.isArray(row.payments) ? (row.payments as SchedulePayment[]) : [],
  };
}
