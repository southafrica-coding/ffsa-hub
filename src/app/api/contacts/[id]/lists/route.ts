import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  addContactsToList,
  createContactList,
} from "@/services/contact-lists";

/**
 * Add this contact to a list — either an existing one (listId) or a
 * brand-new list created inline (newListName).
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: contactId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { listId?: string; newListName?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let listId = body.listId ?? null;

  if (!listId && body.newListName?.trim()) {
    const created = await createContactList(supabase, {
      name: body.newListName.trim(),
      createdBy: user.id,
    });
    if (created.error || !created.data) {
      return NextResponse.json(
        { error: created.error?.message ?? "Failed to create list" },
        { status: 403 }
      );
    }
    listId = created.data.id;
  }

  if (!listId) {
    return NextResponse.json(
      { error: "listId or newListName is required" },
      { status: 400 }
    );
  }

  const { error } = await addContactsToList(supabase, listId, [contactId], user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }

  return NextResponse.json({ listId, contactId });
}
