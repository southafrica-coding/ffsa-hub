import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tickVisaOfflineStep } from "@/services/visas";
import { isUuid, refusePreviewWrite, rpcErrorResponse } from "@/lib/visas/api";

// POST — tick off an offline step (signed form, embassy fee). { document_type_id }
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
  if (!isUuid(caseId) || !isUuid(body.document_type_id)) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  const { data, error } = await tickVisaOfflineStep(supabase, caseId, body.document_type_id);
  if (error) return rpcErrorResponse(error);
  return NextResponse.json({ success: true, document_id: data });
}
