// FFSA Hub — Documents a school attaches to its onboarding emails
// (migration 238).
//
// A leader uploads files against an email on the school's Emails tab; every
// time that email goes out for that school, the files go with it as real
// attachments. sendTransactional() calls loadProgramEmailAttachments() when
// a caller passes `programDocuments`, so each step's sender only has to say
// which school and which email it is.
//
// Tolerant by design, like resolveProgramEmail: if the table isn't there yet
// or a file can't be fetched, the email still sends — without that file —
// and the problem is logged. A missing attachment must never stop a student
// hearing they've been accepted.

import { PROGRAM_EMAIL_TYPE_KEYS } from "./program-email-types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export const PROGRAM_EMAIL_DOCUMENTS_BUCKET = "program-email-documents";

/** Per file — matches the bucket's file_size_limit. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
/**
 * Per email. Resend accepts up to 40 MB per message after base64 encoding
 * (which inflates ~4/3), so 25 MB of raw files stays safely inside it.
 */
export const MAX_EMAIL_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export const ALLOWED_DOCUMENT_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "image/png": "png",
  "image/jpeg": "jpg",
};

/** Emails that aren't in the editable-template catalog but still carry documents. */
export const EXTRA_DOCUMENT_EMAIL_TYPES = [
  // Both acceptance variants (new account / existing account) share these.
  "application_accepted",
  "account_setup_link",
] as const;

export function isDocumentEmailType(key: string): boolean {
  return (
    PROGRAM_EMAIL_TYPE_KEYS.has(key) ||
    (EXTRA_DOCUMENT_EMAIL_TYPES as readonly string[]).includes(key)
  );
}

export type ProgramEmailDocument = {
  id: string;
  email_type: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  sort_order: number;
  created_at: string;
};

export type LoadedAttachment = {
  filename: string;
  content: Buffer;
  contentType: string;
};

export async function listProgramEmailDocuments(
  admin: Client,
  programId: string
): Promise<ProgramEmailDocument[]> {
  const { data } = await admin
    .from("program_email_documents")
    .select("id, email_type, file_name, content_type, size_bytes, sort_order, created_at")
    .eq("program_id", programId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  return (data ?? []) as ProgramEmailDocument[];
}

/**
 * Fetch the files a school attached to one email, ready to hand to Resend.
 * Never throws; returns whatever it could load.
 */
export async function loadProgramEmailAttachments(
  admin: Client,
  programId: string,
  emailTypes: string[]
): Promise<LoadedAttachment[]> {
  const emailType = emailTypes.join("+"); // for log lines
  let rows: Array<{
    email_type: string;
    storage_path: string;
    file_name: string;
    content_type: string;
    size_bytes: number;
  }> = [];
  try {
    const { data, error } = await admin
      .from("program_email_documents")
      .select("email_type, storage_path, file_name, content_type, size_bytes")
      .eq("program_id", programId)
      .in("email_type", emailTypes)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    // Keep each email's own order, in the order the types were given.
    rows = (data ?? []).sort(
      (a: { email_type: string }, b: { email_type: string }) =>
        emailTypes.indexOf(a.email_type) - emailTypes.indexOf(b.email_type)
    );
  } catch {
    return []; // table not migrated / read failed → send without documents
  }

  const out: LoadedAttachment[] = [];
  let total = 0;
  for (const row of rows) {
    if (total + row.size_bytes > MAX_EMAIL_ATTACHMENT_BYTES) {
      console.warn(
        `[email-documents] ${programId}/${emailType}: skipped "${row.file_name}" — over the per-email size cap`
      );
      continue;
    }
    try {
      const { data: blob, error } = await admin.storage
        .from(PROGRAM_EMAIL_DOCUMENTS_BUCKET)
        .download(row.storage_path);
      if (error || !blob) throw error ?? new Error("empty download");
      out.push({
        filename: row.file_name,
        content: Buffer.from(await blob.arrayBuffer()),
        contentType: row.content_type,
      });
      total += row.size_bytes;
    } catch (e) {
      console.error(
        `[email-documents] ${programId}/${emailType}: could not fetch "${row.file_name}", sending without it`,
        e
      );
    }
  }
  return out;
}

/** Keep the extension the content type implies; strip path + quote chars. */
export function cleanDocumentFileName(name: string, contentType: string): string {
  const base = name.split(/[\\/]/).pop()?.replace(/["<>\r\n]/g, "").trim() || "document";
  const ext = ALLOWED_DOCUMENT_TYPES[contentType];
  if (!ext) return base.slice(0, 150);
  const hasExt = base.toLowerCase().endsWith(`.${ext}`) ||
    (ext === "jpg" && /\.jpe?g$/i.test(base));
  return (hasExt ? base : `${base}.${ext}`).slice(0, 150);
}
