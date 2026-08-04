// ────────────────────────────────────────────────────────────
// CONSENT AGREEMENTS + RECORDS
// ────────────────────────────────────────────────────────────
// Reads the current privacy / data-processing agreement and
// records acceptance events for audit purposes.

type Client = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export type ConsentAgreement = {
  id: string;
  version: string;
  title: string;
  body_markdown: string;
  effective_at: string;
  is_current: boolean;
};

export async function getCurrentConsentAgreement(supabase: Client) {
  return supabase
    .from("consent_agreements")
    .select("id, version, title, body_markdown, effective_at, is_current")
    .eq("is_current", true)
    .single();
}

export async function getConsentAgreementByVersion(
  supabase: Client,
  version: string
) {
  return supabase
    .from("consent_agreements")
    .select("id, version, title, body_markdown, effective_at, is_current")
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
