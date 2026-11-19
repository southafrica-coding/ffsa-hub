import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requestVisaApproval } from "@/services/visas";
import { cleanNote, isUuid, refusePreviewWrite, rpcErrorResponse } from "@/lib/visas/api";

// POST — a school leader sends the case to legal. { note? }
// The database refuses while any required document is missing or unreviewed.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: caseId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const refusal = refusePreviewWrite();
  if (refusal) return refusal;
  if (!isUuid(caseId)) return NextResponse.json({ error: "Case not found" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const { data, error } = await requestVisaApproval(supabase, caseId, cleanNote(body.note));
  if (error) return rpcErrorResponse(error);
  return NextResponse.json({ success: true, request_id: data });
}
