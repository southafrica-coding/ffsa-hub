// Visa applications: pure data access (see migrations 360–366 and 500).
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
  "decided_on, visa_valid_to, refusal_reason, arrived_on, entry_stamp_ok, closed_at, embassy_id, " +
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

// ────────────────────────────────────────────────────────────
// WORKFLOW (migration 363) — every move goes through a checked function.
// Call these with the user's client: the database checks who is calling.
// ────────────────────────────────────────────────────────────

/** Required document codes still not approved or ticked on a case. */
export async function getVisaMissingDocuments(supabase: Client, caseId: string) {
  return supabase.rpc("visa_case_missing_documents", { p_case_id: caseId });
}

/** Records a file the API has already stored at `<case>/<document>.<ext>`. */
export async function addVisaDocument(
  supabase: Client,
  data: {
    document_id: string;
    case_id: string;
    document_type_id: string;
    storage_path: string;
    mime_type: string;
    size_bytes: number;
    issued_on?: string | null;
  }
) {
  return supabase.rpc("visa_add_document", {
    p_document_id: data.document_id,
    p_case_id: data.case_id,
    p_document_type_id: data.document_type_id,
    p_storage_path: data.storage_path,
    p_mime_type: data.mime_type,
    p_size_bytes: data.size_bytes,
    p_issued_on: data.issued_on ?? null,
  });
}

export async function tickVisaOfflineStep(supabase: Client, caseId: string, documentTypeId: string) {
  return supabase.rpc("visa_tick_offline", { p_case_id: caseId, p_document_type_id: documentTypeId });
}

export async function reviewVisaDocument(supabase: Client, documentId: string, approve: boolean, note?: string | null) {
  return supabase.rpc("visa_review_document", { p_document_id: documentId, p_ok: approve, p_note: note ?? null });
}

export async function requestVisaApproval(supabase: Client, caseId: string, note?: string | null) {
  return supabase.rpc("visa_request_approval", { p_case_id: caseId, p_note: note ?? null });
}

export async function decideVisaRequest(supabase: Client, requestId: string, approve: boolean, note?: string | null) {
  return supabase.rpc("visa_decide", { p_request_id: requestId, p_approve: approve, p_note: note ?? null });
}

export async function askVisaLegal(supabase: Client, caseId: string, question: string) {
  return supabase.rpc("visa_ask_legal", { p_case_id: caseId, p_question: question });
}

export async function answerVisaQuestion(supabase: Client, questionId: string, answer: string) {
  return supabase.rpc("visa_answer_question", { p_question_id: questionId, p_answer: answer });
}

export async function recordVisaProgress(
  supabase: Client,
  caseId: string,
  status: "lodged" | "granted" | "refused" | "arrived",
  details: Record<string, string | boolean | null>
) {
  return supabase.rpc("visa_record_progress", { p_case_id: caseId, p_status: status, p_details: details });
}

export async function closeVisaCase(supabase: Client, caseId: string, withdrawn: boolean, note?: string | null) {
  return supabase.rpc("visa_close_case", { p_case_id: caseId, p_withdrawn: withdrawn, p_note: note ?? null });
}

export async function getVisaDocumentById(supabase: Client, documentId: string) {
  return supabase.from("visa_case_documents").select(DOCUMENT_COLUMNS).eq("id", documentId).maybeSingle();
}

// ────────────────────────────────────────────────────────────
// LETTERS (migration 366) — templates legal writes, letters legal issues.
// Writes go through checked functions; call them with the user's client.
// ────────────────────────────────────────────────────────────

const TEMPLATE_COLUMNS =
  "id, kind, program_id, version, title, body, status, change_note, created_by, created_at, updated_at, " +
  "published_by, published_at";

const LETTER_COLUMNS =
  "id, case_id, template_id, kind, program_id, letter_date, title, body, inputs, status, replaces_id, " +
  "student_note, confirmed_at, scan_path, scan_mime_type, scan_uploaded_by, scan_uploaded_at, status_note, " +
  "issued_by, created_at, updated_at";

/** Every version of every template (RLS: visas.manage holders only). */
export async function getVisaLetterTemplates(supabase: Client, options?: { status?: string | string[] }) {
  let query = supabase
    .from("visa_letter_templates")
    .select(TEMPLATE_COLUMNS)
    .order("kind", { ascending: true })
    .order("version", { ascending: false });
  if (Array.isArray(options?.status)) query = query.in("status", options.status);
  else if (options?.status) query = query.eq("status", options.status);
  return query;
}

export async function getVisaLetterTemplateById(supabase: Client, id: string) {
  return supabase.from("visa_letter_templates").select(TEMPLATE_COLUMNS).eq("id", id).maybeSingle();
}

/** Saves the draft for a letter (a new version if there's no draft yet). Returns its id. */
export async function saveVisaLetterTemplate(
  supabase: Client,
  data: { kind: string; program_id: string | null; title: string; body: string; change_note?: string | null }
) {
  return supabase.rpc("visa_save_letter_template", {
    p_kind: data.kind,
    p_program_id: data.program_id,
    p_title: data.title,
    p_body: data.body,
    p_change_note: data.change_note ?? null,
  });
}

export async function publishVisaLetterTemplate(supabase: Client, templateId: string) {
  return supabase.rpc("visa_publish_letter_template", { p_template_id: templateId });
}

export async function discardVisaLetterTemplateDraft(supabase: Client, templateId: string) {
  return supabase.rpc("visa_discard_letter_template_draft", { p_template_id: templateId });
}

// What the case page and Your visa list: no letter text, inputs or scan
// path. Those are read one letter at a time by the checked PDF and scan routes.
const LETTER_LIST_COLUMNS =
  "id, case_id, template_id, kind, program_id, letter_date, title, status, replaces_id, " +
  "student_note, confirmed_at, scan_uploaded_at, status_note, issued_by, created_at, updated_at";

/** A case's letters, newest first (legal, its school leaders, the student). */
export async function getVisaLetters(supabase: Client, caseId: string) {
  return supabase
    .from("visa_letters")
    .select(LETTER_LIST_COLUMNS)
    .eq("case_id", caseId)
    .order("created_at", { ascending: false });
}

export async function getVisaLetterById(supabase: Client, letterId: string) {
  return supabase.from("visa_letters").select(LETTER_COLUMNS).eq("id", letterId).maybeSingle();
}

/** Name, gender and nationality for filling in a letter (legal only; no passport number). */
export async function getVisaLetterStudent(supabase: Client, caseId: string) {
  return supabase.rpc("visa_letter_student", { p_case_id: caseId }).maybeSingle();
}

/** The passport number for a letter's PDF (legal and the student only). Never log it. */
export async function getVisaLetterPassport(supabase: Client, letterId: string) {
  return supabase.rpc("visa_letter_passport", { p_letter_id: letterId });
}

/** Legal for this case (global, or scoped to a school on it)? */
export async function canManageVisaCase(supabase: Client, caseId: string) {
  return supabase.rpc("visa_can_manage", { p_case_id: caseId });
}

export async function issueVisaLetter(
  supabase: Client,
  data: { case_id: string; template_id: string; letter_date: string; body: string; inputs: Record<string, unknown> }
) {
  return supabase.rpc("visa_issue_letter", {
    p_case_id: data.case_id,
    p_template_id: data.template_id,
    p_letter_date: data.letter_date,
    p_body: data.body,
    p_inputs: data.inputs,
  });
}

export async function confirmVisaLetter(supabase: Client, letterId: string, ok: boolean, note?: string | null) {
  return supabase.rpc("visa_confirm_letter", { p_letter_id: letterId, p_ok: ok, p_note: note ?? null });
}

/** Records a scan the API has already stored at `<case>/<letter>.<ext>`. */
export async function attachVisaLetterScan(supabase: Client, letterId: string, scanPath: string, mimeType: string) {
  return supabase.rpc("visa_attach_letter_scan", {
    p_letter_id: letterId,
    p_scan_path: scanPath,
    p_mime_type: mimeType,
  });
}

export async function withdrawVisaLetter(supabase: Client, letterId: string, note: string) {
  return supabase.rpc("visa_withdraw_letter", { p_letter_id: letterId, p_note: note });
}

// ────────────────────────────────────────────────────────────
// EMBASSIES AND FFSA'S STANDING DOCUMENTS (500) — embassies are read by
// everyone signed in and kept by global legal; standing documents are
// global legal's only, and students reach the ones for them through
// visa_case_standing_documents / visa_standing_document_path.
// ────────────────────────────────────────────────────────────

const EMBASSY_COLUMNS =
  "id, country_iso, name, city, addressee, accepts_scan, needs_original, blank_pages, " +
  "processing_weeks, appointment_weeks, website_url, notes, is_active, updated_at";

const STANDING_COLUMNS =
  "id, label, description, certified_on, renew_months, expires_on, for_students, sort_order, " +
  "is_active, storage_path, mime_type, file_uploaded_at, updated_at";

export async function getVisaEmbassies(supabase: Client, options?: { activeOnly?: boolean }) {
  let query = supabase
    .from("visa_embassies")
    .select(EMBASSY_COLUMNS)
    .order("country_iso", { ascending: true })
    .order("city", { ascending: true });
  if (options?.activeOnly) query = query.eq("is_active", true);
  return query;
}

export async function getVisaEmbassyById(supabase: Client, id: string) {
  return supabase.from("visa_embassies").select(EMBASSY_COLUMNS).eq("id", id).maybeSingle();
}

export async function createVisaEmbassy(supabase: Client, input: Record<string, unknown>, userId: string) {
  return supabase
    .from("visa_embassies")
    .insert({ ...input, updated_by: userId })
    .select("id")
    .single();
}

export async function updateVisaEmbassy(supabase: Client, id: string, input: Record<string, unknown>, userId: string) {
  return supabase
    .from("visa_embassies")
    .update({ ...input, updated_by: userId })
    .eq("id", id)
    .select("id")
    .maybeSingle();
}

export async function setVisaCaseEmbassy(supabase: Client, caseId: string, embassyId: string | null) {
  return supabase.rpc("visa_set_case_embassy", { p_case_id: caseId, p_embassy_id: embassyId });
}

export async function getVisaStandingDocuments(supabase: Client) {
  return supabase
    .from("visa_standing_documents")
    .select(STANDING_COLUMNS)
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true });
}

export async function getVisaStandingDocumentById(supabase: Client, id: string) {
  return supabase.from("visa_standing_documents").select(STANDING_COLUMNS).eq("id", id).maybeSingle();
}

export async function createVisaStandingDocument(supabase: Client, input: Record<string, unknown>, userId: string) {
  return supabase
    .from("visa_standing_documents")
    .insert({ ...input, updated_by: userId })
    .select("id")
    .single();
}

export async function updateVisaStandingDocument(
  supabase: Client,
  id: string,
  input: Record<string, unknown>,
  userId: string
) {
  return supabase
    .from("visa_standing_documents")
    .update({ ...input, updated_by: userId })
    .eq("id", id)
    .select("id")
    .maybeSingle();
}

export async function setVisaStandingDocumentFile(
  supabase: Client,
  id: string,
  file: { storage_path: string; mime_type: string },
  userId: string
) {
  return supabase
    .from("visa_standing_documents")
    .update({ ...file, file_uploaded_by: userId, file_uploaded_at: new Date().toISOString(), updated_by: userId })
    .eq("id", id)
    .select("id")
    .maybeSingle();
}

export async function getVisaCaseStandingDocuments(supabase: Client, caseId: string) {
  return supabase.rpc("visa_case_standing_documents", { p_case_id: caseId });
}

/** The file's path for a signed link. With a case: the student, logged. Without: global legal. */
export async function getVisaStandingDocumentPath(supabase: Client, documentId: string, caseId?: string | null) {
  return supabase.rpc("visa_standing_document_path", { p_document_id: documentId, p_case_id: caseId ?? null });
}

// ────────────────────────────────────────────────────────────
// NAMES — users' RLS is "own row + admins" (002), so school leaders can't
// read students' names themselves. Pass the admin client and only ids the
// caller could already see through RLS; returns names, nothing else.
// ────────────────────────────────────────────────────────────

export async function getVisaPeopleNames(adminClient: Client, userIds: string[]) {
  if (userIds.length === 0) return { data: [], error: null };
  return adminClient
    .from("users")
    .select("id, first_name, last_name, preferred_name")
    .in("id", [...new Set(userIds)]);
}

/** Active schools, for choosing which school a letter template is for. */
export async function getActivePrograms(supabase: Client) {
  return supabase.from("programs").select("id, name, code").eq("status", "active").order("name", { ascending: true });
}

export async function getProgramNames(supabase: Client, programIds: string[]) {
  if (programIds.length === 0) return { data: [], error: null };
  return supabase.from("programs").select("id, name, code").in("id", [...new Set(programIds)]);
}
