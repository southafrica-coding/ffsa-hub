import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deleteEmailTemplate } from "@/services/email-templates";
import { getAuthedUser, canManageComms } from "@/lib/api-auth";

// DELETE /api/email-templates/[id] — remove a saved custom template.
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await canManageComms(supabase, user.id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { error } = await deleteEmailTemplate(supabase, id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: true });
}
