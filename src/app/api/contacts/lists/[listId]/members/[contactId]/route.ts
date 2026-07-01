import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { removeContactFromList } from "@/services/contact-lists";

/** Remove a single contact from a list (used by the list members table). */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ listId: string; contactId: string }> }
) {
  const { listId, contactId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { error } = await removeContactFromList(supabase, listId, contactId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  return NextResponse.json({ removed: true });
}
