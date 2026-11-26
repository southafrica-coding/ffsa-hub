import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { discardVisaLetterTemplateDraft } from "@/services/visas";
import { isUuid, refusePreviewWrite, rpcErrorResponse } from "@/lib/visas/api";

// DELETE — global legal throws a draft away. Published versions stay.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const refusal = refusePreviewWrite();
  if (refusal) return refusal;
  if (!isUuid(id)) return NextResponse.json({ error: "Template not found" }, { status: 404 });

  const { error } = await discardVisaLetterTemplateDraft(supabase, id);
  if (error) return rpcErrorResponse(error);
  return NextResponse.json({ success: true });
}
