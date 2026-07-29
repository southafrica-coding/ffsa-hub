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
  // Nationality uses country NAMES (not adjectives) on purpose: the school
  // fee tier is keyed off users.nationality matched against country_tiers
  // (which lists country names), in both the admin billing code and the
  // auto_create_student_fee enrollment trigger. Listing country names keeps
  // that mapping intact.
  { field: "nationality", label: "Nationality", type: "select", options: COUNTRY_OPTIONS },
  { field: "phone", label: "Phone Number", type: "phone" },
  {
    // Options are sourced live from the Ministry tab (staff_ministries) via
    // applyListOptions; this list is only the fallback when that table is
    // empty/unreachable, so its labels are kept matching the ministry names.
    field: "department",
    label: "Department",
    type: "select",
    options: [
      { value: "leadership_team", label: "Leadership Team" },
      { value: "prayer_and_worship", label: "Prayer & Worship" },
      { value: "media", label: "Media" },
      { value: "hulk", label: "HULC" },
      { value: "operations", label: "Operations" },
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

// Which required-field maps to which editable list_options key.
const FIELD_TO_LIST_KEY: Record<string, string> = {
  gender: "gender",
  emergency_contact_relationship: "relationship",
  health_insurance_provider: "insurance_provider",
  department: "department",
};

// Override the bundled option arrays with admin-edited lists from
// public.list_options where one is provided. Any field/list not supplied
// keeps its built-in defaults, so an empty or unreachable table is safe.
export function applyListOptions(
  fields: FieldConfig[],
  sets: Partial<Record<string, { value: string; label: string }[]>>
): FieldConfig[] {
  return fields.map((f) => {
    const key = FIELD_TO_LIST_KEY[f.field];
    const opts = key ? sets[key] : undefined;
    return opts && opts.length > 0 ? { ...f, options: opts } : f;
  });
}

// Fields that don't apply to certain self-signup membership types, so they
// are neither collected nor required for them:
//   - province:   removed for staff / student / community
//   - department: removed for student / community (staff keep it)
// Invited/legacy users (signup_type = null) keep every field.
export function excludedProfileFields(
  signupType: string | null | undefined
): Set<string> {
  const excluded = new Set<string>();
  if (signupType === "staff" || signupType === "student" || signupType === "community") {
    excluded.add("province");
  }
  if (signupType === "student" || signupType === "community") {
    excluded.add("department");
  }
  return excluded;
}

export function getMissingProfileFields(
  profile: Record<string, unknown>
): FieldConfig[] {
  const excluded = excludedProfileFields(profile.signup_type as string | null | undefined);
  return REQUIRED_PROFILE_FIELDS.filter((f) => {
    if (excluded.has(f.field)) return false;
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

// Leader-escalation windows (dashboard notifications, see
// services/notifications.ts). At 4 weeks the person's leader is nudged; at
// 1 week the development team (super_admin/admin) is notified too, as a
// final catch-all for everyone regardless of role.
export const INSURANCE_LEADER_ALERT_DAYS = 28; // 4 weeks → the person's leader
export const INSURANCE_DEV_TEAM_ALERT_DAYS = 7; // 1 week  → development team

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
// PASSPORT — required for EVERYONE
// ────────────────────────────────────────────────────────────
// Passport details are collected from all staff, South African or not.
// Kept out of REQUIRED_PROFILE_FIELDS only so the passport section can be
// grouped on its own surfaces; the gate enforces it via getMissingPassportFields
// below. passport_country defaults to South Africa in the forms but stays a
// real selectable field so dual-nationals can record the passport they
// actually travel on.
export const PASSPORT_FIELDS: FieldConfig[] = [
  { field: "passport_country", label: "Passport Country", type: "select", options: COUNTRY_OPTIONS },
  { field: "passport_number", label: "Passport Number", type: "text", placeholder: "e.g. A12345678" },
  { field: "passport_expiry_date", label: "Passport Expiry Date", type: "date" },
];

// ────────────────────────────────────────────────────────────
// VISA — international (non-South-African) staff only
// ────────────────────────────────────────────────────────────
// Only applies when `is_international` is true (and visa_type /
// visa_expiry_date only for a long-term visa). The gate collects them
// progressively: ask for the visa category first, then on the next pass —
// once we know it's long-term — ask for the visa specifics.
export const VISA_BASE_FIELDS: FieldConfig[] = [
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

const isFieldEmpty = (profile: Record<string, unknown>) => (f: FieldConfig) => {
  const v = profile[f.field];
  return v === null || v === undefined || v === "";
};

// Passport fields still missing — checked for every user.
export function getMissingPassportFields(
  profile: Record<string, unknown>
): FieldConfig[] {
  return PASSPORT_FIELDS.filter(isFieldEmpty(profile));
}

// Visa fields still missing for an international staff member. Returns []
// for South Africans — the conditional the flat REQUIRED_PROFILE_FIELDS
// list can't express on its own.
export function getMissingVisaFields(
  profile: Record<string, unknown>
): FieldConfig[] {
  if (!profile["is_international"]) return [];
  const isEmpty = isFieldEmpty(profile);
  const missing = VISA_BASE_FIELDS.filter(isEmpty);
  if (profile["visa_category"] === "long_term") {
    missing.push(...VISA_LONG_TERM_FIELDS.filter(isEmpty));
  }
  return missing;
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
  const missing = [
    ...getMissingProfileFields(profile),
    ...getMissingPassportFields(profile),
    ...getMissingVisaFields(profile),
  ];
  if (missing.length > 0) return { reason: "incomplete", fields: missing };

  if (hasNoValidProvider(profile) || getInsuranceStatus(profile).state === "expired") {
    return { reason: "insurance_expired", fields: HEALTH_INSURANCE_FIELDS };
  }
  return null;
}
