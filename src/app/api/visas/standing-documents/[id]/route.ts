import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getVisaStandingDocumentById, updateVisaStandingDocument } from "@/services/visas";
import { getVisaAccess } from "@/lib/visas/access";
import { isUuid, refusePreviewWrite, tableErrorResponse } from "@/lib/visas/api";
import { cleanStandingDocument } from "@/lib/visas/standing";

// PATCH — global legal edits a standing document's name, dates, whether
// students get it, or retires it (is_active: false).
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const cleaned = cleanStandingDocument(await request.json().catch(() => ({})));
  if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });
  const { data: existing } = await getVisaStandingDocumentById(supabase, id);
  if (!existing) return NextResponse.json({ error: "Document not found" }, { status: 404 });
  if (cleaned.data.for_students && !existing.storage_path) {
    return NextResponse.json({ error: "Upload the file before giving it to students" }, { status: 400 });
  }

  const { data, error } = await updateVisaStandingDocument(supabase, id, { ...cleaned.data }, user.id);
  if (error) return tableErrorResponse(error, "There's already a document with that name");
  if (!data) return NextResponse.json({ error: "Document not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
