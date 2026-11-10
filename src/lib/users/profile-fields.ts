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
import { MARITAL_STATUS_OPTIONS } from "@/lib/users/marital-status";

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
  // `date` fields only. Marks an expiry date that may legitimately be
  // absent because the policy is open-ended — the form renders a
  // "this policy doesn't expire" checkbox alongside it. Purely
  // declarative; the wiring is prop-driven in FieldControl so the
  // household/child variants can opt out.
  allowNoExpiry?: boolean;
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
    // Shared with the family-question rules (marital-status.ts).
    options: [...MARITAL_STATUS_OPTIONS],
  },
  { field: "date_of_birth", label: "Date of Birth", type: "date" },
  // Nationality uses country NAMES (not adjectives) on purpose: the school
  // fee tier is keyed off users.nationality matched against country_tiers
  // (which lists country names), in both the admin billing code and the
  // auto_create_student_fee enrollment trigger. Listing country names keeps
  // that mapping intact.
  { field: "nationality", label: "Nationality", type: "select", options: COUNTRY_OPTIONS },
  {
    // Department sits with the personal-identity fields (not between phone and
    // address) so the contact/address block stays contiguous in the gate form.
    // Options are sourced live from the Ministry tab (staff_ministries) via
    // applyListOptions; this list is only the fallback when that table is
    // empty/unreachable, so its labels are kept matching the ministry names.
    field: "department",
    label: "Department",
    type: "select",
    // Leadership Team is not offered here. Setting department to
    // leadership_team is admin-only (migration 315 / PATCH /api/users/[id]).
    options: [
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
  // ── Contact & Address ────────────────────────────────────
  // address_line_2 stays optional (apartment / unit number).
  // Passport / visa fields are intentionally not enforced here —
  // they only apply to international staff and the gate has no way
  // to express that conditional. The onboarding form handles it.
  { field: "phone", label: "Phone Number", type: "phone" },
  { field: "country", label: "Country", type: "select", options: COUNTRY_OPTIONS },
  { field: "address_line_1", label: "Address Line 1 (current address in South Africa)", type: "text", placeholder: "Current street address in South Africa" },
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
  { field: "health_insurance_expiry_date", label: "Health Insurance Expiry Date", type: "date", allowNoExpiry: true },
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
//   - department: STAFF-ONLY. A department maps to a Ministry team, so only
//                 self-signup staff are asked for it. Students, community
//                 members, and legacy/invited accounts (signup_type = null)
//                 never see or need it — this also keeps a pre-signup_type
//                 student (null) from being prompted for, or nagged about, a
//                 department they shouldn't carry.
export function excludedProfileFields(
  signupType: string | null | undefined
): Set<string> {
  const excluded = new Set<string>();
  if (signupType === "staff" || signupType === "student" || signupType === "community") {
    excluded.add("province");
  }
  if (signupType !== "staff") {
    excluded.add("department");
  }
  return excluded;
}

export function getMissingProfileFields(
  profile: Record<string, unknown>
): FieldConfig[] {
  const excluded = excludedProfileFields(profile.signup_type as string | null | undefined);
  // An open-ended medical scheme has no expiry date to give. The annual
  // re-confirmation (getInsuranceConfirmation) takes its place.
  if (profile["health_insurance_no_expiry"] === true) {
    excluded.add("health_insurance_expiry_date");
  }
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

// "no_expiry" is an open-ended SA medical scheme: permanently valid, so
// it never earns an expiry badge or an expiry alert. Its own annual
// health check is getInsuranceConfirmation() below — deliberately a
// separate axis, since "does it expire?" and "have you confirmed it
// lately?" are orthogonal questions.
export type InsuranceState = "ok" | "no_expiry" | "expiring" | "expired" | "missing";

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
  // Open-ended scheme: valid forever, no date to reason about.
  if (profile["health_insurance_no_expiry"] === true) {
    return { state: "no_expiry", expiryDate: null, daysLeft: null };
  }
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

// True when a member has lined up a valid successor policy (migration 151):
// a real provider and a not-yet-past expiry queued in the next_* columns. Used
// so an expired-but-successor-queued member isn't locked out in the window
// before the daily promotion cron switches them over.
export function hasValidQueuedPolicy(
  profile: Record<string, unknown>,
  today: string = todayInSA()
): boolean {
  const provider = String(profile["next_health_insurance_provider"] ?? "")
    .trim()
    .toLowerCase();
  if (provider === "" || provider === "none") return false;
  // A queued open-ended policy is valid by definition — no date to check.
  if (profile["next_health_insurance_no_expiry"] === true) return true;
  const raw = profile["next_health_insurance_expiry_date"];
  if (typeof raw !== "string") return false;
  const expiry = raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return false; // must be a real date
  return !isExpiryDatePast(expiry, today); // …and not already past
}

// ────────────────────────────────────────────────────────────
// ANNUAL RE-CONFIRMATION (open-ended policies only)
// ────────────────────────────────────────────────────────────
// A no-expiry policy never lapses on its own, so nothing would ever
// prompt the member to tell us they'd switched schemes. Once a year they
// confirm it's still active (users.health_insurance_confirmed_at) — a
// banner first, and only after a long grace period does the gate step in.
//
// This is deliberately NOT another InsuranceState: a policy is
// simultaneously "no_expiry" and possibly "due", and folding the two
// together would force every badge and alert to re-reason about validity.
export const INSURANCE_CONFIRM_INTERVAL_DAYS = 365;
export const INSURANCE_CONFIRM_NUDGE_DAYS = 14; // banner opens this early
export const INSURANCE_CONFIRM_GRACE_DAYS = 60; // …and blocks this late

export type InsuranceConfirmLevel = "current" | "due_soon" | "due" | "blocking";

export type InsuranceConfirmation = {
  level: InsuranceConfirmLevel;
  confirmedAt: string | null; // YYYY-MM-DD
  dueOn: string | null; // YYYY-MM-DD
  daysUntilDue: number | null; // negative once overdue
};

// Add days to a YYYY-MM-DD calendar date, returning YYYY-MM-DD.
function addDays(ymd: string, days: number): string {
  const ms = Date.parse(`${ymd}T00:00:00Z`);
  if (Number.isNaN(ms)) return ymd;
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}

// Only meaningful for an open-ended policy; everyone else is "current"
// so callers never have to branch on the flag themselves.
export function getInsuranceConfirmation(
  profile: Record<string, unknown>,
  today: string = todayInSA()
): InsuranceConfirmation {
  const none: InsuranceConfirmation = {
    level: "current",
    confirmedAt: null,
    dueOn: null,
    daysUntilDue: null,
  };
  if (profile["health_insurance_no_expiry"] !== true) return none;

  const raw = profile["health_insurance_confirmed_at"];
  const confirmedAt =
    typeof raw === "string" && /^\d{4}-\d{2}-\d{2}/.test(raw.slice(0, 10))
      ? raw.slice(0, 10)
      : null;

  // No confirmation on record (a legacy row, or a write path that missed
  // the column) is "due" but NEVER blocking — a data gap must not lock
  // anyone out of the Hub.
  if (!confirmedAt) {
    return { level: "due", confirmedAt: null, dueOn: null, daysUntilDue: null };
  }

  const dueOn = addDays(confirmedAt, INSURANCE_CONFIRM_INTERVAL_DAYS);
  const daysUntilDue = daysBetween(today, dueOn);

  let level: InsuranceConfirmLevel;
  if (daysUntilDue > INSURANCE_CONFIRM_NUDGE_DAYS) level = "current";
  else if (daysUntilDue > 0) level = "due_soon";
  else if (daysUntilDue >= -INSURANCE_CONFIRM_GRACE_DAYS) level = "due";
  else level = "blocking";

  return { level, confirmedAt, dueOn, daysUntilDue };
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

// ────────────────────────────────────────────────────────────
// HOUSEHOLD / FAMILY MEMBERS
// ────────────────────────────────────────────────────────────
// A staff member's spouse / children / dependents, stored in the
// separate public.household_members table (one row per member). The
// field names deliberately match that table's columns AND the per-user
// passport / visa / insurance columns, so the same FieldConfig UI is
// reused. Only relationship + full_name are required; everything else is
// optional and NEVER blocks the Hub (household data doesn't feed the
// completion gate). The visa fields are shown only when a member is
// marked international (mirrors the account-holder is_international flow).
export const HOUSEHOLD_RELATIONSHIP_OPTIONS: { value: string; label: string }[] = [
  { value: "spouse", label: "Spouse" },
  { value: "child", label: "Child" },
  { value: "dependent", label: "Dependent" },
];

// The core (always-visible) fields for a household member.
export const HOUSEHOLD_CORE_FIELDS: FieldConfig[] = [
  { field: "relationship", label: "Relationship", type: "select", options: HOUSEHOLD_RELATIONSHIP_OPTIONS },
  { field: "full_name", label: "Full Name (as on passport)", type: "text", placeholder: "Full name" },
  { field: "date_of_birth", label: "Date of Birth", type: "date", optional: true },
  { field: "gender", label: "Gender", type: "select", options: GENDER_OPTIONS, optional: true },
];

// A spouse is captured lightly: just enough to link their own account later.
// (No passport / visa / insurance — unlike children.)
export const HOUSEHOLD_SPOUSE_FIELDS: FieldConfig[] = [
  { field: "first_name", label: "First Name", type: "text", placeholder: "First name" },
  { field: "last_name", label: "Last Name", type: "text", placeholder: "Last name" },
  { field: "email", label: "Email", type: "text", placeholder: "name@example.com" },
];

// Passport / visa / insurance blocks reuse the same field configs as the
// account holder, but marked optional for family members.
const asOptional = (fields: FieldConfig[]): FieldConfig[] =>
  fields.map((f) => ({ ...f, optional: true }));

export const HOUSEHOLD_PASSPORT_FIELDS: FieldConfig[] = asOptional(PASSPORT_FIELDS);
export const HOUSEHOLD_VISA_BASE_FIELDS: FieldConfig[] = asOptional(VISA_BASE_FIELDS);
export const HOUSEHOLD_VISA_LONG_TERM_FIELDS: FieldConfig[] = asOptional(VISA_LONG_TERM_FIELDS);
export const HOUSEHOLD_INSURANCE_FIELDS: FieldConfig[] = asOptional(
  REQUIRED_PROFILE_FIELDS.filter((f) => f.field.startsWith("health_insurance_"))
);

// Every household field the API accepts / the UI may render, in display
// order. Consumers decide which visa fields to actually show based on the
// member's is_international / visa_category values.
export const HOUSEHOLD_MEMBER_FIELDS: FieldConfig[] = [
  ...HOUSEHOLD_CORE_FIELDS,
  ...HOUSEHOLD_PASSPORT_FIELDS,
  ...HOUSEHOLD_VISA_BASE_FIELDS,
  ...HOUSEHOLD_VISA_LONG_TERM_FIELDS,
  ...HOUSEHOLD_INSURANCE_FIELDS,
];

// The scalar column names the household API is allowed to write (mirrors
// the profile-update safelist pattern). `is_international` is a boolean
// toggle handled alongside these.
export const HOUSEHOLD_WRITABLE_FIELDS: string[] = [
  "relationship",
  "full_name",
  "first_name",
  "last_name",
  "email",
  "date_of_birth",
  "gender",
  "passport_country",
  "passport_number",
  "passport_expiry_date",
  "is_international",
  "visa_category",
  "visa_type",
  "visa_expiry_date",
  "health_insurance_provider",
  "health_insurance_policy_number",
  "health_insurance_expiry_date",
  "health_insurance_no_expiry",
];

// ────────────────────────────────────────────────────────────
// MANDATORY CHILDREN GATE (staff)
// ────────────────────────────────────────────────────────────
// Staff must declare whether they have children (users.has_children,
// migration 155). If they do, EVERY child (relationship = 'child') must
// have a complete record before the Hub unblocks — enforced by
// getChildrenBlock below and the profile-completion gate. Spouse and
// dependent records are unaffected (they never block).
//
// "Complete" = all of these non-empty, plus visa when the child is
// international. Unlike the account holder, we do NOT additionally require
// a child's passport/insurance to be UNEXPIRED — a lapsed child policy
// must never lock the parent out of their own work; we only need the
// details on file.
export const CHILD_REQUIRED_FIELDS: string[] = [
  "full_name",
  "date_of_birth",
  "gender",
  "passport_country",
  "passport_number",
  "passport_expiry_date",
  "health_insurance_provider",
  "health_insurance_policy_number",
  // health_insurance_expiry_date is required too, but conditionally —
  // a child on an open-ended scheme has no date to give. See
  // missingChildFields.
];

// A "member" here is a household_members row (or the in-progress form
// values). Returns true when every required field is present and the
// insurance provider is real (not empty / "none"), including visa fields
// when the child is flagged international.
export function isChildComplete(member: Record<string, unknown>): boolean {
  return missingChildFields(member).length === 0;
}

// The human labels of everything still missing on a child record, in
// display order. isChildComplete is just "this list is empty", so the two
// can never drift — and the forms can tell the user exactly WHICH field is
// missing instead of a blanket "fill in every field" (which read as "your
// visa details are wrong" even when the gap was, say, gender).
export function missingChildFields(member: Record<string, unknown>): string[] {
  const empty = (key: string) => {
    const v = member[key];
    return v === null || v === undefined || String(v).trim() === "";
  };
  const labelFor = (key: string) =>
    HOUSEHOLD_MEMBER_FIELDS.find((f) => f.field === key)?.label ?? key;

  const missing = CHILD_REQUIRED_FIELDS.filter(empty).map(labelFor);

  // The expiry date is required unless the child's policy is open-ended.
  // Getting this wrong locks the PARENT out behind the full-screen
  // children gate, so it is checked explicitly rather than by omission.
  if (member["health_insurance_no_expiry"] !== true && empty("health_insurance_expiry_date")) {
    missing.push(labelFor("health_insurance_expiry_date"));
  }

  // "None" is a real option on the provider dropdown but not an acceptable
  // answer for a child, so it counts as missing rather than filled in.
  const provider = String(member["health_insurance_provider"] ?? "")
    .trim()
    .toLowerCase();
  if (provider === "none" && !missing.includes(labelFor("health_insurance_provider"))) {
    missing.push(labelFor("health_insurance_provider"));
  }

  if (member["is_international"]) {
    if (empty("visa_category")) missing.push(labelFor("visa_category"));
    if (member["visa_category"] === "long_term") {
      if (empty("visa_type")) missing.push(labelFor("visa_type"));
      if (empty("visa_expiry_date")) missing.push(labelFor("visa_expiry_date"));
    }
  }
  return missing;
}

export type ChildrenBlock = { reason: "children_incomplete" };

// The gate's children check. `hasChildren` is users.has_children.
//   null  → unanswered; the gate asks the Yes/No question (not here).
//   false → no children; never blocks.
//   true  → require ≥1 complete child record, else block.
export function getChildrenBlock(
  hasChildren: boolean | null | undefined,
  members: Array<Record<string, unknown>>
): ChildrenBlock | null {
  if (hasChildren !== true) return null;
  const children = members.filter((m) => m.relationship === "child");
  const hasComplete = children.some(isChildComplete);
  return hasComplete ? null : { reason: "children_incomplete" };
}

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
//   - "insurance_unconfirmed": an open-ended policy is long past its
//                          annual re-confirmation
// Completeness wins so we collect everything in one pass; only once the
// profile is otherwise whole do we enforce a current insurance policy.
export type ProfileBlockReason =
  | "incomplete"
  | "insurance_expired"
  | "insurance_unconfirmed";

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

  const noProvider = hasNoValidProvider(profile);
  const status = getInsuranceStatus(profile);
  const currentExpired = status.state === "expired";
  if (noProvider || currentExpired) {
    // A lapsed current policy doesn't block the Hub if a valid successor is
    // already queued — the daily promotion cron switches it over the day after
    // expiry, so this only covers the short gap before that runs. (A "none"
    // provider still blocks: there's no valid current expiry to switch on.)
    if (currentExpired && !noProvider && hasValidQueuedPolicy(profile)) {
      return null;
    }
    return { reason: "insurance_expired", fields: HEALTH_INSURANCE_FIELDS };
  }

  // An open-ended policy can never read as "expired", so it reaches the
  // Hub through its own check: confirmed within the last year (plus a
  // generous grace period on top of the banner nudges).
  if (
    status.state === "no_expiry" &&
    getInsuranceConfirmation(profile).level === "blocking"
  ) {
    return { reason: "insurance_unconfirmed", fields: HEALTH_INSURANCE_FIELDS };
  }
  return null;
}
