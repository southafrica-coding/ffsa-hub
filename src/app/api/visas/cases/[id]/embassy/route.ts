import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { setVisaCaseEmbassy } from "@/services/visas";
import { isUuid, refusePreviewWrite, rpcErrorResponse } from "@/lib/visas/api";

// POST — where the case will be lodged. { embassy_id: uuid | null }
// visa_set_case_embassy decides who may: the student until legal approves,
// legal for the case until it's lodged.
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
  const embassyId: unknown = body.embassy_id;
  if (!isUuid(id) || (embassyId !== null && !isUuid(embassyId))) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const { error } = await setVisaCaseEmbassy(supabase, id, embassyId);
  if (error) return rpcErrorResponse(error);
  return NextResponse.json({ success: true });
}
