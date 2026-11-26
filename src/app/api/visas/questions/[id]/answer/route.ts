import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { answerVisaQuestion } from "@/services/visas";
import { cleanNote, isUuid, refusePreviewWrite, rpcErrorResponse } from "@/lib/visas/api";

// POST — legal answers an "Ask legal" question. { answer }
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const refusal = refusePreviewWrite();
  if (refusal) return refusal;

  const body = await request.json().catch(() => ({}));
  const answer = cleanNote(body.answer, 4000);
  if (!isUuid(id) || !answer) return NextResponse.json({ error: "Write the answer" }, { status: 400 });
  const { error } = await answerVisaQuestion(supabase, id, answer);
  if (error) return rpcErrorResponse(error);
  return NextResponse.json({ success: true });
}
