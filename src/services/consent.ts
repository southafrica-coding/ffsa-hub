// ────────────────────────────────────────────────────────────
// CONSENT AGREEMENTS + RECORDS
// ────────────────────────────────────────────────────────────
// Reads the current privacy / data-processing agreement and
// records acceptance events for audit purposes.

type Client = any; // eslint-disable-line @typescript-eslint/no-explicit-any

// Agreement "kinds" — each has its own current version (migration 154).
//   privacy    — POPIA privacy & data-processing agreement (default)
//   child_data — FFSA Child Protection Policy & Declaration (staff)
export type ConsentKind = "privacy" | "child_data";

export type ConsentAgreement = {
  id: string;
  version: string;
  kind: string;
  title: string;
  body_markdown: string;
  effective_at: string;
  is_current: boolean;
};

// The current published agreement for a kind. Defaults to 'privacy' so all
// existing callers keep working unchanged.
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

// True if the user has accepted the CURRENT version of the given agreement
// kind. Keyed to the current version so publishing a new version re-prompts
// everyone. Fail-open on any error (or when the kind isn't configured) so a
// transient DB blip or a missing agreement never locks people out.
export async function hasUserConsented(
  supabase: Client,
  userId: string,
  kind: ConsentKind = "privacy"
): Promise<boolean> {
  const { data: current, error: agreementError } =
    await getCurrentConsentAgreement(supabase, kind);
  // No current agreement for this kind (or error reading it) → don't block.
  if (agreementError || !current) return true;

  const { data, error } = await supabase
    .from("consent_records")
    .select("id")
    .eq("user_id", userId)
    .eq("agreement_version", current.version)
    .limit(1);
  if (error) return true;
  return (data?.length ?? 0) > 0;
}
