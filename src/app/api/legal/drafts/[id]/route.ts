import { NextResponse } from "next/server";
import { bad, dbError, field, isUuid, legalGate, readJson, withBadField } from "@/lib/legal/api";
import { deleteLegalDraft, getLegalDraft, isLegalOwner, updateLegalDraft } from "@/services/legal-documents";

type Field = { label: string; value: string; source: string; missing: boolean };

function parseFields(v: unknown): Field[] {
  if (!Array.isArray(v)) throw new Error("fields must be a list");
  return v.slice(0, 200).map((f) => ({
    label: String(f?.label ?? "").slice(0, 300),
    value: String(f?.value ?? "").slice(0, 2000),
    source: String(f?.source ?? "").slice(0, 200),
    missing: f?.missing === true || !String(f?.value ?? "").trim(),
  }));
}

/**
 * PATCH — edit a draft (title, body, fields, notes, where it is filed), or
 * send it back ({ send_back: "note" }, owner only). Approving is NOT here:
 * see ./approve. An approved draft can't change (migration 374).
 */
export const PATCH = withBadField(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    if (!isUuid(id)) return bad("Bad draft id");
    const gate = await legalGate();
    if (gate.error) return gate.error;
    const body = await readJson(request);
    if (!body) return bad("Expected a JSON body");

    const { data: draft, error: readError } = await getLegalDraft(gate.supabase, id);
    if (readError) return dbError(readError);
    if (draft.status === "approved") return bad("An approved draft can no longer change");

    const change: Record<string, unknown> = {};
    if ("title" in body) change.title = field.text(body.title, "Title", 200, { required: true });
    if ("body" in body) change.body = typeof body.body === "string" ? body.body.slice(0, 60000) : "";
    if ("fields" in body) {
      try {
        change.fields = parseFields(body.fields);
      } catch (e) {
        return bad((e as Error).message);
      }
    }
    if ("notes_for_approver" in body) change.notes_for_approver = field.text(body.notes_for_approver, "Notes", 4000);
    if ("folder_id" in body) change.folder_id = field.uuid(body.folder_id, "Folder", { required: true });
    if ("document_id" in body) change.document_id = field.uuid(body.document_id, "Document");
    if ("application_id" in body) change.application_id = field.uuid(body.application_id, "Application");

    const target = (change.folder_id as string | undefined) ?? draft.folder_id;
    for (const [key, table] of [["document_id", "legal_documents"], ["application_id", "legal_applications"]] as const) {
      const ref = key in change ? (change[key] as string | null) : (draft[key] as string | null);
      if (!ref) continue;
      const { data } = await gate.supabase.from(table).select("folder_id").eq("id", ref).maybeSingle();
      if (!data || data.folder_id !== target) {
        if (key in change) return bad(`Pick a ${key === "document_id" ? "document" : "application"} in the draft's folder`);
        change[key] = null; // moved folders: let go of the old link
      }
    }

    if ("send_back" in body) {
      const { data: owner } = await isLegalOwner(gate.supabase);
      if (owner !== true) return NextResponse.json({ error: "Only the legal officer can send a draft back" }, { status: 403 });
      change.status = "sent_back";
      change.sent_back_note = field.text(body.send_back, "Note", 2000, { required: true });
    } else if (Object.keys(change).length) {
      // Edited after being sent back: waiting on approval again.
      change.status = "awaiting_approval";
    }
    if (Object.keys(change).length === 0) return bad("Nothing to change");

    const { data, error } = await updateLegalDraft(gate.supabase, id, change);
    if (error) return dbError(error);
    return NextResponse.json({ success: true, draft: data });
  }
);

// DELETE — throw away a draft that isn't approved (approved ones are kept).
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return bad("Bad draft id");
  const gate = await legalGate();
  if (gate.error) return gate.error;
  const { data, error } = await deleteLegalDraft(gate.supabase, id);
  if (error) return dbError(error);
  if (!data?.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
