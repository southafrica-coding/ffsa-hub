import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { confirmVisaLetter } from "@/services/visas";
import { cleanNote, isUuid, refusePreviewWrite, rpcErrorResponse } from "@/lib/visas/api";

// POST — the student checks a letter's details before it's signed.
// { ok: true } or { ok: false, note: "what's wrong" }.
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
  if (!isUuid(id) || typeof body.ok !== "boolean") {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  const note = cleanNote(body.note);
  if (!body.ok && !note) return NextResponse.json({ error: "Say what's wrong" }, { status: 400 });

  const { error } = await confirmVisaLetter(supabase, id, body.ok, note);
  if (error) return rpcErrorResponse(error);
  return NextResponse.json({ success: true });
}
