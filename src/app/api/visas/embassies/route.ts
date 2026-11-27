import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createVisaEmbassy } from "@/services/visas";
import { getVisaAccess } from "@/lib/visas/access";
import { refusePreviewWrite, tableErrorResponse } from "@/lib/visas/api";
import { cleanEmbassy } from "@/lib/visas/embassies";

// POST — global legal adds an embassy profile (500). RLS refuses anyone else too.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const refusal = refusePreviewWrite();
  if (refusal) return refusal;
  if (!(await getVisaAccess(supabase, user.id)).globalLegal) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const cleaned = cleanEmbassy(await request.json().catch(() => ({})));
  if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });

  const { data, error } = await createVisaEmbassy(supabase, { ...cleaned.data }, user.id);
  if (error) return tableErrorResponse(error, "That embassy is already in the list");
  return NextResponse.json({ success: true, id: data.id });
}
