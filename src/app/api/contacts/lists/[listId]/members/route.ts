import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { addContactsToList } from "@/services/contact-lists";

/** Bulk-add contacts to a list (used by the contacts-table multi-select). */
export async function POST(
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

  let body: { contactIds?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const contactIds = Array.from(
    new Set((body.contactIds ?? []).filter((id): id is string => typeof id === "string"))
  );
  if (contactIds.length === 0) {
    return NextResponse.json({ error: "No contacts selected" }, { status: 400 });
  }

  const { error } = await addContactsToList(supabase, listId, contactIds, user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }

  return NextResponse.json({ added: contactIds.length });
}
