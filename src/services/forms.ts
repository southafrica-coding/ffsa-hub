import type { TablesInsert, TablesUpdate } from "@/types/database";

type FormInsert = TablesInsert<"forms">;
type FormUpdate = TablesUpdate<"forms">;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

// ────────────────────────────────────────────────────────────
// Forms
// ────────────────────────────────────────────────────────────

export async function listFormsForEvent(supabase: Client, eventId: string) {
  return supabase
    .from("forms")
    .select("id, slug, name, is_active, records_attendance, created_at, label_id")
    .eq("event_id", eventId)
    .order("created_at");
}

export async function getFormById(supabase: Client, id: string) {
  return supabase
    .from("forms")
    .select("*, events(id, title), labels(id, slug, name, color)")
    .eq("id", id)
    .maybeSingle();
}

/**
 * The Missio weekly feedback form, by slug and kind. Under RLS a
 * non-admin only sees it while it is active.
 */
export async function getMissioWeeklyFeedbackForm(supabase: Client) {
  return supabase
    .from("forms")
    .select("id, name, slug, kind, event_id, is_active, records_attendance, label_id, access_mode, schema")
    .eq("slug", "missio-weekly-feedback")
    .eq("kind", "missio_weekly_feedback")
    .is("event_id", null)
    .maybeSingle();
}

export async function getFormBySlug(supabase: Client, slug: string) {
  return supabase
    .from("forms")
    .select("*, events(id, title, logo_url, brand), labels(id, slug, name)")
    .eq("slug", slug)
    .maybeSingle();
}

// Submissions for a form, newest first, with the resolved contact (if any).
export async function listFormSubmissions(
  supabase: Client,
  formId: string,
  limit = 300
) {
  return supabase
    .from("form_submissions")
    .select(
      "id, contact_id, raw_data, dedup_action, submitted_at, contacts(id, first_name, last_name, preferred_name, email, phone)"
    )
    .eq("form_id", formId)
    .order("submitted_at", { ascending: false })
    .limit(limit);
}

export async function createForm(supabase: Client, data: FormInsert) {
  return supabase.from("forms").insert(data).select().single();
}

export async function updateForm(supabase: Client, id: string, data: FormUpdate) {
  return supabase.from("forms").update(data).eq("id", id).select().single();
}

export async function deleteForm(supabase: Client, id: string) {
  return supabase.from("forms").delete().eq("id", id).select("id");
}

// ────────────────────────────────────────────────────────────
// Slug generation — unique, derived from the form name
// ────────────────────────────────────────────────────────────

export async function generateUniqueFormSlug(
  supabase: Client,
  name: string
): Promise<string> {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 48) || "form";

  let candidate = base;
  let n = 1;
  // Loop until the slug is free.
  for (;;) {
    const { data } = await supabase
      .from("forms")
      .select("id")
      .eq("slug", candidate)
      .maybeSingle();
    if (!data) return candidate;
    n += 1;
    candidate = `${base}-${n}`;
  }
}

// ────────────────────────────────────────────────────────────
// Hub Forms (/forms) — every form, with its response count
// ────────────────────────────────────────────────────────────

/**
 * Every form, most recently changed first. kind and access_mode come from
 * migration 390; event forms carry their event so the list can link to
 * the event builder.
 */
export async function listAllForms(supabase: Client) {
  return supabase
    .from("forms")
    .select(
      "id, slug, name, is_active, event_id, kind, access_mode, updated_at, events(id, title), form_submissions(count)"
    )
    .order("updated_at", { ascending: false });
}
