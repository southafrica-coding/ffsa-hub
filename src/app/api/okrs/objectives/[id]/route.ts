import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import { callerCanEditObjective } from "@/lib/auth/check-okr-access";
import { deleteObjective, getObjective, updateObjective } from "@/services/okrs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const { data, error } = await getObjective(supabase, id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Objective not found" }, { status: 404 });
  return NextResponse.json({ objective: data });
}

const EDITABLE = [
  "title",
  "description",
  "timeline",
  "notes",
  "owner_note",
  "position",
  "subcategory_id",
  "is_archived",
] as const;

export async function PATCH(request: Request, { params }: Params) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  if (!(await callerCanEditObjective(supabase, user.id, id))) {
    return NextResponse.json({ error: "You cannot edit this objective" }, { status: 403 });
  }

  const body = await request.json();

  // Whitelisted: cycle_id, scope, staff_ministry_id and owner_user_id are not
  // editable here — moving an objective between ministries or scopes changes
  // who can see it, which is not a field edit.
  const patch: Record<string, unknown> = {};
  for (const key of EDITABLE) {
    if (key in body) patch[key] = body[key];
  }
  if (typeof patch.title === "string") patch.title = patch.title.trim();
  if (patch.title === "") {
    return NextResponse.json({ error: "title cannot be empty" }, { status: 400 });
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { data, error } = await updateObjective(supabase, id, patch);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, objective: data });
}

export async function DELETE(_request: Request, { params }: Params) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  if (!(await callerCanEditObjective(supabase, user.id, id))) {
    return NextResponse.json({ error: "You cannot delete this objective" }, { status: 403 });
  }

  const { data, error } = await deleteObjective(supabase, id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) {
    return NextResponse.json({ error: "You cannot delete this objective" }, { status: 403 });
  }
  return NextResponse.json({ success: true });
}
