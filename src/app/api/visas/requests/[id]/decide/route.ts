import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decideVisaRequest } from "@/services/visas";
import { cleanNote, isUuid, refusePreviewWrite, rpcErrorResponse } from "@/lib/visas/api";

// POST — legal approves a request, or sends it back with a note.
// { approve: boolean, note? }. Signing letters arrives in step 3.
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
  if (!isUuid(id) || typeof body.approve !== "boolean") {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  const note = cleanNote(body.note);
  if (!body.approve && !note) return NextResponse.json({ error: "Say what needs fixing" }, { status: 400 });
  const { error } = await decideVisaRequest(supabase, id, body.approve, note);
  if (error) return rpcErrorResponse(error);
  return NextResponse.json({ success: true });
}
