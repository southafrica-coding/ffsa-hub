// Pure rules for the Me document screens (licence, passport, insurance,
// household, CV). Each mirrors a website rule so the phone and the web agree;
// the server re-checks everything, so these are for quick, friendly feedback.
// Sources are named on each block.

import type { Me } from "@/lib/api";

// ── Dates ───────────────────────────────────────────────────────────────────

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Today as YYYY-MM-DD in South African time (web: todayInSA). */
export function todayInSA(now: Date = new Date()): string {
  // SAST is UTC+2 all year (no daylight saving).
  return new Date(now.getTime() + 2 * 3_600_000).toISOString().slice(0, 10);
}

/** First 10 characters when they look like a date, else "". */
export function ymd(value: unknown): string {
  if (typeof value !== "string") return "";
  const d = value.slice(0, 10);
  return YMD.test(d) ? d : "";
}

/** "3 Sep 2026" for a YYYY-MM-DD (or ISO) value; the input when unreadable. */
export function formatDate(value: string | null | undefined): string {
  const d = ymd(value);
  if (!d) return value ?? "";
  const [y, m, day] = d.split("-").map((n) => parseInt(n, 10));
  return `${day} ${MONTHS[m - 1]} ${y}`;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function addDays(d: string, days: number): string {
  return new Date(Date.parse(`${d}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** A real date strictly before today (web: isExpiryDatePast). */
export function isPast(value: string | null | undefined, today = todayInSA()): boolean {
  const d = ymd(value);
  return !!d && d < today;
}

// ── Staff (web profile page: showWorkTab) ───────────────────────────────────

const MEMBERSHIP_ONLY = new Set(["student", "community_member", "self_service"]);

/** Staff = holds any role beyond the membership floor (same test as the web's Work tab). */
export function isStaff(me: Me | null): boolean {
  return !!me?.roles.some((r) => r.name && !MEMBERSHIP_ONLY.has(r.name));
}

// ── Health insurance (web: lib/profile/options.ts, lib/users/profile-fields.ts,
//    lib/users/insurance-policies.ts) ─────────────────────────────────────────

export type Option = { value: string; label: string };

/** Fallback when the admin-edited list (list_options) can't be read. */
export const INSURANCE_PROVIDERS: Option[] = [
  { value: "Discovery Health", label: "Discovery Health" },
  { value: "Bonitas", label: "Bonitas" },
  { value: "Momentum Health", label: "Momentum Health" },
  { value: "Medihelp", label: "Medihelp" },
  { value: "Fedhealth", label: "Fedhealth" },
  { value: "Bestmed", label: "Bestmed" },
  { value: "GEMS", label: "GEMS (Government Employees)" },
  { value: "Polmed", label: "Polmed (Police)" },
  { value: "Profmed", label: "Profmed" },
  { value: "Sizwe Hosmed", label: "Sizwe Hosmed" },
  { value: "Liberty Health", label: "Liberty Health" },
  { value: "other", label: "Other (specify)" },
];

const lc = (v: string | null | undefined) => String(v ?? "").trim().toLowerCase();

/** Choices for a provider picker: never the legacy "none", always an "other" at the end. */
export function providerChoices(list: Option[]): Option[] {
  const base = (list.length ? list : INSURANCE_PROVIDERS).filter((o) => lc(o.value) !== "none");
  return base.some((o) => lc(o.value) === "other") ? base : [...base, { value: "other", label: "Other (specify)" }];
}

/** Only a listed scheme may be open-ended (web: providerAllowsNoExpiry). */
export function providerAllowsNoExpiry(provider: string | null | undefined, options: Option[]): boolean {
  const v = lc(provider);
  if (v === "" || v === "other" || v === "none") return false;
  return options.some((o) => lc(o.value) === v);
}

/**
 * Split a stored provider into the picker value + free text: a listed value
 * stays as-is, anything else is "other" with the text filled in.
 */
export function splitProvider(stored: string | null | undefined, options: Option[]): { choice: string; other: string } {
  const v = String(stored ?? "").trim();
  if (!v || lc(v) === "none") return { choice: "", other: "" };
  const hit = options.find((o) => lc(o.value) === lc(v) && lc(o.value) !== "other");
  return hit ? { choice: hit.value, other: "" } : { choice: "other", other: v };
}

/** The provider to send: the listed value, or the typed name for "other". */
export function joinProvider(choice: string, other: string): string {
  return lc(choice) === "other" ? other.trim() : choice.trim();
}

export function providerLabel(value: string | null | undefined, options: Option[]): string {
  const v = String(value ?? "").trim();
  return options.find((o) => lc(o.value) === lc(v))?.label ?? v;
}

export const INSURANCE_WARNING_DAYS = 60;

export type InsuranceState = "ok" | "no_expiry" | "expiring" | "expired" | "missing";

export type InsuranceRow = {
  provider: string | null;
  policyNumber: string | null;
  expiryDate: string | null;
  noExpiry: boolean;
  confirmedAt: string | null;
};

/** web: getInsuranceStatus. */
export function insuranceStatus(p: Pick<InsuranceRow, "expiryDate" | "noExpiry">, today = todayInSA()) {
  if (p.noExpiry) return { state: "no_expiry" as InsuranceState, expiryDate: null, daysLeft: null };
  const expiryDate = ymd(p.expiryDate);
  if (!expiryDate) return { state: "missing" as InsuranceState, expiryDate: null, daysLeft: null };
  const daysLeft = daysBetween(today, expiryDate);
  if (expiryDate < today) return { state: "expired" as InsuranceState, expiryDate, daysLeft };
  if (daysLeft <= INSURANCE_WARNING_DAYS) return { state: "expiring" as InsuranceState, expiryDate, daysLeft };
  return { state: "ok" as InsuranceState, expiryDate, daysLeft };
}

/** A queued next policy that will actually take over (web: hasValidQueuedPolicy). */
export function hasValidNext(
  next: Pick<InsuranceRow, "provider" | "expiryDate" | "noExpiry"> | null,
  today = todayInSA(),
): boolean {
  if (!next) return false;
  const p = lc(next.provider);
  if (p === "" || p === "none") return false;
  if (next.noExpiry) return true;
  const d = ymd(next.expiryDate);
  return !!d && d >= today;
}

export const CONFIRM_INTERVAL_DAYS = 365;
export const CONFIRM_NUDGE_DAYS = 14;

/** An open-ended policy is due for its yearly "still active?" check (web: getInsuranceConfirmation, level ≠ current). */
export function confirmationDue(p: Pick<InsuranceRow, "noExpiry" | "confirmedAt">, today = todayInSA()): boolean {
  if (!p.noExpiry) return false;
  const at = ymd(p.confirmedAt);
  if (!at) return true;
  return daysBetween(today, addDays(at, CONFIRM_INTERVAL_DAYS)) <= CONFIRM_NUDGE_DAYS;
}

export type PolicyRecord = {
  id: string;
  provider: string;
  policyNumber: string | null;
  expiryDate: string | null;
  noExpiry: boolean;
  recordedAt: string;
};

const norm = (v: string | null | undefined) => (v ?? "").trim();

/** web: currentPolicyId. `policies` newest first. */
export function currentPolicyId(policies: PolicyRecord[], current: InsuranceRow): string | null {
  if (policies.length === 0) return null;
  const match = policies.find(
    (p) =>
      norm(p.provider) === norm(current.provider) &&
      norm(p.policyNumber) === norm(current.policyNumber) &&
      ymd(p.expiryDate) === ymd(current.expiryDate) &&
      p.noExpiry === current.noExpiry,
  );
  return (match ?? policies[0]).id;
}

/** web: deletablePolicyIds — duplicates (shared policy number) that aren't current. */
export function deletablePolicyIds(policies: PolicyRecord[], curId: string | null): Set<string> {
  const count = new Map<string, number>();
  for (const p of policies) count.set(norm(p.policyNumber), (count.get(norm(p.policyNumber)) ?? 0) + 1);
  const out = new Set<string>();
  if (policies.length <= 1) return out;
  for (const p of policies) {
    if (p.id !== curId && (count.get(norm(p.policyNumber)) ?? 0) > 1) out.add(p.id);
  }
  return out;
}

export type PolicyDraft = { choice: string; other: string; policyNumber: string; expiry: string; noExpiry: boolean };

export type PolicyErrors = Partial<Record<"provider" | "other" | "expiry", string>>;

/**
 * Client checks for a policy form (current or next). The server repeats them;
 * `mustFollow` is the current expiry a next policy has to outlast.
 */
export function validatePolicy(
  d: PolicyDraft,
  options: Option[],
  e: { providerRequired: string; otherRequired: string; expiryRequired: string; expiryPast: string; nextAfterCurrent: string },
  opts: { today?: string; mustFollow?: string | null } = {},
): PolicyErrors {
  const errors: PolicyErrors = {};
  const today = opts.today ?? todayInSA();
  if (!d.choice) errors.provider = e.providerRequired;
  else if (lc(d.choice) === "other" && !d.other.trim()) errors.other = e.otherRequired;
  const openEnded = d.noExpiry && providerAllowsNoExpiry(joinProvider(d.choice, d.other), options);
  if (!openEnded) {
    if (!ymd(d.expiry)) errors.expiry = e.expiryRequired;
    else if (d.expiry < today) errors.expiry = e.expiryPast;
    else if (opts.mustFollow && d.expiry <= opts.mustFollow) errors.expiry = e.nextAfterCurrent;
  }
  return errors;
}

/** Body for PUT /api/profile/update (current policy). */
export function currentPolicyBody(d: PolicyDraft, options: Option[]) {
  const provider = joinProvider(d.choice, d.other);
  const noExpiry = d.noExpiry && providerAllowsNoExpiry(provider, options);
  return {
    health_insurance_provider: provider,
    health_insurance_policy_number: d.policyNumber.trim() || null,
    health_insurance_expiry_date: noExpiry ? null : d.expiry,
    health_insurance_no_expiry: noExpiry,
  };
}

/** Body for PUT /api/profile/insurance-next. */
export function nextPolicyBody(d: PolicyDraft, options: Option[]) {
  const provider = joinProvider(d.choice, d.other);
  const noExpiry = d.noExpiry && providerAllowsNoExpiry(provider, options);
  return {
    provider,
    policy_number: d.policyNumber.trim() || null,
    expiry_date: noExpiry ? "" : d.expiry,
    no_expiry: noExpiry,
  };
}

// ── Licence (web: LicenceCard + /api/profile/licence) ──────────────────────

export type LicenceDraft = { number: string; country: string; code: string; expiry: string };

export function validateLicence(d: LicenceDraft, e: { numberRequired: string; expiryRequired: string }) {
  const errors: Partial<Record<"number" | "expiry", string>> = {};
  if (!d.number.trim()) errors.number = e.numberRequired;
  if (!ymd(d.expiry)) errors.expiry = e.expiryRequired;
  return errors;
}

// ── Household (web: HouseholdMembers, lib/users/marital-status.ts) ─────────

/** Which "Add …" buttons to offer: no spouse unless married (or status unknown). */
export function addableRelationships(maritalStatus: string | null | undefined): ("spouse" | "child")[] {
  const s = lc(maritalStatus);
  const noSpouse = s === "single" || s === "divorced" || s === "widowed";
  return noSpouse ? ["child"] : ["spouse", "child"];
}

export type MemberDraft = {
  relationship: string;
  firstName: string;
  lastName: string;
  email: string;
  fullName: string;
  dateOfBirth: string;
  gender: string;
  passportCountry: string;
  passportNumber: string;
  passportExpiry: string;
  isInternational: boolean;
  visaCategory: string;
  visaType: string;
  visaExpiry: string;
  insuranceChoice: string;
  insuranceOther: string;
  policyNumber: string;
  insuranceExpiry: string;
  noExpiry: boolean;
};

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateMember(
  d: MemberDraft,
  e: { spouseFirst: string; spouseLast: string; spouseEmail: string; emailInvalid: string; fullName: string },
) {
  const errors: Partial<Record<"firstName" | "lastName" | "email" | "fullName", string>> = {};
  if (d.relationship === "spouse") {
    if (!d.firstName.trim()) errors.firstName = e.spouseFirst;
    if (!d.lastName.trim()) errors.lastName = e.spouseLast;
    if (!d.email.trim()) errors.email = e.spouseEmail;
    else if (!EMAIL.test(d.email.trim())) errors.email = e.emailInvalid;
  } else if (!d.fullName.trim()) {
    errors.fullName = e.fullName;
  }
  return errors;
}

/**
 * The household API body, mirroring the web form's save(): a spouse sends
 * names + email only (visa cleared); a child's visa fields are cleared unless
 * they're international, and the long-term specifics unless long-term.
 */
export function memberBody(d: MemberDraft, insuranceOptions: Option[]): Record<string, unknown> {
  if (d.relationship === "spouse") {
    return {
      relationship: "spouse",
      first_name: d.firstName.trim(),
      last_name: d.lastName.trim(),
      email: d.email.trim(),
      full_name: `${d.firstName.trim()} ${d.lastName.trim()}`.trim(),
      is_international: false,
      visa_category: "",
      visa_type: "",
      visa_expiry_date: "",
    };
  }
  const provider = joinProvider(d.insuranceChoice, d.insuranceOther);
  const noExpiry = d.noExpiry && providerAllowsNoExpiry(provider, insuranceOptions);
  const longTerm = d.isInternational && d.visaCategory === "long_term";
  return {
    relationship: d.relationship,
    full_name: d.fullName.trim(),
    date_of_birth: d.dateOfBirth,
    gender: d.gender,
    passport_country: d.passportCountry,
    passport_number: d.passportNumber.trim(),
    passport_expiry_date: d.passportExpiry,
    is_international: d.isInternational,
    visa_category: d.isInternational ? d.visaCategory : "",
    visa_type: longTerm ? d.visaType.trim() : "",
    visa_expiry_date: longTerm ? d.visaExpiry : "",
    health_insurance_provider: provider,
    health_insurance_policy_number: d.policyNumber.trim(),
    health_insurance_expiry_date: noExpiry ? "" : d.insuranceExpiry,
    health_insurance_no_expiry: noExpiry,
  };
}

// ── Uploaded files ──────────────────────────────────────────────────────────

/** True when the stored name says PDF (the phone uploads photos only). */
export function isPdfName(name: string | null | undefined): boolean {
  return /\.pdf$/i.test(String(name ?? "").trim());
}

/**
 * Signed URLs come from our own API, but are opened in a browser: only accept
 * an https link to this app's Supabase storage (signed object path).
 */
export function isAllowedSignedUrl(url: string | null | undefined, supabaseUrl: string): url is string {
  if (!url) return false;
  try {
    const u = new URL(url);
    const ours = new URL(supabaseUrl);
    return u.protocol === "https:" && u.host === ours.host && u.pathname.startsWith("/storage/v1/object/sign/");
  } catch {
    return false;
  }
}
