import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAreaKey } from "@/lib/operations/areas";
import { cleanLink } from "@/lib/operations/guide";
import { createLink, isAreaLead } from "@/services/ops-guide";

// POST /api/operations/guide/links — add a resource (a form, template or
// doc, with a note on when and why it's used). Only the area's lead.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (!isAreaKey(body.area)) return NextResponse.json({ error: "Unknown area" }, { status: 400 });
  if (!(await isAreaLead(supabase, body.area))) {
    return NextResponse.json({ error: "Only this area's lead can change its guide" }, { status: 403 });
  }
  const cleaned = cleanLink(body);
  if (!cleaned.ok) return NextResponse.json({ error: cleaned.error }, { status: 400 });

  const { data, error } = await createLink(supabase, { area: body.area, ...cleaned.value });
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Couldn't add the resource" }, { status: 500 });
  return NextResponse.json({ success: true, id: data.id });
}
