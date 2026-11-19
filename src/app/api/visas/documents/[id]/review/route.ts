import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { reviewVisaDocument } from "@/services/visas";
import { cleanNote, isUuid, refusePreviewWrite, rpcErrorResponse } from "@/lib/visas/api";

// POST — a school leader approves a document or asks for a redo.
// { approve: boolean, note? } — a redo needs a note; the student sees it.
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
  if (!body.approve && !note) return NextResponse.json({ error: "Say what needs redoing" }, { status: 400 });
  const { error } = await reviewVisaDocument(supabase, id, body.approve, note);
  if (error) return rpcErrorResponse(error);
  return NextResponse.json({ success: true });
}
