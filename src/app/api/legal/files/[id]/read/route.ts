import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { bad, dbError, isUuid, legalGate } from "@/lib/legal/api";
import { todayInSA } from "@/lib/legal/status";
import { ReadError, readScan } from "@/lib/legal/reader";
import { readingPrompt, suggestMatch, toStoredReading, type StoredReading } from "@/lib/legal/reading";
import { LEGAL_BUCKET, getLegalFile, updateLegalFile } from "@/services/legal-documents";

// Reading a scan can take a minute or two for a long PDF.
export const maxDuration = 300;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

/** The match suggestion for a stored reading, worked out as the user. */
async function suggestionFor(supabase: Client, folderId: string, reading: StoredReading) {
  const [{ data: docs }, { data: types }] = await Promise.all([
    supabase
      .from("legal_documents")
      .select("id, folder_id, title, type_id, reference_no, expires_on, status")
      .eq("folder_id", folderId),
    supabase.from("legal_document_types").select("id, key"),
  ]);
  const typeIdByKey = new Map<string, string>((types ?? []).map((t: { id: string; key: string }) => [t.key, t.id]));
  return suggestMatch(reading, folderId, docs ?? [], typeIdByKey);
}

// GET — what was read from the scan: the full text, the stored reading and
// the suggested document. Read as the user (RLS).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return bad("Bad file id");
  const gate = await legalGate();
  if (gate.error) return gate.error;

  const { data: file, error } = await getLegalFile(gate.supabase, id);
  if (error) return dbError(error);
  const reading = (file.extracted_fields ?? {}) as StoredReading;
  const suggestion = file.extraction_status === "done" ? await suggestionFor(gate.supabase, file.folder_id, reading) : null;
  return NextResponse.json({
    status: file.extraction_status,
    text: file.extracted_text,
    reading,
    suggestion,
  });
}

/**
 * POST — read the scan with Claude and store what it found as unconfirmed
 * suggestions. Order matters:
 *   1. read the row AS THE USER (RLS decides they may see it), and mark it
 *      'pending' as the user (RLS decides they may edit it);
 *   2. only then fetch the stored bytes with the service role;
 *   3. Claude reads a copy; the original is never changed.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return bad("Bad file id");
  const gate = await legalGate();
  if (gate.error) return gate.error;
  const supabase = gate.supabase;

  const { data: file, error } = await getLegalFile(supabase, id);
  if (error) return dbError(error);
  const { error: pendingError } = await updateLegalFile(supabase, id, { extraction_status: "pending" });
  if (pendingError) return dbError(pendingError);

  const fail = async (message: string, status: number) => {
    await updateLegalFile(supabase, id, {
      extraction_status: "failed",
      extracted_fields: { ...(file.extracted_fields ?? {}), error: message },
    });
    return NextResponse.json({ error: message }, { status });
  };

  const [{ data: folder }, { data: types }] = await Promise.all([
    supabase.from("legal_folders").select("name, kind").eq("id", file.folder_id).single(),
    supabase.from("legal_document_types").select("key, name, category").order("sort_order"),
  ]);

  const admin = createAdminClient();
  const { data: blob, error: downloadError } = await admin.storage.from(LEGAL_BUCKET).download(file.storage_path);
  if (downloadError || !blob) return fail("The scan is missing from storage. Upload it again.", 404);
  const bytes = Buffer.from(await blob.arrayBuffer());

  let stored: StoredReading;
  let text: string;
  try {
    const result = await readScan(
      bytes,
      file.mime_type,
      readingPrompt({
        today: todayInSA(),
        folderName: folder?.name ?? "Unknown",
        folderKind: folder?.kind ?? "organisation",
        types: types ?? [],
      })
    );
    stored = toStoredReading(result, (types ?? []).map((t: { key: string }) => t.key));
    text = result.text;
  } catch (e) {
    if (e instanceof ReadError) return fail(e.message, 422);
    console.error("legal scan read failed", e);
    return fail("Reading failed. Try again.", 500);
  }

  const { error: saveError } = await updateLegalFile(supabase, id, {
    extraction_status: "done",
    extracted_text: text,
    extracted_fields: stored as Record<string, unknown>,
    extracted_at: new Date().toISOString(),
  });
  if (saveError) return dbError(saveError);

  return NextResponse.json({
    success: true,
    status: "done",
    text,
    reading: stored,
    suggestion: await suggestionFor(supabase, file.folder_id, stored),
  });
}
