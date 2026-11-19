import { NextResponse } from "next/server";
import { DOCUMENT_SPEC, bad, dbError, field, isUuid, legalGate, readJson, withBadField } from "@/lib/legal/api";
import { formatReadingNotes } from "@/lib/legal/reading-notes";
import { READABLE_FIELDS, markConfirmed, type StoredReading } from "@/lib/legal/reading";
import {
  createLegalDocument,
  getLegalFile,
  updateLegalDocument,
  updateLegalFile,
  type LegalDocumentInput,
} from "@/services/legal-documents";

/**
 * POST — put the details a person ticked onto a document, and file the scan
 * under it. Body:
 *   {
 *     document_id: uuid | null,   // null = make a new document
 *     values: { type_key?, title?, holder?, issuer?, reference_no?,
 *               issued_on?, expires_on? },   // only the ticked ones,
 *                                            // as the person left them
 *     add_notes?: boolean          // copy the reader's summary and
 *                                  // "things to watch" into the notes
 *   }
 * Every write is as the user (RLS). The values sent are what the person
 * confirmed — they may have corrected the reading — and are validated like
 * any other document edit.
 */
export const POST = withBadField(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    if (!isUuid(id)) return bad("Bad file id");
    const gate = await legalGate();
    if (gate.error) return gate.error;
    const supabase = gate.supabase;
    const body = await readJson(request);
    if (!body || typeof body.values !== "object" || body.values === null) return bad("Nothing to apply");

    const { data: file, error: fileError } = await getLegalFile(supabase, id);
    if (fileError) return dbError(fileError);
    const reading = (file.extracted_fields ?? {}) as StoredReading;

    const raw = body.values as Record<string, unknown>;
    const values: Partial<LegalDocumentInput> = {};
    for (const key of READABLE_FIELDS) {
      if (key in raw) (values as Record<string, unknown>)[key] = DOCUMENT_SPEC[key](raw[key]);
    }
    if ("type_key" in raw && raw.type_key) {
      const key = field.text(raw.type_key, "Type", 60) as string;
      const { data: type, error } = await supabase.from("legal_document_types").select("id").eq("key", key).maybeSingle();
      if (error) return dbError(error);
      if (!type) return bad("Unknown document type");
      values.type_id = type.id;
    }

    const documentId = field.uuid(body.document_id, "Document");
    let targetId: string;
    let existingNotes: string | null = null;

    if (documentId) {
      const { data: doc, error } = await supabase
        .from("legal_documents")
        .select("folder_id, notes")
        .eq("id", documentId)
        .maybeSingle();
      if (error) return dbError(error);
      if (!doc) return bad("Document not found");
      if (doc.folder_id !== file.folder_id) return bad("Pick a document in the scan's folder");
      existingNotes = doc.notes;
      targetId = documentId;
    } else {
      if (!values.title) return bad("A new document needs a title");
      const { data: created, error } = await createLegalDocument(supabase, {
        ...(values as LegalDocumentInput),
        folder_id: file.folder_id,
        created_by: gate.userId,
      });
      if (error) return dbError(error);
      targetId = created.id;
    }

    const update: Partial<LegalDocumentInput> = documentId ? { ...values } : {};
    if (body.add_notes) {
      const block = formatReadingNotes(reading, file.original_name);
      if (block) update.notes = existingNotes ? `${existingNotes}\n\n${block}` : block;
    }
    if (Object.keys(update).length) {
      const { error } = await updateLegalDocument(supabase, targetId, { ...update, updated_by: gate.userId });
      if (error) return dbError(error);
    }

    const confirmedKeys = Object.keys(raw).filter((k) => k === "type_key" || (READABLE_FIELDS as readonly string[]).includes(k));
    const { error: linkError } = await updateLegalFile(supabase, id, {
      document_id: targetId,
      extracted_fields: markConfirmed(reading, confirmedKeys) as Record<string, unknown>,
    });
    if (linkError) return dbError(linkError);

    return NextResponse.json({ success: true, document_id: targetId, created: !documentId });
  }
);
