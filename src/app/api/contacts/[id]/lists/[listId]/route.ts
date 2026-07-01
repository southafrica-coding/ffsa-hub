import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { removeContactFromList } from "@/services/contact-lists";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; listId: string }> }
) {
  const { id: contactId, listId } = await context.params;
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
