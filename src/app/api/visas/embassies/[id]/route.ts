import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { updateVisaEmbassy } from "@/services/visas";
import { getVisaAccess } from "@/lib/visas/access";
import { isUuid, refusePreviewWrite, tableErrorResponse } from "@/lib/visas/api";
import { cleanEmbassy } from "@/lib/visas/embassies";

// PATCH — global legal edits an embassy profile, or retires it
// (is_active: false). Embassies are never deleted: old cases point at them.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const refusal = refusePreviewWrite();
  if (refusal) return refusal;
  if (!isUuid(id)) return NextResponse.json({ error: "Embassy not found" }, { status: 404 });
  if (!(await getVisaAccess(supabase, user.id)).globalLegal) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const cleaned = cleanEmbassy(await request.json().catch(() => ({})));
  if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });

  const { data, error } = await updateVisaEmbassy(supabase, id, { ...cleaned.data }, user.id);
  if (error) return tableErrorResponse(error, "That embassy is already in the list");
  if (!data) return NextResponse.json({ error: "Embassy not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
