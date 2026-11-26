import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAreaKey } from "@/lib/operations/areas";
import { cleanPage } from "@/lib/operations/guide";
import { createPage, isAreaLead } from "@/services/ops-guide";

// POST /api/operations/guide/pages — add a How-we-do-it page to an area's
// guide. Only that area's lead (RLS enforces it too).
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (!isAreaKey(body.area)) return NextResponse.json({ error: "Unknown area" }, { status: 400 });
  if (!(await isAreaLead(supabase, body.area))) {
    return NextResponse.json({ error: "Only this area's lead can change its guide" }, { status: 403 });
  }
  const cleaned = cleanPage(body);
  if (!cleaned.ok) return NextResponse.json({ error: cleaned.error }, { status: 400 });

  const { data, error } = await createPage(supabase, { area: body.area, ...(cleaned.value as { title: string; body: string }) });
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Couldn't add the page" }, { status: 500 });
  return NextResponse.json({ success: true, id: data.id });
}
