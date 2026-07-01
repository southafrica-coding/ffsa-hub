import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  updateContactList,
  deleteContactList,
} from "@/services/contact-lists";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ listId: string }> }
) {
  const { listId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { name?: string; description?: string | null; color?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const patch: { name?: string; description?: string | null; color?: string | null } = {};
  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) {
      return NextResponse.json({ error: "A list name is required" }, { status: 400 });
    }
    patch.name = name;
  }
  if (body.description !== undefined) patch.description = body.description?.trim() || null;
  if (body.color !== undefined) patch.color = body.color;

  const { data, error } = await updateContactList(supabase, listId, patch);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  return NextResponse.json({ list: data });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ listId: string }> }
) {
  const { listId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { error } = await deleteContactList(supabase, listId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  return NextResponse.json({ deleted: true });
}
