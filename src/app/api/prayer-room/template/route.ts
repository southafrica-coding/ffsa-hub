import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getTemplateBlocks,
  createTemplateBlock,
  updateTemplateBlock,
  deleteTemplateBlock,
} from "@/services/prayer-room";

// GET — the weekly template blocks (readable by any authenticated user).
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data, error } = await getTemplateBlocks(supabase);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// POST — add a template block (RLS: staff only).
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { day_of_week, start_time, end_time } = body as { day_of_week?: number; start_time?: string; end_time?: string };
  if (day_of_week === undefined || !start_time || !end_time) {
    return NextResponse.json({ error: "day_of_week, start_time and end_time are required" }, { status: 400 });
  }
  if (end_time <= start_time) {
    return NextResponse.json({ error: "end_time must be after start_time" }, { status: 400 });
  }

  // Curated-band attributes are accepted on create as well as on edit.
  // Without this a band could only be made by hand-writing SQL: PUT allows
  // band_name/is_curated but there was no way to create a block that had them,
  // so migration 171's columns stayed empty and the wall drew no bands.
  // WHO may set them is still RLS's call — insert is staff-only ("Staff manage
  // template"), while editing a band is open to evaluators.
  const { data, error } = await createTemplateBlock(supabase, {
    day_of_week,
    start_time,
    end_time,
    title: (body.title as string) ?? null,
    role_needs: (body.role_needs as Record<string, number>) ?? {},
    band_name: (body.band_name as string) ?? null,
    weekly_focus: (body.weekly_focus as string) ?? null,
    is_curated: body.is_curated === true,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 403 });
  return NextResponse.json(data);
}

// PUT — edit a template block (RLS: staff only).
export async function PUT(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { id } = body as { id?: string };
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const fields: Record<string, unknown> = {};
  for (const k of [
    "day_of_week", "start_time", "end_time", "title", "role_needs", "is_active",
    // Curated-band attributes (migration 171). Writing these is restricted to
    // evaluators by RLS, not here — the whitelist only decides what MAY be
    // written, never who may write it.
    "band_name", "weekly_focus", "lead_user_id", "is_curated",
  ]) {
    if (k in body) fields[k] = body[k];
  }
  const { data, error } = await updateTemplateBlock(supabase, id, fields);
  if (error) return NextResponse.json({ error: error.message }, { status: 403 });
  return NextResponse.json(data);
}

// DELETE — remove a template block (RLS: staff only).
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const { error } = await deleteTemplateBlock(supabase, id);
  if (error) return NextResponse.json({ error: error.message }, { status: 403 });
  return NextResponse.json({ ok: true });
}
