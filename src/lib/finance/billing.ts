// ────────────────────────────────────────────────────────────
// FFSA Hub — School Billing shared constants & seed templates
// ────────────────────────────────────────────────────────────
// The FFX 2027 template is the FULL-PROGRAM schedule decomposed
// into its 3 phases (FFX Q1 / FFBX Q2 / FFWV Q3). The phases sum
// to the full-program tier price (A R120k / B R99.5k / C R80k).
// A student doing the whole year gets all 3; a partial student is
// auto-trimmed to the phases they're enrolled in. Standalone single-
// quarter bespoke pricing is the anomaly, handled as an override.
// Everything here is editable per course/tier in the UI.
// ────────────────────────────────────────────────────────────

import type {
  ChargeItemInput,
  ChargeType,
  Tier,
} from "@/services/school-billing";

export const TIERS: Tier[] = ["A", "B", "C"];

export const CHARGE_TYPE_META: Record<
  ChargeType,
  { label: string; blurb: string; sort: number }
> = {
  deposit: {
    label: "Deposit",
    blurb: "Charged once, on acceptance.",
    sort: 0,
  },
  monthly_tuition: {
    label: "Monthly Tuition",
    blurb: "Recurs monthly; invoice generated the 15th of the preceding month.",
    sort: 1,
  },
  outreach: {
    label: "Outreach",
    blurb: "Charged once on a fixed date.",
    sort: 2,
  },
  quarter_first: {
    label: "Quarter — First Payment",
    blurb: "50% — due relative to arrival (standalone quarter).",
    sort: 3,
  },
  quarter_final: {
    label: "Quarter — Final Payment",
    blurb: "50% — due on arrival (standalone quarter).",
    sort: 4,
  },
};

export const DUE_ANCHOR_LABELS: Record<string, string> = {
  acceptance: "On acceptance",
  month_day: "Day of month",
  fixed_date: "Fixed date",
  relative_to_arrival: "Relative to arrival",
};

export const GENERATION_RULE_LABELS: Record<string, string> = {
  immediate: "Immediately (on acceptance)",
  preceding_month_15th: "15th of preceding month",
  fixed_date: "Fixed date",
  days_before_due: "N days before due",
};

export const PAYMENT_PREFERENCE_LABELS: Record<string, string> = {
  standard: "Standard schedule",
  quarter_prepay: "Quarter prepay",
  full_prepay: "Full program prepay",
};

export const formatZAR = (amount: number) =>
  new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
  }).format(amount);

// ────────────────────────────────────────────────────────────
// FFX 2027 PROGRAM TEMPLATE  (full-program decomposition)
// ────────────────────────────────────────────────────────────
// Monthly tuition per tier: A 6000 / B 3950 / C 2000.
// Phases: Q1 = deposit (Jan 4) + outreach (Mar 4) + monthly Feb–Apr,
//         Q2 = monthly May–Jul, Q3 = monthly Aug–Nov.
// Item codes reuse the loaded FFXYL (year-long) Xero codes.

type TemplateItem = Omit<ChargeItemInput, "course_id">;

export type CourseTemplate = {
  code: string;
  name: string;
  sequence: number;
  scope: "full_program" | "segment";
  start_date: string;
  end_date: string;
  charges: Record<Tier, TemplateItem[]>;
};

const MONTHLY_ZAR: Record<Tier, number> = { A: 6000, B: 3950, C: 2000 };

const deposit = (tier: Tier): TemplateItem => ({
  tier,
  charge_type: "deposit",
  label: "Deposit",
  amount_zar: 15000,
  xero_item_code: `FFXYL2027-DEP-${tier}`,
  cadence: "once",
  quantity: 1,
  due_anchor: "fixed_date",
  fixed_due_date: "2027-01-04",
  generation_rule: "immediate",
  sort_order: 0,
});

const outreach = (tier: Tier): TemplateItem => ({
  tier,
  charge_type: "outreach",
  label: "Outreach",
  amount_zar: 45000,
  xero_item_code: "FFXOR2027",
  cadence: "once",
  quantity: 1,
  due_anchor: "fixed_date",
  fixed_due_date: "2027-03-04",
  generation_rule: "preceding_month_15th",
  sort_order: 2,
});

// Monthly tuition slice for a phase: `count` payments starting `firstMonth`.
const monthly = (tier: Tier, firstMonth: number, count: number): TemplateItem => ({
  tier,
  charge_type: "monthly_tuition",
  label: "Monthly Tuition",
  amount_zar: MONTHLY_ZAR[tier],
  xero_item_code: `FFXYL2027-MON-${tier}`,
  cadence: "monthly",
  quantity: count,
  due_anchor: "month_day",
  due_day: 4,
  first_due_month: firstMonth,
  first_due_year: 2027,
  generation_rule: "preceding_month_15th",
  sort_order: 1,
});

const tierCharges = (
  build: (tier: Tier) => TemplateItem[]
): Record<Tier, TemplateItem[]> => ({
  A: build("A"),
  B: build("B"),
  C: build("C"),
});

export const FFX_2027_PROGRAM_TEMPLATE: {
  label: string;
  courses: CourseTemplate[];
} = {
  label: "FFX 2027",
  courses: [
    {
      code: "FFX",
      name: "FFX (Q1)",
      sequence: 1,
      scope: "segment",
      start_date: "2027-01-01",
      end_date: "2027-04-30",
      charges: tierCharges((t) => [
        deposit(t),
        monthly(t, 2, 3), // Feb, Mar, Apr
        outreach(t),
      ]),
    },
    {
      code: "FFBX",
      name: "FFBX (Q2)",
      sequence: 2,
      scope: "segment",
      start_date: "2027-05-01",
      end_date: "2027-07-31",
      charges: tierCharges((t) => [monthly(t, 5, 3)]), // May, Jun, Jul
    },
    {
      code: "FFWV",
      name: "FFWV (Q3)",
      sequence: 3,
      scope: "segment",
      start_date: "2027-08-01",
      end_date: "2027-11-30",
      charges: tierCharges((t) => [monthly(t, 8, 4)]), // Aug, Sep, Oct, Nov
    },
  ],
};
