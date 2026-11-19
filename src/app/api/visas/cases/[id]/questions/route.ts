import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { askVisaLegal } from "@/services/visas";
import { cleanNote, isUuid, refusePreviewWrite, rpcErrorResponse } from "@/lib/visas/api";

// POST — "Ask legal": a school leader's serious question on a case. { question }
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
  const question = cleanNote(body.question);
  if (!isUuid(caseId) || !question) return NextResponse.json({ error: "Write the question" }, { status: 400 });
  const { data, error } = await askVisaLegal(supabase, caseId, question);
  if (error) return rpcErrorResponse(error);
  return NextResponse.json({ success: true, question_id: data });
}
