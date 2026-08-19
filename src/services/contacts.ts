import type { TablesInsert, TablesUpdate } from "@/types/database";
type ContactInsert = TablesInsert<"contacts">;
type ContactUpdate = TablesUpdate<"contacts">;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type ContactSort =
  | "newest"
  | "oldest"
  | "name_asc"
  | "name_desc"
  | "recent";

// One identifier (an email or a phone) that matched a search term, with
// enough provenance for the directory to say WHAT it matched on — frame 35a's
// "matched on an old phone she no longer uses".
export type IdentifierHit = {
  contactId: string;
  kind: "email" | "phone";
  value: string;
  isPrimary: boolean;
  // 1-based position among that contact's identifiers of the same kind, so the
  // UI can render "PHONE 2" rather than the raw value.
  position: number;
};

// Contacts whose identifiers match `term`, across contact_emails and
// contact_phones rather than the denormalised contacts.email / contacts.phone
// cache. This is the difference between "she is not in the system" and "she is,
// under the address she used in 2023".
//
// Capped: a term like "0" would match every phone on file and blow the URL
// length of the id.in.() filter that consumes this. The cap is generous
// relative to any real lookup and is reported so the caller can say so.
export const IDENTIFIER_MATCH_CAP = 200;

export async function findContactsByIdentifier(
  supabase: Client,
  term: string
): Promise<{ hits: IdentifierHit[]; capped: boolean }> {
  const like = `%${term.replace(/[,()]/g, "")}%`;
  const normalized = term.replace(/[^0-9+a-zA-Z@.]/g, "");

  const [emails, phones] = await Promise.all([
    supabase
      .from("contact_emails")
      .select("contact_id, email, is_primary, created_at")
      .ilike("email", like)
      .order("created_at", { ascending: true })
      .limit(IDENTIFIER_MATCH_CAP + 1),
    // Phones are matched on both the raw and the normalised column: someone
    // types "082 445 1120" but E.164 stores "+27824451120", and vice versa.
    supabase
      .from("contact_phones")
      .select("contact_id, phone, phone_normalized, is_primary, created_at")
      .or(
        `phone.ilike.${like}` +
          (normalized ? `,phone_normalized.ilike.%${normalized}%` : "")
      )
      .order("created_at", { ascending: true })
      .limit(IDENTIFIER_MATCH_CAP + 1),
  ]);

  const hits: IdentifierHit[] = [];
  // Position is per contact per kind, in the order the identifiers were added.
  const seen = new Map<string, number>();

  for (const row of (emails.data ?? []) as Array<Record<string, unknown>>) {
    const contactId = row.contact_id as string;
    const n = (seen.get(`e:${contactId}`) ?? 0) + 1;
    seen.set(`e:${contactId}`, n);
    hits.push({
      contactId,
      kind: "email",
      value: row.email as string,
      isPrimary: Boolean(row.is_primary),
      position: n,
    });
  }
  for (const row of (phones.data ?? []) as Array<Record<string, unknown>>) {
    const contactId = row.contact_id as string;
    const n = (seen.get(`p:${contactId}`) ?? 0) + 1;
    seen.set(`p:${contactId}`, n);
    hits.push({
      contactId,
      kind: "phone",
      value: row.phone as string,
      isPrimary: Boolean(row.is_primary),
      position: n,
    });
  }

  const capped = hits.length > IDENTIFIER_MATCH_CAP;
  return { hits: capped ? hits.slice(0, IDENTIFIER_MATCH_CAP) : hits, capped };
}

export async function getContacts(
  supabase: Client,
  options?: {
    status?: string;
    search?: string;
    // Contact ids already known to match by identifier (from
    // findContactsByIdentifier). OR-ed with the name/cache columns so a hit on
    // a non-primary address still returns the person.
    identifierMatchIds?: string[];
    labelId?: string;
    marketingStatus?: string;
    sort?: ContactSort;
    limit?: number;
    offset?: number;
  }
) {
  // contact_emails/contact_phones are selected as COUNTS only — the directory's
  // "3 emails, 2 phones on file" line needs the number, not the addresses, and
  // pulling every identifier for 25 rows would triple the payload.
  //
  // The label filter needs an INNER join to actually filter; a plain embed
  // returns every contact with the non-matching labels merely emptied out.
  const labelJoin = options?.labelId ? "contact_labels!inner" : "contact_labels";
  let query = supabase
    .from("contacts")
    .select(
      `*, person_type_assignments(person_types(*)), ${labelJoin}(labels(id, slug, name, color)), contact_emails(count), contact_phones(count)`,
      { count: "exact" }
    );

  switch (options?.sort ?? "newest") {
    case "oldest":
      query = query.order("created_at", { ascending: true });
      break;
    case "name_asc":
      query = query
        .order("last_name", { ascending: true, nullsFirst: false })
        .order("first_name", { ascending: true, nullsFirst: false });
      break;
    case "name_desc":
      query = query
        .order("last_name", { ascending: false, nullsFirst: false })
        .order("first_name", { ascending: false, nullsFirst: false });
      break;
    case "recent":
      query = query.order("last_interaction_at", {
        ascending: false,
        nullsFirst: false,
      });
      break;
    case "newest":
    default:
      query = query.order("created_at", { ascending: false });
      break;
  }

  if (options?.status) {
    query = query.eq("status", options.status);
  }

  if (options?.marketingStatus) {
    query = query.eq("marketing_status", options.marketingStatus);
  }

  if (options?.search) {
    // Match each whitespace-separated token against any name/contact column.
    // Tokens are AND-ed (each token must match some column) while columns are
    // OR-ed, so "John Smith" finds a contact whose first_name is "John" and
    // last_name is "Smith" — not just single-token surname searches.
    const columns = [
      "first_name",
      "last_name",
      "preferred_name",
      "email",
      "phone",
    ];
    const tokens = options.search
      .trim()
      .split(/\s+/)
      // Strip PostgREST reserved characters so tokens can't break the or() filter.
      .map((token) => token.replace(/[,()]/g, ""))
      .filter(Boolean);

    // Ids that matched on an identifier are OR-ed in alongside the column
    // filters. They are added to EVERY token's clause because the identifier
    // lookup was run against the whole search string — a two-token search like
    // "naledi 082" should still surface her if the phone alone identified her.
    const idClause =
      options.identifierMatchIds && options.identifierMatchIds.length > 0
        ? `,id.in.(${options.identifierMatchIds.join(",")})`
        : "";

    for (const token of tokens) {
      const term = `%${token}%`;
      query = query.or(
        columns.map((column) => `${column}.ilike.${term}`).join(",") + idClause
      );
    }
  }

  if (options?.labelId) {
    // Filter to contacts that hold this label.
    query = query.eq("contact_labels.label_id", options.labelId);
  }

  if (options?.limit) {
    const from = options.offset ?? 0;
    query = query.range(from, from + options.limit - 1);
  }

  return query;
}

export async function getContactById(supabase: Client, id: string) {
  return supabase
    .from("contacts")
    .select(
      "*, person_type_assignments(person_types(*)), person_tags(tags(*))"
    )
    .eq("id", id)
    .single();
}

export async function createContact(supabase: Client, data: ContactInsert) {
  return supabase.from("contacts").insert(data).select().single();
}

export async function updateContact(
  supabase: Client,
  id: string,
  data: ContactUpdate
) {
  return supabase.from("contacts").update(data).eq("id", id).select().single();
}

export async function archiveContact(supabase: Client, id: string) {
  return supabase
    .from("contacts")
    .update({ status: "archived" })
    .eq("id", id)
    .select()
    .single();
}

export async function findDuplicates(
  supabase: Client,
  data: { first_name: string; last_name: string; email?: string | null; phone?: string | null }
) {
  const firstName = data.first_name.trim().toLowerCase();
  const lastName = data.last_name.trim().toLowerCase();

  let query = supabase
    .from("contacts")
    .select("id, first_name, last_name, preferred_name, email, phone, status")
    .eq("status", "active");

  if (data.email) {
    const email = data.email.trim().toLowerCase();
    query = query.or(
      `email.ilike.${email},and(first_name.ilike.${firstName},last_name.ilike.${lastName})`
    );
  } else {
    query = query.ilike("first_name", firstName).ilike("last_name", lastName);
  }

  return query.limit(10);
}

// ────────────────────────────────────────────────────────────
// CRM dedup: match by email_normalized OR phone_normalized
// ------------------------------------------------------------
// Returns up to two contacts: one matched by email, one by phone.
// When both keys hit the SAME contact, only that contact comes
// back. Caller uses the result to decide: create new, merge, or
// queue for manual review (the email-A / phone-B conflict).
// ────────────────────────────────────────────────────────────

export type DedupMatch = {
  contact: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
    email_normalized: string | null;
    phone_normalized: string | null;
  };
  matched_on: ("email" | "phone")[];
};

export async function findDedupMatches(
  supabase: Client,
  keys: { emailNormalized: string | null; phoneNormalized: string | null }
): Promise<{ data: DedupMatch[] | null; error: unknown }> {
  const { emailNormalized, phoneNormalized } = keys;
  if (!emailNormalized && !phoneNormalized) {
    return { data: [], error: null };
  }

  // Look across the contact_emails / contact_phones join tables (any
  // email or phone the contact holds — not just the primary cache on
  // contacts.email / contacts.phone). This is what enables Jaco-style
  // "same person, different identifier" deduplication.
  const emailMatchIds = new Set<string>();
  const phoneMatchIds = new Set<string>();

  if (emailNormalized) {
    const { data, error } = await supabase
      .from("contact_emails")
      .select("contact_id")
      .eq("email_normalized", emailNormalized);
    if (error) return { data: null, error };
    for (const r of (data ?? []) as Array<{ contact_id: string }>) {
      emailMatchIds.add(r.contact_id);
    }
  }
  if (phoneNormalized) {
    const { data, error } = await supabase
      .from("contact_phones")
      .select("contact_id")
      .eq("phone_normalized", phoneNormalized);
    if (error) return { data: null, error };
    for (const r of (data ?? []) as Array<{ contact_id: string }>) {
      phoneMatchIds.add(r.contact_id);
    }
  }

  const allIds = new Set<string>([...emailMatchIds, ...phoneMatchIds]);
  if (allIds.size === 0) {
    return { data: [], error: null };
  }

  // Cap at 2 — that's all the calling logic ever needs (one match =
  // enrich/merge, two = email-A / phone-B conflict → queue).
  const targetIds = Array.from(allIds).slice(0, 2);

  const { data, error } = await supabase
    .from("contacts")
    .select(
      "id, first_name, last_name, email, phone, email_normalized, phone_normalized"
    )
    .in("id", targetIds);
  if (error || !data) return { data: null, error };

  const matches: DedupMatch[] = data.map((row: DedupMatch["contact"]) => {
    const matchedOn: ("email" | "phone")[] = [];
    if (emailMatchIds.has(row.id)) matchedOn.push("email");
    if (phoneMatchIds.has(row.id)) matchedOn.push("phone");
    return { contact: row, matched_on: matchedOn };
  });

  return { data: matches, error: null };
}

export async function assignPersonType(
  supabase: Client,
  contactId: string,
  personTypeId: string
) {
  return supabase
    .from("person_type_assignments")
    .insert({ contact_id: contactId, person_type_id: personTypeId })
    .select()
    .single();
}

export async function removePersonType(
  supabase: Client,
  contactId: string,
  personTypeId: string
) {
  return supabase
    .from("person_type_assignments")
    .delete()
    .eq("contact_id", contactId)
    .eq("person_type_id", personTypeId);
}

export async function assignTag(
  supabase: Client,
  contactId: string,
  tagId: string
) {
  return supabase
    .from("person_tags")
    .insert({ contact_id: contactId, tag_id: tagId });
}

export async function removeTag(
  supabase: Client,
  contactId: string,
  tagId: string
) {
  return supabase
    .from("person_tags")
    .delete()
    .eq("contact_id", contactId)
    .eq("tag_id", tagId);
}

export async function getPersonTypes(supabase: Client) {
  return supabase.from("person_types").select("*").order("name");
}

export async function getTags(supabase: Client) {
  return supabase.from("tags").select("*").order("name");
}

export async function createTag(
  supabase: Client,
  data: { name: string; category?: string }
) {
  return supabase.from("tags").insert(data).select().single();
}
