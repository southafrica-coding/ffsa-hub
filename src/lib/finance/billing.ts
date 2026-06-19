// ────────────────────────────────────────────────────────────
// FFSA Hub — School Billing shared constants & seed templates
// ────────────────────────────────────────────────────────────
// The FFX 2027 template below mirrors the pricing doc + the two
// Xero item-code CSVs. It is only a *starting point*: every value
// is editable per course/tier in the Billing Setup UI.
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
    blurb: "50% — due relative to arrival.",
    sort: 3,
  },
  quarter_final: {
    label: "Quarter — Final Payment",
    blurb: "50% — due on arrival.",
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

// ────────────────────────────────────────────────────────────
// FFX 2027 SEED TEMPLATE
// Keyed by course code → returns the charge items for a given tier.
// Amounts in ZAR; item codes are identical across the SA & US Xero
// orgs (org only changes account code + tax, handled at invoice time).
// ────────────────────────────────────────────────────────────

export const FFX_2027 = {
  groupName: "FFX Year Long",
  groupCode: "FFX2027",
  year: 2027,
};

type TemplateItem = Omit<ChargeItemInput, "course_id">;

// Helper builders ------------------------------------------------------------

const deposit = (
  tier: Tier,
  amount: number,
  code: string
): TemplateItem => ({
  tier,
  charge_type: "deposit",
  label: "Deposit",
  amount_zar: amount,
  xero_item_code: code,
  cadence: "once",
  quantity: 1,
  due_anchor: "acceptance",
  generation_rule: "immediate",
  sort_order: 0,
});

const monthly = (
  tier: Tier,
  amount: number,
  code: string,
  count: number
): TemplateItem => ({
  tier,
  charge_type: "monthly_tuition",
  label: "Monthly Tuition",
  amount_zar: amount,
  xero_item_code: code,
  cadence: "monthly",
  quantity: count,
  due_anchor: "month_day",
  due_day: 4,
  first_due_month: 2, // February
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
  cadence: "once",
  quantity: 1,
  due_anchor: "fixed_date",
  fixed_due_date: "2027-03-04",
  generation_rule: "preceding_month_15th",
  sort_order: 2,
});

const quarterFirst = (
  tier: Tier,
  amount: number,
  code: string
): TemplateItem => ({
  tier,
  charge_type: "quarter_first",
  label: "First Payment (50%)",
  amount_zar: amount,
  xero_item_code: code,
  cadence: "once",
  quantity: 1,
  due_anchor: "relative_to_arrival",
  arrival_offset_days: -30, // one month before arrival
  generation_rule: "immediate",
  sort_order: 3,
});

const quarterFinal = (
  tier: Tier,
  amount: number,
  code: string
): TemplateItem => ({
  tier,
  charge_type: "quarter_final",
  label: "Final Payment (50%)",
  amount_zar: amount,
  xero_item_code: code,
  cadence: "once",
  quantity: 1,
  due_anchor: "relative_to_arrival",
  arrival_offset_days: 0, // on arrival
  generation_rule: "immediate",
  sort_order: 4,
});

// Per-course, per-tier templates --------------------------------------------

export const FFX_2027_TEMPLATE: Record<
  string,
  Partial<Record<Tier, TemplateItem[]>>
> = {
  // FFX Year Long
  FFXYL: {
    A: [
      deposit("A", 15000, "FFXYL2027-DEP-A"),
      monthly("A", 6000, "FFXYL2027-MON-A", 10),
      outreach("A"),
    ],
    B: [
      deposit("B", 15000, "FFXYL2027-DEP-B"),
      monthly("B", 3950, "FFXYL2027-MON-B", 10),
      outreach("B"),
    ],
    C: [
      deposit("C", 15000, "FFXYL2027-DEP-C"),
      monthly("C", 2000, "FFXYL2027-MON-C", 10),
      outreach("C"),
    ],
  },
  // FFX Quarter (Q1 standalone)
  FFXQ: {
    A: [
      deposit("A", 15000, "FFXQ2027-DEP-A"),
      monthly("A", 4333.33, "FFXQ2027-MON-A", 3),
      outreach("A"),
    ],
    B: [
      deposit("B", 10000, "FFXQ2027-DEP-B"),
      monthly("B", 3950, "FFXQ2027-MON-B", 3),
      outreach("B"),
    ],
    C: [
      deposit("C", 5000, "FFXQ2027-DEP-C"),
      monthly("C", 2000, "FFXQ2027-MON-C", 3),
      outreach("C"),
    ],
  },
  // FFBX Quarter (Q2 standalone)
  FFBXQ: {
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
  // FFWV Quarter (Q3 standalone)
  FFWVQ: {
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
};

export const formatZAR = (amount: number) =>
  new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
  }).format(amount);
