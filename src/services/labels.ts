import type { TablesInsert, TablesUpdate } from "@/types/database";
import { LABEL_PALETTE } from "@/lib/label-color";

type LabelInsert = TablesInsert<"labels">;
type LabelUpdate = TablesUpdate<"labels">;
type ContactLabelInsert = TablesInsert<"contact_labels">;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

// ────────────────────────────────────────────────────────────
// Labels
// ────────────────────────────────────────────────────────────

export async function getLabels(
  supabase: Client,
  options?: {
    active?: boolean;
    category?: string;
    search?: string;
  }
) {
  let query = supabase
    .from("labels")
    .select("*, sending_identities(slug, display_name, from_email)")
    .order("name");

  if (options?.active !== undefined) {
    query = query.eq("is_active", options.active);
  }
  if (options?.category) {
    query = query.eq("category", options.category);
  }
  if (options?.search) {
    const term = `%${options.search}%`;
    query = query.or(`name.ilike.${term},slug.ilike.${term},description.ilike.${term}`);
  }

  return query;
}

export async function getLabelBySlug(supabase: Client, slug: string) {
  return supabase
    .from("labels")
    .select("*, sending_identities(slug, display_name, from_email)")
    .eq("slug", slug)
    .maybeSingle();
}

export async function getLabelById(supabase: Client, id: string) {
  return supabase
    .from("labels")
    .select("*, sending_identities(slug, display_name, from_email)")
    .eq("id", id)
    .maybeSingle();
}

export async function createLabel(supabase: Client, data: LabelInsert) {
  return supabase.from("labels").insert(data).select().single();
}

export async function updateLabel(supabase: Client, id: string, data: LabelUpdate) {
  return supabase.from("labels").update(data).eq("id", id).select().single();
}

export async function deactivateLabel(supabase: Client, id: string) {
  return supabase.from("labels").update({ is_active: false }).eq("id", id).select().single();
}

// Hard delete. Cascades to contact_labels + unsubscribes (see migrations
// 042/046/052) and nulls events.base_label_id / event_outcomes.label_id.
// Blocked by ON DELETE RESTRICT if any form (044) or campaign_labels (051)
// still references the label — callers should pre-flight those and/or map
// the Postgres 23503 error to a friendly message.
export async function deleteLabel(supabase: Client, id: string) {
  return supabase.from("labels").delete().eq("id", id);
}

// ────────────────────────────────────────────────────────────
// Contact ↔ Label assignments
// ────────────────────────────────────────────────────────────

export async function getContactLabels(supabase: Client, contactId: string) {
  return supabase
    .from("contact_labels")
    .select("added_at, added_via, labels(id, slug, name, category, color, is_active)")
    .eq("contact_id", contactId)
    .order("added_at", { ascending: false });
}

export async function getLabelContacts(
  supabase: Client,
  labelId: string,
  options?: { limit?: number; offset?: number }
) {
  let query = supabase
    .from("contact_labels")
    .select("added_at, added_via, contacts(id, first_name, last_name, email, phone)", {
      count: "exact",
    })
    .eq("label_id", labelId)
    .order("added_at", { ascending: false });

  if (options?.limit) {
    const from = options.offset ?? 0;
    query = query.range(from, from + options.limit - 1);
  }

  return query;
}

export async function addLabelToContact(supabase: Client, data: ContactLabelInsert) {
  return supabase
    .from("contact_labels")
    .upsert(data, { onConflict: "contact_id,label_id", ignoreDuplicates: true })
    .select()
    .maybeSingle();
}

export async function removeLabelFromContact(
  supabase: Client,
  contactId: string,
  labelId: string
) {
  // The 046 trigger writes an unsubscribes row automatically.
  return supabase
    .from("contact_labels")
    .delete()
    .eq("contact_id", contactId)
    .eq("label_id", labelId);
}

// ────────────────────────────────────────────────────────────
// Find-or-create (used by CSV imports + form submissions when
// custom_label_allowed = true)
// ────────────────────────────────────────────────────────────

export async function findOrCreateLabel(
  supabase: Client,
  args: { slug: string; name: string; createdBy?: string | null; category?: string | null }
) {
  const existing = await getLabelBySlug(supabase, args.slug);
  if (existing.data) return existing;

  const color = await pickLeastUsedLabelColor(supabase);

  return createLabel(supabase, {
    slug: args.slug,
    name: args.name,
    category: args.category ?? null,
    color,
    is_preset: false,
    is_active: true,
    created_by: args.createdBy ?? null,
  });
}

// ────────────────────────────────────────────────────────────
// Color assignment: pick the palette hex used by the fewest
// existing labels. Ties broken by palette index order, so the
// rotation is stable.
// ────────────────────────────────────────────────────────────

export async function pickLeastUsedLabelColor(supabase: Client): Promise<string> {
  const { data } = await supabase.from("labels").select("color");
  const counts = new Map<string, number>();
  for (const p of LABEL_PALETTE) counts.set(p.bg.toLowerCase(), 0);
  for (const row of (data ?? []) as Array<{ color: string | null }>) {
    if (!row.color) continue;
    const c = row.color.toLowerCase();
    if (counts.has(c)) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  let bestHex = LABEL_PALETTE[0].bg;
  let bestCount = Infinity;
  for (const p of LABEL_PALETTE) {
    const c = counts.get(p.bg.toLowerCase()) ?? 0;
    if (c < bestCount) {
      bestCount = c;
      bestHex = p.bg;
    }
  }
  return bestHex;
}

// ────────────────────────────────────────────────────────────
// Label counts for the directory sidebar (frame 35a)
// ────────────────────────────────────────────────────────────
// "The count beside each one is live, so a filtered list is already the
// audience." Counts are of ACTIVE contacts only — an archived person is not
// someone you would mail, so including them would make every count a lie the
// moment you clicked through to the list.
export async function getLabelCounts(
  supabase: Client
): Promise<Map<string, number>> {
  const { data } = await supabase
    .from("contact_labels")
    .select("label_id, contacts!inner(status)")
    .eq("contacts.status", "active");

  const counts = new Map<string, number>();
  for (const row of (data ?? []) as Array<{ label_id: string }>) {
    counts.set(row.label_id, (counts.get(row.label_id) ?? 0) + 1);
  }
  return counts;
}
