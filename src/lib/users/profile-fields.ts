// ────────────────────────────────────────────────────────────
// REQUIRED PROFILE FIELDS — single source of truth
// ────────────────────────────────────────────────────────────
// This list is consumed by:
//   - ProfileCompletionGate: blocks the app until these are filled
//   - lifecycle.ts: derives the "Profile Incomplete" badge on the
//     Users admin table so super admins can see who's stuck
// Add a field here and both surfaces pick it up automatically.

import {
  COUNTRY_OPTIONS,
  NATIONALITY_OPTIONS,
  SA_PROVINCES,
  GENDER_OPTIONS,
  RELATIONSHIP_OPTIONS,
  INSURANCE_PROVIDERS,
} from "@/lib/profile/options";

export type FieldConfig = {
  field: string;
  label: string;
  // `phone`: country-code dropdown + digits.
  // `select-with-other`: dropdown with an "Other" sentinel that
  //   reveals a follow-up free-text input (used for province /
  //   insurance provider where the curated list might miss someone).
  type:
    | "text"
    | "select"
    | "select-with-other"
    | "date"
    | "tel"
    | "phone";
  placeholder?: string;
  options?: { value: string; label: string }[];
  // Only meaningful outside REQUIRED_PROFILE_FIELDS (the gate treats every
  // field it's handed as mandatory). The editable profile page reads this
  // to decide whether an empty value blocks a section save — e.g.
  // preferred_name, address_line_2 and the passport/visa fields are
  // optional for non-international staff.
  optional?: boolean;
};

export const REQUIRED_PROFILE_FIELDS: FieldConfig[] = [
  // ── Personal ─────────────────────────────────────────────
  { field: "first_name", label: "First Name", type: "text", placeholder: "Your first name" },
  { field: "last_name", label: "Last Name", type: "text", placeholder: "Your last name" },
  { field: "gender", label: "Gender", type: "select", options: GENDER_OPTIONS },
  {
    field: "marital_status",
    label: "Marital Status",
    type: "select",
    options: [
      { value: "single", label: "Single" },
      { value: "married", label: "Married" },
      { value: "divorced", label: "Divorced" },
      { value: "widowed", label: "Widowed" },
    ],
  },
  { field: "date_of_birth", label: "Date of Birth", type: "date" },
  { field: "nationality", label: "Nationality", type: "select", options: NATIONALITY_OPTIONS },
  { field: "phone", label: "Phone Number", type: "phone" },
  {
    field: "department",
    label: "Department",
    type: "select",
    options: [
      { value: "prayer_and_worship", label: "Prayer and Worship" },
      { value: "media", label: "Media" },
      { value: "hulk", label: "Hulk" },
      { value: "backbone", label: "Backbone" },
      { value: "training", label: "Training" },
      { value: "project_54", label: "Project 54" },
      { value: "education", label: "Education" },
      { value: "woven", label: "Woven" },
    ],
  },
  // ── Address ──────────────────────────────────────────────
  // address_line_2 stays optional (apartment / unit number).
  // Passport / visa fields are intentionally not enforced here —
  // they only apply to international staff and the gate has no way
  // to express that conditional. The onboarding form handles it.
  { field: "country", label: "Country", type: "select", options: COUNTRY_OPTIONS },
  { field: "address_line_1", label: "Address Line 1", type: "text", placeholder: "Street address" },
  { field: "city", label: "City", type: "text", placeholder: "e.g. Potchefstroom" },
  { field: "province", label: "Province / State", type: "select-with-other", options: SA_PROVINCES },
  { field: "postal_code", label: "Postal Code", type: "text", placeholder: "e.g. 2520" },
  // ── Emergency contact ────────────────────────────────────
  { field: "emergency_contact_name", label: "Emergency Contact Name", type: "text", placeholder: "Full name" },
  { field: "emergency_contact_phone", label: "Emergency Contact Phone", type: "phone" },
  { field: "emergency_contact_relationship", label: "Emergency Contact Relationship", type: "select", options: RELATIONSHIP_OPTIONS },
  // ── Health insurance ─────────────────────────────────────
  // No expiry date: SA medical schemes don't lapse on a fixed date. We keep
  // the data current with a 6-monthly re-confirmation instead (see below).
  { field: "health_insurance_provider", label: "Health Insurance Provider", type: "select-with-other", options: INSURANCE_PROVIDERS },
  { field: "health_insurance_policy_number", label: "Health Insurance Policy Number", type: "text", placeholder: "e.g. 123456789" },
];

export function getMissingProfileFields(
  profile: Record<string, unknown>
): FieldConfig[] {
  return REQUIRED_PROFILE_FIELDS.filter((f) => {
    const value = profile[f.field];
    return value === null || value === undefined || value === "";
  });
}

// ────────────────────────────────────────────────────────────
// HEALTH INSURANCE — PERIODIC SELF-CONFIRMATION
// ────────────────────────────────────────────────────────────
// SA medical schemes don't lapse on a fixed date, so instead of an expiry
// date we ask each user to confirm — every 6 months — that their cover is
// still current. Validity is derived from `health_insurance_confirmed_at`:
// confirmed within the window → "ok"; older (or never) → re-confirmation is
// due and the gate blocks until they re-confirm. Dates are compared as
// calendar days in SA time so there's no UTC-midnight drift.

// The insurance fields, pulled straight from the required list so they never
// drift out of sync with it (provider + policy number — no expiry).
export const HEALTH_INSURANCE_FIELDS: FieldConfig[] = REQUIRED_PROFILE_FIELDS.filter(
  (f) => f.field.startsWith("health_insurance_")
);

// How long a confirmation stays valid before we ask again.
export const INSURANCE_CONFIRM_MONTHS = 6;

// "ok": confirmed within the window. "due": confirmed but the window has
// lapsed. "unconfirmed": no confirmation on record yet. Both "due" and
// "unconfirmed" block the gate (once a real provider is on file).
export type InsuranceState = "ok" | "due" | "unconfirmed";

export type InsuranceStatus = {
  state: InsuranceState;
  confirmedDate: string | null; // YYYY-MM-DD (SA) of the last confirmation
  nextDueDate: string | null; // YYYY-MM-DD (SA) when re-confirmation falls due
  daysUntilDue: number | null; // whole days until due; negative once overdue
};

// Today as YYYY-MM-DD in South African time (UTC+2, no DST). en-CA
// formats as ISO-style YYYY-MM-DD, which we can compare lexicographically.
export function todayInSA(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// The SA calendar date (YYYY-MM-DD) of an ISO timestamp / date string.
// Returns null for empty or unparseable input.
function saDateOf(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

// Add whole months to a YYYY-MM-DD date, clamping the day to the target
// month's length (e.g. 31 Aug + 6 months → 28/29 Feb, not an overflow).
function addMonthsYmd(ymd: string, months: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  const total = m - 1 + months;
  const ny = y + Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12; // 0-based month, always positive
  const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  const nd = Math.min(d, lastDay);
  return `${ny}-${String(nm + 1).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

// Whole days from `fromYmd` to `toYmd` (positive when `toYmd` is later).
// Parsed at UTC midnight so the result is a pure calendar-day delta.
function daysBetween(fromYmd: string, toYmd: string): number {
  const from = Date.parse(`${fromYmd}T00:00:00Z`);
  const to = Date.parse(`${toYmd}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / 86_400_000);
}

export function getInsuranceStatus(
  profile: Record<string, unknown>,
  today: string = todayInSA()
): InsuranceStatus {
  const confirmedDate = saDateOf(profile["health_insurance_confirmed_at"]);
  if (!confirmedDate) {
    return {
      state: "unconfirmed",
      confirmedDate: null,
      nextDueDate: null,
      daysUntilDue: null,
    };
  }
  const nextDueDate = addMonthsYmd(confirmedDate, INSURANCE_CONFIRM_MONTHS);
  const daysUntilDue = daysBetween(today, nextDueDate);
  const state: InsuranceState = today >= nextDueDate ? "due" : "ok";
  return { state, confirmedDate, nextDueDate, daysUntilDue };
}

// A stored provider of "none" predates the "everyone must carry valid
// cover" rule — treat it as no valid insurance on file so the gate makes
// the user pick a real provider.
function hasNoValidProvider(profile: Record<string, unknown>): boolean {
  const provider = String(profile["health_insurance_provider"] ?? "")
    .trim()
    .toLowerCase();
  return provider === "" || provider === "none";
}

// ────────────────────────────────────────────────────────────
// INTERNATIONAL STAFF — passport & visa (conditional)
// ────────────────────────────────────────────────────────────
// Not in REQUIRED_PROFILE_FIELDS because they only apply when
// `is_international` is true (and visa_type / visa_expiry_date only for a
// long-term visa). The gate collects them progressively: ask for passport
// + visa category first, then on the next pass — once we know it's
// long-term — ask for the visa specifics.
export const PASSPORT_VISA_BASE_FIELDS: FieldConfig[] = [
  { field: "passport_country", label: "Passport Country", type: "select", options: COUNTRY_OPTIONS },
  { field: "passport_number", label: "Passport Number", type: "text", placeholder: "e.g. A12345678" },
  {
    field: "visa_category",
    label: "Visa Status",
    type: "select",
    options: [
      { value: "90_day", label: "90-Day Visa" },
      { value: "long_term", label: "Long-Term Visa" },
    ],
  },
];

export const VISA_LONG_TERM_FIELDS: FieldConfig[] = [
  { field: "visa_type", label: "Visa Type", type: "text", placeholder: "e.g. Religious, Study" },
  { field: "visa_expiry_date", label: "Visa Expiry Date", type: "date" },
];

// Passport/visa fields still missing for an international staff member.
// Returns [] for everyone else — the conditional the flat
// REQUIRED_PROFILE_FIELDS list can't express on its own.
export function getMissingInternationalFields(
  profile: Record<string, unknown>
): FieldConfig[] {
  if (!profile["is_international"]) return [];
  const isEmpty = (f: FieldConfig) => {
    const v = profile[f.field];
    return v === null || v === undefined || v === "";
  };
  const missing = PASSPORT_VISA_BASE_FIELDS.filter(isEmpty);
  if (profile["visa_category"] === "long_term") {
    missing.push(...VISA_LONG_TERM_FIELDS.filter(isEmpty));
  }
  return missing;
}

// ────────────────────────────────────────────────────────────
// THE GATE'S SINGLE SOURCE OF TRUTH
// ────────────────────────────────────────────────────────────
// What (if anything) blocks the user from using the Hub:
//   - "incomplete":        a required field is empty, or no valid provider is
//                          on file (incl. a legacy "none") — show the form
//   - "insurance_confirm": everything is on file but the 6-monthly cover
//                          confirmation has lapsed — show the one-click panel
// Completeness wins so we collect everything in one pass; only once the
// profile is otherwise whole do we enforce a current confirmation.
export type ProfileBlockReason = "incomplete" | "insurance_confirm";

export type ProfileBlock = {
  reason: ProfileBlockReason;
  fields: FieldConfig[];
};

export function getProfileBlock(
  profile: Record<string, unknown>
): ProfileBlock | null {
  const missing = [
    ...getMissingProfileFields(profile),
    ...getMissingInternationalFields(profile),
  ];
  if (missing.length > 0) return { reason: "incomplete", fields: missing };

  // A real provider must be on file — a legacy "none" isn't valid cover, so
  // send them back to the form to pick one.
  if (hasNoValidProvider(profile)) {
    return { reason: "incomplete", fields: HEALTH_INSURANCE_FIELDS };
  }

  // Provider on file but the periodic confirmation has lapsed (or was never
  // recorded) → ask them to re-confirm.
  if (getInsuranceStatus(profile).state !== "ok") {
    return { reason: "insurance_confirm", fields: HEALTH_INSURANCE_FIELDS };
  }
  return null;
}
