import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getVisaAccess } from "@/lib/visas/access";
import {
  getVisaStandingDocumentById,
  getVisaStandingDocumentPath,
  setVisaStandingDocumentFile,
} from "@/services/visas";
import {
  SIGNED_URL_TTL,
  UPLOAD_MAX_BYTES,
  UPLOAD_TYPES,
  VISA_BUCKET,
  isUuid,
  refusePreviewWrite,
  rpcErrorResponse,
  sniffUploadType,
} from "@/lib/visas/api";

// The file of one of FFSA's standing documents, in the private bucket at
// 'standing/<document id>.<ext>'. Global legal uploads and opens any of
// them; a student opens one marked for students, naming their case
// (?case=<id>), and visa_standing_document_path logs it on that case.

/** Only a path the database handed back for this document is signed. */
function isStandingPath(path: unknown, id: string): path is string {
  return typeof path === "string" && /^standing\/[0-9a-f-]{36}\.(pdf|jpg|png)$/.test(path) && path.startsWith(`standing/${id}.`);
}

// GET — a short-lived link.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const refusal = refusePreviewWrite();
  if (refusal) return refusal;
  const caseId = new URL(request.url).searchParams.get("case");
  if (!isUuid(id) || (caseId !== null && !isUuid(caseId))) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const { data: path, error } = await getVisaStandingDocumentPath(supabase, id, caseId);
  if (error) return rpcErrorResponse(error);
  if (!isStandingPath(path, id)) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  const admin = createAdminClient() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const { data: signed, error: signErr } = await admin.storage.from(VISA_BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
  if (signErr || !signed?.signedUrl) return NextResponse.json({ error: "File not available" }, { status: 500 });
  return NextResponse.json({ url: signed.signedUrl, expires_in: SIGNED_URL_TTL });
}

// POST — global legal uploads or replaces the file (multipart: file).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const refusal = refusePreviewWrite();
  if (refusal) return refusal;
  if (!isUuid(id)) return NextResponse.json({ error: "Document not found" }, { status: 404 });
  if (!(await getVisaAccess(supabase, user.id)).globalLegal) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (file.size <= 0 || file.size > UPLOAD_MAX_BYTES) {
    return NextResponse.json({ error: "File must be 10 MB or smaller" }, { status: 400 });
  }
  const mimeType = sniffUploadType(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
  if (mimeType !== "application/pdf" && mimeType !== "image/jpeg" && mimeType !== "image/png") {
    return NextResponse.json({ error: "The file must be a PDF, JPG or PNG" }, { status: 400 });
  }

  const { data: doc } = await getVisaStandingDocumentById(supabase, id);
  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  const path = `standing/${id}.${UPLOAD_TYPES[mimeType]}`;
  const admin = createAdminClient() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const { error: upErr } = await admin.storage.from(VISA_BUCKET).upload(path, file, { contentType: mimeType, upsert: true });
  if (upErr) return NextResponse.json({ error: "Upload failed" }, { status: 500 });

  const { data, error } = await setVisaStandingDocumentFile(supabase, id, { storage_path: path, mime_type: mimeType }, user.id);
  if (error || !data) {
    // A new path nobody points at goes again; the same path was simply replaced.
    if (doc.storage_path !== path) await admin.storage.from(VISA_BUCKET).remove([path]);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
  // A PDF replaced by a JPG (or the other way): the old file goes.
  if (doc.storage_path && doc.storage_path !== path && isStandingPath(doc.storage_path, id)) {
    await admin.storage.from(VISA_BUCKET).remove([doc.storage_path]);
  }
  return NextResponse.json({ success: true });
}
