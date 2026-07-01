// ────────────────────────────────────────────────────────────
// Contact Lists — ad-hoc organizational groupings of contacts.
// See migration 118. Deliberately free of any marketing/email
// semantics (that is what labels are for): adding/removing a
// contact here has no side effects.
// ────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type ContactListRow = {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  created_by: string | null;
  created_at: string;
};

// ────────────────────────────────────────────────────────────
// Lists
// ────────────────────────────────────────────────────────────

/** All lists, each with a member_count, ordered by name. */
export async function getContactLists(supabase: Client) {
  return supabase
    .from("contact_lists")
    .select("*, contact_list_members(count)")
    .order("name", { ascending: true });
}

export async function getContactListById(supabase: Client, id: string) {
  return supabase
    .from("contact_lists")
    .select("*")
    .eq("id", id)
    .maybeSingle();
}

export async function createContactList(
  supabase: Client,
  data: {
    name: string;
    description?: string | null;
    color?: string | null;
    createdBy?: string | null;
  }
) {
  return supabase
    .from("contact_lists")
    .insert({
      name: data.name,
      description: data.description ?? null,
      color: data.color ?? null,
      created_by: data.createdBy ?? null,
    })
    .select()
    .single();
}

export async function updateContactList(
  supabase: Client,
  id: string,
  data: { name?: string; description?: string | null; color?: string | null }
) {
  return supabase
    .from("contact_lists")
    .update(data)
    .eq("id", id)
    .select()
    .single();
}

export async function deleteContactList(supabase: Client, id: string) {
  // ON DELETE CASCADE removes the member rows with it.
  return supabase.from("contact_lists").delete().eq("id", id);
}

// ────────────────────────────────────────────────────────────
// Membership
// ────────────────────────────────────────────────────────────

/** The contacts that belong to a list. */
export async function getListMembers(
  supabase: Client,
  listId: string,
  options?: { limit?: number; offset?: number }
) {
  let query = supabase
    .from("contact_list_members")
    .select(
      "added_at, contacts(id, first_name, last_name, preferred_name, email, phone, status)",
      { count: "exact" }
    )
    .eq("list_id", listId)
    .order("added_at", { ascending: false });

  if (options?.limit) {
    const from = options.offset ?? 0;
    query = query.range(from, from + options.limit - 1);
  }

  return query;
}

/** The lists a single contact belongs to (for the contact detail card). */
export async function getListsForContact(supabase: Client, contactId: string) {
  return supabase
    .from("contact_list_members")
    .select("added_at, contact_lists(id, name, color)")
    .eq("contact_id", contactId)
    .order("added_at", { ascending: false });
}

/**
 * Add one or more contacts to a list. Idempotent — contacts already
 * in the list are ignored rather than erroring.
 */
export async function addContactsToList(
  supabase: Client,
  listId: string,
  contactIds: string[],
  addedBy?: string | null
) {
  const rows = contactIds.map((contactId) => ({
    list_id: listId,
    contact_id: contactId,
    added_by: addedBy ?? null,
  }));
  return supabase
    .from("contact_list_members")
    .upsert(rows, {
      onConflict: "list_id,contact_id",
      ignoreDuplicates: true,
    });
}

export async function removeContactFromList(
  supabase: Client,
  listId: string,
  contactId: string
) {
  return supabase
    .from("contact_list_members")
    .delete()
    .eq("list_id", listId)
    .eq("contact_id", contactId);
}
