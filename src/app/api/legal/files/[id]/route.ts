import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SIGNED_URL_SECONDS, bad, dbError, field, isUuid, legalGate, readJson, withBadField } from "@/lib/legal/api";
import {
  LEGAL_BUCKET,
  deleteLegalFile,
  getLegalFile,
  updateLegalFile,
} from "@/services/legal-documents";

// GET — a short-lived link to open the file. The row is read AS THE USER
// first; only a path RLS let them see is ever signed.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return bad("Bad file id");
  const gate = await legalGate();
  if (gate.error) return gate.error;

  const { data: file, error } = await getLegalFile(gate.supabase, id);
  if (error) return dbError(error);

  const download = new URL(request.url).searchParams.get("download") === "1";
  const admin = createAdminClient();
  const { data: signed, error: signError } = await admin.storage
    .from(LEGAL_BUCKET)
    .createSignedUrl(file.storage_path, SIGNED_URL_SECONDS, download ? { download: file.original_name || true } : undefined);
  if (signError || !signed) {
    return NextResponse.json({ error: "The file is missing from storage" }, { status: 404 });
  }
  return NextResponse.json({ url: signed.signedUrl });
}

// PATCH — match the file to a document in the same folder, or unmatch it
// ({ document_id: null }). Files don't move between folders: the folder
// id is part of the storage path.
export const PATCH = withBadField(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    if (!isUuid(id)) return bad("Bad file id");
    const gate = await legalGate();
    if (gate.error) return gate.error;
    const body = await readJson(request);
    if (!body || !("document_id" in body)) return bad("Nothing to change");

    const documentId = field.uuid(body.document_id, "Document");
    const { data: file, error: fileError } = await getLegalFile(gate.supabase, id);
    if (fileError) return dbError(fileError);

    if (documentId) {
      const { data: doc, error } = await gate.supabase
        .from("legal_documents")
        .select("folder_id")
        .eq("id", documentId)
        .maybeSingle();
      if (error) return dbError(error);
      if (!doc) return bad("Document not found");
      if (doc.folder_id !== file.folder_id) return bad("Pick a document in the file's folder");
    }

    const { data, error } = await updateLegalFile(gate.supabase, id, { document_id: documentId });
    if (error) return dbError(error);
    return NextResponse.json({ success: true, file: data });
  }
);

// DELETE — remove the row as the user (RLS), then the stored object.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return bad("Bad file id");
  const gate = await legalGate();
  if (gate.error) return gate.error;

  const { data, error } = await deleteLegalFile(gate.supabase, id);
  if (error) return dbError(error);
  const path = data?.[0]?.storage_path;
  if (!path) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const admin = createAdminClient();
  await admin.storage.from(LEGAL_BUCKET).remove([path]);
  return NextResponse.json({ success: true });
}
