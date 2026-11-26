import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withdrawVisaLetter } from "@/services/visas";
import { cleanNote, isUuid, refusePreviewWrite, rpcErrorResponse } from "@/lib/visas/api";

// POST — legal takes a letter back. { note } says why.
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
  const note = cleanNote(body.note);
  if (!isUuid(id) || !note) return NextResponse.json({ error: "Say why it's withdrawn" }, { status: 400 });

  const { error } = await withdrawVisaLetter(supabase, id, note);
  if (error) return rpcErrorResponse(error);
  return NextResponse.json({ success: true });
}
