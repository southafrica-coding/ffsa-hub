// Legal → Documents — pure data-access. Plan: docs/legal-documents.md.
//
// Every function takes the user's client (createClient from
// @/lib/supabase/server): RLS on the legal_* tables is the only gate, and
// it names people on legal_access, not roles. Do NOT pass the admin
// client here — it would bypass that wall. The one service-role step is
// signing a file URL, and only after getLegalFile() returned the row as
// the user.
//
// Tables arrive in migrations 370–372; regenerate src/types/database.ts
// after applying them and swap `any` for the generated types.

import { CLOSED_APPLICATION_STATUSES } from "@/lib/legal/status";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export const LEGAL_BUCKET = "legal-documents";

export type LegalFolderKind = "organisation" | "personal" | "project";
export type LegalDocumentStatus =
  | "held"
  | "applying"
  | "not_held"
  | "superseded"
  | "cancelled";
export type LegalApplicationStatus =
  | "planned"
  | "gathering"
  | "submitted"
  | "waiting"
  | "approved"
  | "refused"
  | "withdrawn";


// ────────────────────────────────────────────────────────────
// ACCESS
// ────────────────────────────────────────────────────────────

/** true when the signed-in user may open the module at all. */
export async function hasLegalAccess(supabase: Client) {
  return supabase.rpc("legal_any_access");
}

/** The access list (members with whole-module access see every row). */
export async function getLegalAccessList(supabase: Client) {
  return supabase
    .from("legal_access")
    .select(
      "id, user_id, access_role, folder_id, can_edit, ends_on, note, created_at"
    )
    .order("created_at", { ascending: true });
}

// ────────────────────────────────────────────────────────────
// FOLDERS
// ────────────────────────────────────────────────────────────

export async function getLegalFolders(
  supabase: Client,
  options?: { includeArchived?: boolean }
) {
  let query = supabase
    .from("legal_folders")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (!options?.includeArchived) query = query.is("archived_at", null);
  return query;
}

export async function createLegalFolder(
  supabase: Client,
  data: { name: string; kind: LegalFolderKind; description?: string | null; created_by: string }
) {
  return supabase.from("legal_folders").insert(data).select().single();
}

export async function updateLegalFolder(
  supabase: Client,
  id: string,
  data: Partial<{
    name: string;
    kind: LegalFolderKind;
    description: string | null;
    sort_order: number;
    archived_at: string | null;
  }>
) {
  return supabase.from("legal_folders").update(data).eq("id", id).select().single();
}

// ────────────────────────────────────────────────────────────
// DOCUMENT TYPES
// ────────────────────────────────────────────────────────────

export async function getLegalDocumentTypes(supabase: Client) {
  return supabase
    .from("legal_document_types")
    .select("*")
    .order("sort_order", { ascending: true });
}

// ────────────────────────────────────────────────────────────
// DOCUMENTS
// ────────────────────────────────────────────────────────────

const DOCUMENT_SELECT =
  "*, legal_document_types:type_id(key, name, category, lead_days), legal_folders:folder_id(name, kind)";

export async function getLegalDocuments(
  supabase: Client,
  options?: { folderId?: string; status?: LegalDocumentStatus[] }
) {
  let query = supabase
    .from("legal_documents")
    .select(DOCUMENT_SELECT)
    .order("expires_on", { ascending: true, nullsFirst: false })
    .order("title", { ascending: true });
  if (options?.folderId) query = query.eq("folder_id", options.folderId);
  if (options?.status?.length) query = query.in("status", options.status);
  return query;
}

export async function getLegalDocument(supabase: Client, id: string) {
  return supabase.from("legal_documents").select(DOCUMENT_SELECT).eq("id", id).single();
}

export type LegalDocumentInput = {
  folder_id: string;
  type_id?: string | null;
  title: string;
  holder?: string | null;
  issuer?: string | null;
  reference_no?: string | null;
  issued_on?: string | null;
  expires_on?: string | null;
  renew_lead_days?: number | null;
  status?: LegalDocumentStatus;
  superseded_by?: string | null;
  notes?: string | null;
};

export async function createLegalDocument(
  supabase: Client,
  data: LegalDocumentInput & { created_by: string }
) {
  return supabase
    .from("legal_documents")
    .insert({ ...data, updated_by: data.created_by })
    .select()
    .single();
}

export async function updateLegalDocument(
  supabase: Client,
  id: string,
  data: Partial<LegalDocumentInput> & { updated_by: string }
) {
  return supabase.from("legal_documents").update(data).eq("id", id).select().single();
}

// ────────────────────────────────────────────────────────────
// FILES
// ────────────────────────────────────────────────────────────

const FILE_SELECT =
  "id, folder_id, document_id, storage_path, original_name, mime_type, size_bytes, page_count, scanned_on, extraction_status, extracted_fields, extracted_at, created_at";

/** Files without their extracted text (it can be long). */
export async function getLegalFiles(
  supabase: Client,
  options?: { folderId?: string; documentId?: string; unmatchedOnly?: boolean }
) {
  let query = supabase
    .from("legal_files")
    .select(FILE_SELECT)
    .order("created_at", { ascending: false });
  if (options?.folderId) query = query.eq("folder_id", options.folderId);
  if (options?.documentId) query = query.eq("document_id", options.documentId);
  if (options?.unmatchedOnly) query = query.is("document_id", null);
  return query;
}

/** One file as the user — call this before signing its storage URL. */
export async function getLegalFile(supabase: Client, id: string) {
  return supabase.from("legal_files").select(`${FILE_SELECT}, extracted_text`).eq("id", id).single();
}

/** The path a new file must have (CHECK legal_files_path in 370). */
export function legalFilePath(folderId: string, fileId: string, ext: string) {
  const clean = ext.toLowerCase().replace(/^\./, "");
  if (!/^[a-z0-9]{2,5}$/.test(clean)) throw new Error(`Bad file extension: ${ext}`);
  return `${folderId}/${fileId}.${clean}`;
}

export async function createLegalFile(
  supabase: Client,
  data: {
    id: string;
    folder_id: string;
    document_id?: string | null;
    storage_path: string;
    original_name?: string | null;
    mime_type: string;
    size_bytes: number;
    page_count?: number | null;
    scanned_on?: string | null;
    uploaded_by: string;
  }
) {
  return supabase.from("legal_files").insert(data).select(FILE_SELECT).single();
}

/** Returns the deleted row's storage path, so the caller can remove the object. */
export async function deleteLegalFile(supabase: Client, id: string) {
  return supabase.from("legal_files").delete().eq("id", id).select("storage_path");
}

export async function updateLegalFile(
  supabase: Client,
  id: string,
  data: Partial<{
    folder_id: string;
    document_id: string | null;
    scanned_on: string | null;
    extraction_status: "none" | "pending" | "done" | "failed";
    extracted_text: string | null;
    extracted_fields: Record<string, unknown>;
    extracted_at: string | null;
  }>
) {
  return supabase.from("legal_files").update(data).eq("id", id).select(FILE_SELECT).single();
}

// ────────────────────────────────────────────────────────────
// APPLICATIONS
// ────────────────────────────────────────────────────────────

const APPLICATION_SELECT =
  "*, legal_application_steps(*), legal_documents:document_id(id, title, expires_on), legal_folders:folder_id(name, kind)";

export async function getLegalApplications(
  supabase: Client,
  options?: { folderId?: string; openOnly?: boolean }
) {
  let query = supabase
    .from("legal_applications")
    .select(APPLICATION_SELECT)
    .order("lodge_by", { ascending: true, nullsFirst: false })
    .order("position", { referencedTable: "legal_application_steps", ascending: true });
  if (options?.folderId) query = query.eq("folder_id", options.folderId);
  if (options?.openOnly) {
    query = query.not("status", "in", `(${CLOSED_APPLICATION_STATUSES.join(",")})`);
  }
  return query;
}

export type LegalApplicationInput = {
  folder_id: string;
  document_id?: string | null;
  title: string;
  status?: LegalApplicationStatus;
  lodge_by?: string | null;
  submitted_on?: string | null;
  expected_on?: string | null;
  closed_on?: string | null;
  reference_no?: string | null;
  responsible_id?: string | null;
  notes?: string | null;
};

export async function createLegalApplication(
  supabase: Client,
  data: LegalApplicationInput & { created_by: string }
) {
  return supabase.from("legal_applications").insert(data).select().single();
}

export async function updateLegalApplication(
  supabase: Client,
  id: string,
  data: Partial<LegalApplicationInput>
) {
  return supabase.from("legal_applications").update(data).eq("id", id).select().single();
}

// ────────────────────────────────────────────────────────────
// APPLICATION STEPS
// ────────────────────────────────────────────────────────────

export async function addLegalApplicationStep(
  supabase: Client,
  data: { application_id: string; label: string; position?: number; due_on?: string | null }
) {
  return supabase.from("legal_application_steps").insert(data).select().single();
}

export async function setLegalApplicationStepDone(
  supabase: Client,
  id: string,
  doneBy: string | null
) {
  return supabase
    .from("legal_application_steps")
    .update(
      doneBy
        ? { done_at: new Date().toISOString(), done_by: doneBy }
        : { done_at: null, done_by: null }
    )
    .eq("id", id)
    .select()
    .single();
}

export async function updateLegalApplicationStep(
  supabase: Client,
  id: string,
  data: Partial<{ label: string; due_on: string | null; position: number; notes: string | null }>
) {
  return supabase.from("legal_application_steps").update(data).eq("id", id).select().single();
}

/** Returns the deleted ids, so a caller can tell "not yours" from "gone". */
export async function deleteLegalApplicationStep(supabase: Client, id: string) {
  return supabase.from("legal_application_steps").delete().eq("id", id).select("id");
}

// ────────────────────────────────────────────────────────────
// DRAFTS (migration 374) — only the owner can approve; the DB enforces it
// ────────────────────────────────────────────────────────────

export const DRAFT_SELECT =
  "id, folder_id, document_id, application_id, title, kind, body, fields, notes_for_approver, status, sent_back_note, created_via, final_file_id, approved_by, approved_at, created_by, created_at, updated_at";

export async function getLegalDrafts(supabase: Client) {
  return supabase.from("legal_drafts").select(DRAFT_SELECT).order("updated_at", { ascending: false });
}

export async function getLegalDraft(supabase: Client, id: string) {
  return supabase.from("legal_drafts").select(DRAFT_SELECT).eq("id", id).single();
}

export async function updateLegalDraft(supabase: Client, id: string, data: Record<string, unknown>) {
  return supabase.from("legal_drafts").update(data).eq("id", id).select(DRAFT_SELECT).single();
}

export async function deleteLegalDraft(supabase: Client, id: string) {
  return supabase.from("legal_drafts").delete().eq("id", id).select("id");
}

/** true when the signed-in person is the owner (the only one who approves). */
export async function isLegalOwner(supabase: Client) {
  return supabase.rpc("legal_is_owner");
}

// ────────────────────────────────────────────────────────────
// HELPER BACKGROUND TASKS (migration 375)
// ────────────────────────────────────────────────────────────

export const TASK_SELECT =
  "id, title, request, status, progress, result, draft_ids, error, attempts, created_by, started_at, heartbeat_at, finished_at, created_at";

export async function getLegalHelperTasks(supabase: Client, limit = 30) {
  return supabase.from("legal_helper_tasks").select(TASK_SELECT).order("created_at", { ascending: false }).limit(limit);
}

// ────────────────────────────────────────────────────────────
// EVENT LOG
// ────────────────────────────────────────────────────────────

export async function getLegalEvents(
  supabase: Client,
  options: { tableName: string; rowId: string; limit?: number }
) {
  return supabase
    .from("legal_events")
    .select("*")
    .eq("table_name", options.tableName)
    .eq("row_id", options.rowId)
    .order("at", { ascending: false })
    .limit(options.limit ?? 50);
}
