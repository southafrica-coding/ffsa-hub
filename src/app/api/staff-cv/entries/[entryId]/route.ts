import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import { canManageCvEntry } from "@/lib/auth/check-cv-access";
import { getCvEntry, updateCvEntry, deleteCvEntry } from "@/services/staff-cv";

// PATCH /api/staff-cv/entries/[entryId] — edit title/description.
export async function PATCH(
  request: Request,
  context: { params: Promise<{ entryId: string }> }
) {
  const { entryId } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: entry } = await getCvEntry(createAdminClient(), entryId);
  if (!entry) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }
  if (!(await canManageCvEntry(supabase, user.id, entry))) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const body = await request.json();
  const title = typeof body.title === "string" ? body.title.trim() : undefined;
  const description = typeof body.description === "string" ? body.description.trim() : undefined;
  if (title !== undefined && !title) {
    return NextResponse.json({ error: "Please enter a title" }, { status: 400 });
  }

  const client = entry.added_by_role === "self" && entry.user_id === user.id ? supabase : createAdminClient();
  const { data, error } = await updateCvEntry(client, entryId, { title, description });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ entry: data });
}

// DELETE /api/staff-cv/entries/[entryId] — remove an entry.
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ entryId: string }> }
) {
  const { entryId } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: entry } = await getCvEntry(createAdminClient(), entryId);
  if (!entry) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }
  if (!(await canManageCvEntry(supabase, user.id, entry))) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const client = entry.added_by_role === "self" && entry.user_id === user.id ? supabase : createAdminClient();
  const { error } = await deleteCvEntry(client, entryId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
