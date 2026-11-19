// Visa applications: pure data access (see migrations 360–362).
// Business rules (working out the stay, which visa, deadlines) live in
// src/lib/visas/. RLS decides who sees which rows: pass the caller's
// server client, not the admin client, unless the caller is a system job.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

// Columns safe to list. No passport numbers live in these tables; the
// student's passport details stay on public.users (read after a scoped visas.* check).
const CASE_COLUMNS =
  "id, user_id, visa_type, status, waiting_on, stay_from, stay_to, stay_override_reason, " +
  "lodge_by, start_documents_by, is_standard, lodged_on, lodged_where, embassy_reference, " +
  "decided_on, visa_valid_to, refusal_reason, arrived_on, entry_stamp_ok, closed_at, " +
  "created_at, updated_at";

const DOCUMENT_COLUMNS =
  "id, case_id, document_type_id, storage_path, mime_type, size_bytes, issued_on, status, " +
  "review_note, uploaded_by, reviewed_by, reviewed_at, created_at";

// ────────────────────────────────────────────────────────────
// COUNTRY RULES
// ────────────────────────────────────────────────────────────

export async function getVisaCountryRules(supabase: Client) {
  return supabase.from("visa_country_rules").select("*").order("country_name", { ascending: true });
}

export async function getVisaCountryRule(supabase: Client, countryIso: string) {
  return supabase.from("visa_country_rules").select("*").eq("country_iso", countryIso).maybeSingle();
}

export async function upsertVisaCountryRule(
  supabase: Client,
  data: {
    country_iso: string;
    country_name: string;
    exempt_days: number;
    processing_weeks?: number | null;
    needs_extra_care?: boolean;
    guidance?: string | null;
    updated_by?: string | null;
  }
) {
  return supabase
    .from("visa_country_rules")
    .upsert(data, { onConflict: "country_iso" })
    .select()
    .single();
}

// ────────────────────────────────────────────────────────────
// DOCUMENT TYPES
// ────────────────────────────────────────────────────────────

export async function getVisaDocumentTypes(supabase: Client, options?: { includeInactive?: boolean }) {
  let query = supabase.from("visa_document_types").select("*").order("sort_order", { ascending: true });
  if (!options?.includeInactive) query = query.eq("is_active", true);
  return query;
}

export async function updateVisaDocumentType(
  supabase: Client,
  id: string,
  data: Partial<{
    label: string;
    guidance: string | null;
    needed_up_to_90: boolean;
    needed_over_90: boolean;
    is_conditional: boolean;
    is_offline: boolean;
    needs_certified: boolean;
    lead_time_weeks: number | null;
    max_age_months: number | null;
    sort_order: number;
    is_active: boolean;
  }>
) {
  return supabase.from("visa_document_types").update(data).eq("id", id).select().single();
}

// ────────────────────────────────────────────────────────────
// CASES
// ────────────────────────────────────────────────────────────

export async function getVisaCases(
  supabase: Client,
  options?: { status?: string | string[]; programId?: string; waitingOn?: string }
) {
  let query = supabase
    .from("visa_cases")
    .select(
      `${CASE_COLUMNS}, visa_case_schools${options?.programId ? "!inner" : ""}(id, program_id, billing_course_id, start_date, end_date, arrival_date, departure_date)`
    )
    .order("lodge_by", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (Array.isArray(options?.status)) query = query.in("status", options.status);
  else if (options?.status) query = query.eq("status", options.status);
  if (options?.waitingOn) query = query.eq("waiting_on", options.waitingOn);
  if (options?.programId) query = query.eq("visa_case_schools.program_id", options.programId);

  return query;
}

export async function getVisaCaseById(supabase: Client, id: string) {
  return supabase.from("visa_cases").select(CASE_COLUMNS).eq("id", id).maybeSingle();
}

export async function getOpenVisaCaseForUser(supabase: Client, userId: string) {
  return supabase
    .from("visa_cases")
    .select(CASE_COLUMNS)
    .eq("user_id", userId)
    .not("status", "in", "(closed,withdrawn)")
    .maybeSingle();
}

export async function createVisaCase(
  supabase: Client,
  data: {
    user_id: string;
    visa_type?: string;
    status?: string;
    waiting_on?: string;
    stay_from?: string | null;
    stay_to?: string | null;
    lodge_by?: string | null;
    start_documents_by?: string | null;
    created_by?: string | null;
  }
) {
  return supabase.from("visa_cases").insert(data).select(CASE_COLUMNS).single();
}

export async function updateVisaCase(
  supabase: Client,
  id: string,
  data: Partial<{
    visa_type: string;
    status: string;
    waiting_on: string;
    stay_from: string | null;
    stay_to: string | null;
    stay_override_reason: string | null;
    lodge_by: string | null;
    start_documents_by: string | null;
    is_standard: boolean;
    lodged_on: string | null;
    lodged_where: string | null;
    embassy_reference: string | null;
    decided_on: string | null;
    visa_valid_to: string | null;
    refusal_reason: string | null;
    arrived_on: string | null;
    entry_stamp_ok: boolean | null;
    closed_at: string | null;
  }>
) {
  return supabase.from("visa_cases").update(data).eq("id", id).select(CASE_COLUMNS).single();
}

// ────────────────────────────────────────────────────────────
// CASE SCHOOLS
// ────────────────────────────────────────────────────────────

export async function getVisaCaseSchools(supabase: Client, caseId: string) {
  return supabase
    .from("visa_case_schools")
    .select("*, programs(id, name), billing_courses(id, code, name)")
    .eq("case_id", caseId)
    .order("start_date", { ascending: true, nullsFirst: false });
}

export async function addVisaCaseSchool(
  supabase: Client,
  data: {
    case_id: string;
    program_id: string;
    billing_course_id?: string | null;
    application_id?: string | null;
    start_date?: string | null;
    end_date?: string | null;
    arrival_date?: string | null;
    departure_date?: string | null;
  }
) {
  return supabase.from("visa_case_schools").insert(data).select().single();
}

// ────────────────────────────────────────────────────────────
// DOCUMENTS
// ────────────────────────────────────────────────────────────

/** Every upload for a case, newest first; the newest per type counts. */
export async function getVisaCaseDocuments(supabase: Client, caseId: string) {
  return supabase
    .from("visa_case_documents")
    .select(DOCUMENT_COLUMNS)
    .eq("case_id", caseId)
    .order("created_at", { ascending: false });
}

// ────────────────────────────────────────────────────────────
// APPROVAL REQUESTS AND QUESTIONS
// ────────────────────────────────────────────────────────────

export async function getVisaApprovalRequests(supabase: Client, caseId: string) {
  return supabase
    .from("visa_approval_requests")
    .select("*")
    .eq("case_id", caseId)
    .order("requested_at", { ascending: false });
}

/** Legal's queue: every undecided request, oldest first. */
export async function getOpenVisaApprovalRequests(supabase: Client) {
  return supabase
    .from("visa_approval_requests")
    .select("*, visa_cases(id, user_id, lodge_by, stay_from, is_standard)")
    .is("decision", null)
    .order("requested_at", { ascending: true });
}

export async function getVisaCaseQuestions(supabase: Client, caseId: string) {
  return supabase
    .from("visa_case_questions")
    .select("*")
    .eq("case_id", caseId)
    .order("created_at", { ascending: true });
}

// ────────────────────────────────────────────────────────────
// EVENTS (append-only; written by the service role)
// ────────────────────────────────────────────────────────────

export async function getVisaCaseEvents(supabase: Client, caseId: string) {
  return supabase
    .from("visa_case_events")
    .select("*")
    .eq("case_id", caseId)
    .order("created_at", { ascending: false });
}

/**
 * Append to a case's log. Needs the admin (service-role) client: users
 * cannot write the log. Never put a passport number or file contents in
 * `detail`.
 */
export async function logVisaCaseEvent(
  adminClient: Client,
  data: { case_id: string; actor_id: string | null; kind: string; detail?: Record<string, unknown> }
) {
  return adminClient.from("visa_case_events").insert({ ...data, detail: data.detail ?? {} });
}
