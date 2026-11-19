import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { bad, dbError, isUuid, legalGate } from "@/lib/legal/api";
import { renderDraftPdf } from "@/lib/legal/draft-pdf";
import {
  LEGAL_BUCKET,
  createLegalFile,
  deleteLegalFile,
  getLegalDraft,
  isLegalOwner,
  legalFilePath,
  updateLegalDraft,
} from "@/services/legal-documents";

export const maxDuration = 60;

/**
 * POST — the legal officer approves a draft. Order:
 *   1. the draft is read as the user, and the user must be the OWNER;
 *   2. the approved version is rendered to PDF and stored at
 *      <folder id>/<file id>.pdf, and its legal_files row is added AS THE
 *      USER (filed under the draft's document, if it has one);
 *   3. the draft is marked approved with that file, AS THE USER — the
 *      trigger in migration 374 checks the owner again and stamps who and
 *      when. If this fails, the file is removed again.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return bad("Bad draft id");
  const gate = await legalGate();
  if (gate.error) return gate.error;
  const { supabase, userId } = gate;

  const [{ data: draft, error: readError }, { data: owner }] = await Promise.all([
    getLegalDraft(supabase, id),
    isLegalOwner(supabase),
  ]);
  if (readError) return dbError(readError);
  if (owner !== true) return NextResponse.json({ error: "Only the legal officer can approve a draft" }, { status: 403 });
  if (draft.status === "approved") return bad("This draft is already approved");
  if (!draft.body.trim() && (!Array.isArray(draft.fields) || draft.fields.length === 0)) return bad("This draft is empty");

  const { data: me } = await supabase.from("users").select("first_name, last_name").eq("id", userId).maybeSingle();
  const approvedBy = [me?.first_name, me?.last_name].filter(Boolean).join(" ") || "the legal officer";
  const approvedOn = new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());

  let pdf: Buffer;
  try {
    pdf = await renderDraftPdf({
      title: draft.title,
      kind: draft.kind,
      body: draft.body,
      fields: Array.isArray(draft.fields) ? draft.fields : [],
      approvedBy,
      approvedOn,
    });
  } catch (e) {
    console.error("[legal] draft pdf failed", e);
    return NextResponse.json({ error: "Could not make the PDF. Try again." }, { status: 500 });
  }

  const fileId = crypto.randomUUID();
  const path = legalFilePath(draft.folder_id, fileId, "pdf");
  const admin = createAdminClient();
  const { error: upError } = await admin.storage
    .from(LEGAL_BUCKET)
    .upload(path, pdf, { contentType: "application/pdf", upsert: false });
  if (upError) return NextResponse.json({ error: upError.message }, { status: 500 });

  const safeName = draft.title.replace(/[^\w\s.-]/g, "").trim().slice(0, 120) || "Approved draft";
  const { error: fileError } = await createLegalFile(supabase, {
    id: fileId,
    folder_id: draft.folder_id,
    document_id: draft.document_id,
    storage_path: path,
    original_name: `${safeName} (approved).pdf`,
    mime_type: "application/pdf",
    size_bytes: pdf.length,
    uploaded_by: userId,
  });
  if (fileError) {
    await admin.storage.from(LEGAL_BUCKET).remove([path]);
    return dbError(fileError);
  }

  const { data: approved, error: approveError } = await updateLegalDraft(supabase, id, {
    status: "approved",
    final_file_id: fileId,
    sent_back_note: null,
  });
  if (approveError) {
    await deleteLegalFile(supabase, fileId);
    await admin.storage.from(LEGAL_BUCKET).remove([path]);
    return dbError(approveError);
  }
  return NextResponse.json({ success: true, draft: approved, file_id: fileId });
}
