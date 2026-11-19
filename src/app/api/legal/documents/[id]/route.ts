import { NextResponse } from "next/server";
import { DOCUMENT_SPEC, bad, dbError, isUuid, legalGate, pick, readJson, withBadField } from "@/lib/legal/api";
import { updateLegalDocument, type LegalDocumentInput } from "@/services/legal-documents";

// PATCH — change any of the document's fields.
export const PATCH = withBadField(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    if (!isUuid(id)) return bad("Bad document id");
    const gate = await legalGate();
    if (gate.error) return gate.error;
    const body = await readJson(request);
    if (!body) return bad("Expected a JSON body");

    const data = pick(body, DOCUMENT_SPEC) as Partial<LegalDocumentInput>;
    if (Object.keys(data).length === 0) return bad("Nothing to change");
    if (data.superseded_by === id) return bad("A document can't replace itself");

    const { data: document, error } = await updateLegalDocument(gate.supabase, id, {
      ...data,
      updated_by: gate.userId,
    });
    if (error) return dbError(error);
    return NextResponse.json({ success: true, document });
  }
);
