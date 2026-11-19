import { NextResponse } from "next/server";
import { DOCUMENT_SPEC, bad, dbError, legalGate, pick, readJson, withBadField } from "@/lib/legal/api";
import { createLegalDocument, type LegalDocumentInput } from "@/services/legal-documents";

// POST — a new document in a folder. RLS: edit rights on that folder.
export const POST = withBadField(async (request: Request) => {
  const gate = await legalGate();
  if (gate.error) return gate.error;
  const body = await readJson(request);
  if (!body) return bad("Expected a JSON body");
  if (!("folder_id" in body) || !("title" in body)) return bad("Folder and title are required");

  const data = pick(body, DOCUMENT_SPEC) as LegalDocumentInput;
  const { data: document, error } = await createLegalDocument(gate.supabase, {
    ...data,
    created_by: gate.userId,
  });
  if (error) return dbError(error);
  return NextResponse.json({ success: true, document });
});
