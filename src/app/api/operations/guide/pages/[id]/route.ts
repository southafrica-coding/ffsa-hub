import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cleanPage } from "@/lib/operations/guide";
import { deletePage, updatePage } from "@/services/ops-guide";

// PATCH /api/operations/guide/pages/[id] — change a page's title, text or
// position. Every save is kept (ops_guide_page_versions). DELETE removes it.
// RLS: only the area's lead; anyone else gets "not found".
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const cleaned = cleanPage(body, true);
  if (!cleaned.ok) return NextResponse.json({ error: cleaned.error }, { status: 400 });

  const { data, error } = await updatePage(supabase, id, cleaned.value);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Page not found, or it isn't yours to change" }, { status: 404 });
  return NextResponse.json({ success: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data, error } = await deletePage(supabase, id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Page not found, or it isn't yours to remove" }, { status: 404 });
  return NextResponse.json({ success: true });
}
