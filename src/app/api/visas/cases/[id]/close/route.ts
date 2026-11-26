import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { closeVisaCase } from "@/services/visas";
import { cleanNote, isUuid, refusePreviewWrite, rpcErrorResponse } from "@/lib/visas/api";

// POST — legal closes a case, or marks it withdrawn. { withdrawn, note? }
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: caseId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const refusal = refusePreviewWrite();
  if (refusal) return refusal;

  const body = await request.json().catch(() => ({}));
  if (!isUuid(caseId) || typeof body.withdrawn !== "boolean") {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  const { error } = await closeVisaCase(supabase, caseId, body.withdrawn, cleanNote(body.note));
  if (error) return rpcErrorResponse(error);
  return NextResponse.json({ success: true });
}
