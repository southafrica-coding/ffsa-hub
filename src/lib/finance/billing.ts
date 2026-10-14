// ────────────────────────────────────────────────────────────
// FFSA Hub — School Billing shared constants & seed templates
// ────────────────────────────────────────────────────────────
// Two pricing structures, both from the FFX 2027 doc:
//   • Whole-Program (FFX Year Long): deposit + 10 monthly + outreach
//     = A R120k / B R99.5k / C R80k. scope = 'full_program'.
//   • Standalone quarters (FFX/FFBX/FFWV): each its own price.
//     scope = 'segment'.
// A whole-program student bills from the full_program course; a single-
// course student bills from that segment course. Everything editable
// per course/tier in the UI.
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
  deposit: { label: "Deposit", blurb: "Charged once, on acceptance.", sort: 0 },
  monthly_tuition: {
    label: "Monthly Tuition",
    blurb: "Recurs monthly; invoice generated the 15th of the preceding month.",
    sort: 1,
  },
  outreach: { label: "Outreach", blurb: "Charged once on a fixed date.", sort: 2 },
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
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(
    amount
  );

// ────────────────────────────────────────────────────────────
// FFX 2027 TEMPLATE  (whole-program + standalone quarters)
// ────────────────────────────────────────────────────────────

type TemplateItem = Omit<ChargeItemInput, "course_id">;

/** Name of the Xero tracking category school charges are tagged under. It
 * exists, with this name, in both the SA and US organisations. */
export const XERO_SCHOOLS_TRACKING_CATEGORY = "Schools";

/**
 * The "Schools" tracking option for an FFX 2027 item code, per FFSA's
 * item-code sheet: whole-year and outreach charges are "Gap Year 2027";
 * a standalone quarter is tagged as that quarter. The four option names are
 * identical in the SA and US organisations.
 */
export function ffx2027TrackingOption(code: string): string | null {
  if (code.startsWith("FFXYL2027") || code === "FFXOR2027") return "Gap Year 2027";
  if (code.startsWith("FFXQ2027")) return "FFX 27";
  if (code.startsWith("FFBXQ2027")) return "FFBX 2027";
  if (code.startsWith("FFWVQ2027")) return "FFWV 2027";
  return null;
}

export type CourseTemplate = {
  code: string;
  name: string;
  sequence: number;
  scope: "full_program" | "segment";
  start_date: string;
  end_date: string;
  arrival_date?: string;
  charges: Record<Tier, TemplateItem[]>;
};

const deposit = (
  tier: Tier,
  amount: number,
  code: string,
  opts: { fixedDate?: string } = {}
): TemplateItem => ({
  tier,
  charge_type: "deposit",
  label: "Deposit",
  amount_zar: amount,
  xero_item_code: code,
  xero_tracking_option: ffx2027TrackingOption(code),
  cadence: "once",
  quantity: 1,
  due_anchor: opts.fixedDate ? "fixed_date" : "acceptance",
  fixed_due_date: opts.fixedDate ?? null,
  generation_rule: "immediate",
  sort_order: 0,
});

const monthly = (
  tier: Tier,
  amount: number,
  code: string,
  firstMonth: number,
  count: number
): TemplateItem => ({
  tier,
  charge_type: "monthly_tuition",
  label: "Monthly Tuition",
  amount_zar: amount,
  xero_item_code: code,
  xero_tracking_option: ffx2027TrackingOption(code),
  cadence: "monthly",
  quantity: count,
  due_anchor: "month_day",
  due_day: 4,
  first_due_month: firstMonth,
  first_due_year: 2027,
  generation_rule: "preceding_month_15th",
  sort_order: 1,
});

const outreach = (tier: Tier): TemplateItem => ({
  tier,
  charge_type: "outreach",
  label: "Outreach",
  amount_zar: 45000,
  xero_item_code: "FFXOR2027",
  xero_tracking_option: ffx2027TrackingOption("FFXOR2027"),
  cadence: "once",
  quantity: 1,
  due_anchor: "fixed_date",
  fixed_due_date: "2027-03-04",
  generation_rule: "preceding_month_15th",
  sort_order: 2,
});

const quarterFirst = (tier: Tier, amount: number, code: string): TemplateItem => ({
  tier,
  charge_type: "quarter_first",
  label: "First Payment (50%)",
  amount_zar: amount,
  xero_item_code: code,
  xero_tracking_option: ffx2027TrackingOption(code),
  cadence: "once",
  quantity: 1,
  due_anchor: "relative_to_arrival",
  arrival_offset_days: -30,
  generation_rule: "immediate",
  sort_order: 3,
});

const quarterFinal = (tier: Tier, amount: number, code: string): TemplateItem => ({
  tier,
  charge_type: "quarter_final",
  label: "Final Payment (50%)",
  amount_zar: amount,
  xero_item_code: code,
  xero_tracking_option: ffx2027TrackingOption(code),
  cadence: "once",
  quantity: 1,
  due_anchor: "relative_to_arrival",
  arrival_offset_days: 0,
  generation_rule: "immediate",
  sort_order: 4,
});

export const FFX_2027_PROGRAM_TEMPLATE: {
  label: string;
  wholeProgram: Record<Tier, TemplateItem[]>;
  courses: CourseTemplate[];
} = {
  label: "FFX 2027",
  // Whole-program pricing lives at the PROGRAM level (not a course).
  wholeProgram: {
    A: [
      deposit("A", 15000, "FFXYL2027-DEP-A", { fixedDate: "2027-01-04" }),
      monthly("A", 6000, "FFXYL2027-MON-A", 2, 10),
      outreach("A"),
    ],
    B: [
      deposit("B", 15000, "FFXYL2027-DEP-B", { fixedDate: "2027-01-04" }),
      monthly("B", 3950, "FFXYL2027-MON-B", 2, 10),
      outreach("B"),
    ],
    C: [
      deposit("C", 15000, "FFXYL2027-DEP-C", { fixedDate: "2027-01-04" }),
      monthly("C", 2000, "FFXYL2027-MON-C", 2, 10),
      outreach("C"),
    ],
  },
  courses: [
    // ── Standalone Q1 (FFX) ──
    {
      code: "FFX",
      name: "FFX (Q1 standalone)",
      sequence: 1,
      scope: "segment",
      start_date: "2027-01-01",
      end_date: "2027-04-30",
      charges: {
        A: [
          deposit("A", 15000, "FFXQ2027-DEP-A"),
          monthly("A", 4333.33, "FFXQ2027-MON-A", 2, 3),
          outreach("A"),
        ],
        B: [
          deposit("B", 10000, "FFXQ2027-DEP-B"),
          monthly("B", 3950, "FFXQ2027-MON-B", 2, 3),
          outreach("B"),
        ],
        C: [
          deposit("C", 5000, "FFXQ2027-DEP-C"),
          monthly("C", 2000, "FFXQ2027-MON-C", 2, 3),
          outreach("C"),
        ],
      },
    },
    // ── Standalone Q2 (FFBX) — 50/50 around arrival ──
    {
      code: "FFBX",
      name: "FFBX (Q2 standalone)",
      sequence: 2,
      scope: "segment",
      start_date: "2027-05-01",
      end_date: "2027-07-31",
      charges: {
        A: [
          quarterFirst("A", 12500, "FFBXQ2027-DEP-A"),
          quarterFinal("A", 12500, "FFBXQ2027-BAL-A"),
        ],
        B: [
          quarterFirst("B", 10416.67, "FFBXQ2027-DEP-B"),
          quarterFinal("B", 10416.66, "FFBXQ2027-BAL-B"),
        ],
        C: [
          quarterFirst("C", 8333.34, "FFBXQ2027-DEP-C"),
          quarterFinal("C", 8333.33, "FFBXQ2027-BAL-C"),
        ],
      },
    },
    // ── Standalone Q3 (FFWV) — 50/50 around arrival ──
    {
      code: "FFWV",
      name: "FFWV (Q3 standalone)",
      sequence: 3,
      scope: "segment",
      start_date: "2027-08-01",
      end_date: "2027-11-30",
      charges: {
        A: [
          quarterFirst("A", 12500, "FFWVQ2027-DEP-A"),
          quarterFinal("A", 12500, "FFWVQ2027-BAL-A"),
        ],
        B: [
          quarterFirst("B", 10416.67, "FFWVQ2027-DEP-B"),
          quarterFinal("B", 10416.66, "FFWVQ2027-BAL-B"),
        ],
        C: [
          quarterFirst("C", 8333.34, "FFWVQ2027-DEP-C"),
          quarterFinal("C", 8333.33, "FFWVQ2027-BAL-C"),
        ],
      },
    },
  ],
};
