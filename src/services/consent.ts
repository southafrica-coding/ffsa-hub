// ────────────────────────────────────────────────────────────
// CONSENT AGREEMENTS + RECORDS
// ────────────────────────────────────────────────────────────
// Reads the current privacy / data-processing agreement and
// records acceptance events for audit purposes.

type Client = any; // eslint-disable-line @typescript-eslint/no-explicit-any

// The policies a person may need to accept to use the Hub. Each has its own
// current version (consent_agreements.kind, migration 164).
export type ConsentKind = "privacy" | "child_protection" | "nda";

// Single source of truth for WHICH policies each audience must sign.
//   audience "all"   → staff, students, community.
//   audience "staff" → staff only (signup_type 'staff' or the staff role).
// Add a future policy by seeding a consent_agreements row + a line here.
export const REQUIRED_CONSENTS: { kind: ConsentKind; audience: "all" | "staff" }[] = [
  { kind: "privacy", audience: "all" },
  { kind: "child_protection", audience: "all" },
  { kind: "nda", audience: "staff" },
];

const CONSENT_KINDS: ConsentKind[] = ["privacy", "child_protection", "nda"];

// Coerce an untrusted string to a valid ConsentKind (defaults to privacy).
export function asConsentKind(value: unknown): ConsentKind {
  return CONSENT_KINDS.includes(value as ConsentKind)
    ? (value as ConsentKind)
    : "privacy";
}

export type ConsentAgreement = {
  id: string;
  version: string;
  kind: ConsentKind;
  title: string;
  body_markdown: string;
  effective_at: string;
  is_current: boolean;
};

// The current published agreement for a given kind (defaults to privacy so
// existing callers keep working).
export async function getCurrentConsentAgreement(
  supabase: Client,
  kind: ConsentKind = "privacy"
) {
  return supabase
    .from("consent_agreements")
    .select("id, version, kind, title, body_markdown, effective_at, is_current")
    .eq("is_current", true)
    .eq("kind", kind)
    .single();
}

export async function getConsentAgreementByVersion(
  supabase: Client,
  version: string
) {
  return supabase
    .from("consent_agreements")
    .select("id, version, kind, title, body_markdown, effective_at, is_current")
    .eq("version", version)
    .single();
}

export async function recordConsent(
  supabase: Client,
  data: {
    agreement_version: string;
    source: "application" | "onboarding";
    user_id?: string | null;
    applicant_email?: string | null;
    application_id?: string | null;
    ip_address?: string | null;
    user_agent?: string | null;
  }
) {
  return supabase.from("consent_records").insert(data).select().single();
}

export async function getConsentRecordsForUser(supabase: Client, userId: string) {
  return supabase
    .from("consent_records")
    .select("*")
    .eq("user_id", userId)
    .order("accepted_at", { ascending: false });
}

// ────────────────────────────────────────────────────────────
// LEGAL / COMPLIANCE CONSOLE (admin-side, cross-user)
// ────────────────────────────────────────────────────────────
// Read every signature across all users + public applicants. Intended to
// run with the SERVICE-ROLE client behind a role gate (legal_admin / admin
// / super_admin), because legal_admin doesn't pass consent_records' is_admin()
// RLS and embedded user joins would null out identity under RLS.

// All signatures, newest first. `version` optionally filters to one policy.
export async function getAllConsentRecords(
  supabase: Client,
  opts?: { version?: string }
) {
  let query = supabase
    .from("consent_records")
    .select("*")
    .order("accepted_at", { ascending: false });
  if (opts?.version) query = query.eq("agreement_version", opts.version);
  return query;
}

// Every published agreement version (for the filter + by-policy summary).
export async function getConsentAgreementsList(supabase: Client) {
  return supabase
    .from("consent_agreements")
    .select("id, version, title, effective_at, is_current")
    .order("effective_at", { ascending: false });
}

// A single consent record by id (used by the print / view route). Runs with
// the caller's client — RLS lets a user read their own; the legal console
// passes a service-role client to read anyone's.
export async function getConsentRecordById(supabase: Client, id: string) {
  return supabase.from("consent_records").select("*").eq("id", id).single();
}

// True if the user has any consent acceptance on record. Fail-open on a
// query error so a transient DB blip never locks people out of the Hub.
export async function hasUserConsented(
  supabase: Client,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("consent_records")
    .select("id")
    .eq("user_id", userId)
    .limit(1);
  if (error) return true;
  return (data?.length ?? 0) > 0;
}

// ────────────────────────────────────────────────────────────
// REQUIRED-AGREEMENTS GATE (per-kind, version-keyed)
// ────────────────────────────────────────────────────────────

// True iff the user has accepted the CURRENT version of a given policy kind.
// Fail-open (returns true) on any error so a DB blip never locks people out.
// If the kind has no published agreement, treat it as satisfied (nothing to
// sign yet).
export async function hasAcceptedCurrent(
  supabase: Client,
  userId: string,
  kind: ConsentKind
): Promise<boolean> {
  const { data: agreement, error: agErr } = await getCurrentConsentAgreement(
    supabase,
    kind
  );
  if (agErr || !agreement) return true; // nothing published for this kind
  const { data, error } = await supabase
    .from("consent_records")
    .select("id")
    .eq("user_id", userId)
    .eq("agreement_version", agreement.version)
    .limit(1);
  if (error) return true;
  return (data?.length ?? 0) > 0;
}

export type OutstandingConsent = { kind: ConsentKind; agreement: ConsentAgreement };

// The agreements this user must still accept — the REQUIRED_CONSENTS for their
// audience whose current version they haven't accepted. Skips kinds with no
// published row (never lock out). `isStaff` gates the staff-only policies.
export async function getOutstandingConsents(
  supabase: Client,
  userId: string,
  isStaff: boolean
): Promise<OutstandingConsent[]> {
  const applicable = REQUIRED_CONSENTS.filter(
    (r) => r.audience === "all" || (r.audience === "staff" && isStaff)
  );
  const outstanding: OutstandingConsent[] = [];
  for (const { kind } of applicable) {
    const { data: agreement } = await getCurrentConsentAgreement(supabase, kind);
    if (!agreement) continue; // nothing published for this kind yet
    const accepted = await hasAcceptedCurrent(supabase, userId, kind);
    if (!accepted) outstanding.push({ kind, agreement });
  }
  return outstanding;
}
