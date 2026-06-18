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
  { field: "health_insurance_provider", label: "Health Insurance Provider", type: "select-with-other", options: INSURANCE_PROVIDERS },
  { field: "health_insurance_policy_number", label: "Health Insurance Policy Number", type: "text", placeholder: "e.g. 123456789" },
  { field: "health_insurance_expiry_date", label: "Health Insurance Expiry Date", type: "date" },
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
// HEALTH INSURANCE VALIDITY
// ────────────────────────────────────────────────────────────
// Beyond "is the field filled in?", health insurance must stay CURRENT.
// The gate blocks the Hub once a policy has lapsed; a banner warns in the
// run-up. Dates are compared as calendar days in SA time so the expiry
// day itself still counts as valid and there's no UTC-midnight drift.

// The three insurance fields, pulled straight from the required list so
// they never drift out of sync with it.
export const HEALTH_INSURANCE_FIELDS: FieldConfig[] = REQUIRED_PROFILE_FIELDS.filter(
  (f) => f.field.startsWith("health_insurance_")
);

// How many days before expiry we start the (non-blocking) warning.
export const INSURANCE_WARNING_DAYS = 60;

export type InsuranceState = "ok" | "expiring" | "expired" | "missing";

export type InsuranceStatus = {
  state: InsuranceState;
  expiryDate: string | null; // YYYY-MM-DD
  daysLeft: number | null; // whole days until expiry; negative once past
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

// Whole days from `fromYmd` to `toYmd` (positive when `toYmd` is later).
// Parsed at UTC midnight so the result is a pure calendar-day delta.
function daysBetween(fromYmd: string, toYmd: string): number {
  const from = Date.parse(`${fromYmd}T00:00:00Z`);
  const to = Date.parse(`${toYmd}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / 86_400_000);
}

// True when a value is a real calendar date strictly before today (SA
// time). Empty/garbage → false (that's "missing", handled elsewhere).
export function isExpiryDatePast(
  value: unknown,
  today: string = todayInSA()
): boolean {
  if (typeof value !== "string" || value.trim() === "") return false;
  const date = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  return date < today;
}

export function getInsuranceStatus(
  profile: Record<string, unknown>,
  today: string = todayInSA()
): InsuranceStatus {
  const raw = profile["health_insurance_expiry_date"];
  if (typeof raw !== "string" || raw.trim() === "") {
    return { state: "missing", expiryDate: null, daysLeft: null };
  }
  const expiryDate = raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) {
    return { state: "missing", expiryDate: null, daysLeft: null };
  }
  const daysLeft = daysBetween(today, expiryDate);
  if (expiryDate < today) return { state: "expired", expiryDate, daysLeft };
  if (daysLeft <= INSURANCE_WARNING_DAYS) {
    return { state: "expiring", expiryDate, daysLeft };
  }
  return { state: "ok", expiryDate, daysLeft };
}

// A stored provider of "none" predates the "everyone must carry valid
// cover" rule — treat it as no valid insurance on file so the gate makes
// the user pick a real provider.
function hasNoValidProvider(profile: Record<string, unknown>): boolean {
  const provider = String(profile["health_insurance_provider"] ?? "")
    .trim()
    .toLowerCase();
  return provider === "none";
}

// ────────────────────────────────────────────────────────────
// THE GATE'S SINGLE SOURCE OF TRUTH
// ────────────────────────────────────────────────────────────
// What (if anything) blocks the user from using the Hub:
//   - "incomplete":        one or more required fields are empty
//   - "insurance_expired": fields are filled but the policy has lapsed
//                          (or a legacy "none" provider is on file)
// Completeness wins so we collect everything in one pass; only once the
// profile is otherwise whole do we enforce a current insurance policy.
export type ProfileBlockReason = "incomplete" | "insurance_expired";

export type ProfileBlock = {
  reason: ProfileBlockReason;
  fields: FieldConfig[];
};

export function getProfileBlock(
  profile: Record<string, unknown>
): ProfileBlock | null {
  const missing = getMissingProfileFields(profile);
  if (missing.length > 0) return { reason: "incomplete", fields: missing };

  if (hasNoValidProvider(profile) || getInsuranceStatus(profile).state === "expired") {
    return { reason: "insurance_expired", fields: HEALTH_INSURANCE_FIELDS };
  }
  return null;
}
