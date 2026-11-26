import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { addVisaDocument, getVisaCaseById } from "@/services/visas";
import {
  UPLOAD_MAX_BYTES,
  UPLOAD_TYPES,
  VISA_BUCKET,
  isIsoDate,
  isUuid,
  refusePreviewWrite,
  rpcErrorResponse,
  sniffUploadType,
} from "@/lib/visas/api";

// POST — upload one document to a case (multipart: file, document_type_id,
// issued_on?). The student, or a leader / legal on their behalf. The file
// goes to the private bucket at <case id>/<document id>.<ext>; then
// visa_add_document, called as the user, decides whether it counts. If it
// refuses, the file is removed again. The original file name is never kept.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: caseId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const refusal = refusePreviewWrite();
  if (refusal) return refusal;
  if (!isUuid(caseId)) return NextResponse.json({ error: "Case not found" }, { status: 404 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  }
  const file = form.get("file");
  const documentTypeId = form.get("document_type_id");
  const issuedOn = form.get("issued_on");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (!isUuid(documentTypeId)) return NextResponse.json({ error: "Missing document type" }, { status: 400 });
  if (file.size <= 0 || file.size > UPLOAD_MAX_BYTES) {
    return NextResponse.json({ error: "File must be 10 MB or smaller" }, { status: 400 });
  }
  // The type comes from the file's first bytes, not from its name.
  const mimeType = sniffUploadType(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
  const ext = mimeType ? UPLOAD_TYPES[mimeType] : undefined;
  if (!mimeType || !ext) {
    return NextResponse.json({ error: "File must be a PDF or a photo (JPG, PNG, WEBP, HEIC)" }, { status: 400 });
  }
  if (issuedOn !== null && issuedOn !== "" && !isIsoDate(issuedOn)) {
    return NextResponse.json({ error: "Issue date must be a date" }, { status: 400 });
  }

  // Only someone who can see the case gets as far as storing a file.
  const { data: visaCase } = await getVisaCaseById(supabase, caseId);
  if (!visaCase) return NextResponse.json({ error: "Case not found" }, { status: 404 });

  const documentId = randomUUID();
  const path = `${caseId}/${documentId}.${ext}`;
  const admin = createAdminClient() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const { error: upErr } = await admin.storage
    .from(VISA_BUCKET)
    .upload(path, file, { contentType: mimeType, upsert: false });
  if (upErr) return NextResponse.json({ error: "Upload failed" }, { status: 500 });

  const { error } = await addVisaDocument(supabase, {
    document_id: documentId,
    case_id: caseId,
    document_type_id: documentTypeId,
    storage_path: path,
    mime_type: mimeType,
    size_bytes: file.size,
    issued_on: typeof issuedOn === "string" && issuedOn ? issuedOn : null,
  });
  if (error) {
    await admin.storage.from(VISA_BUCKET).remove([path]);
    return rpcErrorResponse(error);
  }
  return NextResponse.json({ success: true, document_id: documentId });
}
