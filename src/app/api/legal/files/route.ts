import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  FILE_TYPES,
  MAX_FILE_BYTES,
  bad,
  dbError,
  field,
  legalGate,
  readJson,
  withBadField,
} from "@/lib/legal/api";
import {
  LEGAL_BUCKET,
  createLegalFile,
  deleteLegalFile,
  legalFilePath,
} from "@/services/legal-documents";

/**
 * POST — start an upload. Body: { folder_id, document_id?, name, type, size }.
 *
 * Scans can be larger than a serverless request allows, so the browser
 * uploads straight to storage. Order matters:
 *   1. insert the legal_files row AS THE USER — RLS decides whether they
 *      may add to this folder; nothing is signed if it refuses;
 *   2. sign a one-time upload URL for exactly that row's path;
 *   3. the browser uploads, and calls DELETE /api/legal/files/[id] if
 *      the upload fails, so no row points at nothing.
 */
export const POST = withBadField(async (request: Request) => {
  const gate = await legalGate();
  if (gate.error) return gate.error;
  const body = await readJson(request);
  if (!body) return bad("Expected a JSON body");

  const folderId = field.uuid(body.folder_id, "Folder", { required: true }) as string;
  const documentId = field.uuid(body.document_id, "Document");
  const name = field.text(body.name, "File name", 255);
  const type = typeof body.type === "string" ? body.type : "";
  const ext = FILE_TYPES[type];
  if (!ext) return bad("Upload a PDF or a photo (JPG, PNG, WEBP or HEIC)");
  const size = Number(body.size);
  if (!Number.isInteger(size) || size <= 0) return bad("Bad file size");
  if (size > MAX_FILE_BYTES) return bad("Files must be 50 MB or smaller");

  if (documentId) {
    const { data: doc, error } = await gate.supabase
      .from("legal_documents")
      .select("folder_id")
      .eq("id", documentId)
      .maybeSingle();
    if (error) return dbError(error);
    if (!doc) return bad("Document not found");
    if (doc.folder_id !== folderId) return bad("The file must go in the document's folder");
  }

  const id = crypto.randomUUID();
  const path = legalFilePath(folderId, id, ext);
  const { data: file, error } = await createLegalFile(gate.supabase, {
    id,
    folder_id: folderId,
    document_id: documentId,
    storage_path: path,
    original_name: name,
    mime_type: type,
    size_bytes: size,
    uploaded_by: gate.userId,
  });
  if (error) return dbError(error);

  const admin = createAdminClient();
  const { data: signed, error: signError } = await admin.storage
    .from(LEGAL_BUCKET)
    .createSignedUploadUrl(path);
  if (signError || !signed) {
    await deleteLegalFile(gate.supabase, id);
    return NextResponse.json({ error: signError?.message ?? "Could not start the upload" }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    file,
    upload: { bucket: LEGAL_BUCKET, path: signed.path, token: signed.token },
  });
});
