// Data access for evangelism testimonies.
//
// Tables are NOT in the database yet. Hub Data applies them (see the draft
// PR). Until then every call fails with a missing-schema error and the
// routes answer 503 evangelism_not_enabled.
//
// Proposed tables (do not apply from this file):
//   evangelism_testimonies, evangelism_media
// Proposed private bucket: evangelism-media
//
// This module only builds queries. Permission checks live in the routes.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const STORY =
  "id, author_user_id, title, body, occurred_on, location_label, people_reached, decisions, outcome, consent_to_share, status, published_at, published_by, withheld_reason, created_at, updated_at, evangelism_media(id, kind, storage_path, content_type, size_bytes, sort_order)";

export const STATS_ROW_CAP = 5000;

export async function listTestimonies(
  supabase: Client,
  options: {
    limit: number;
    /** all: publisher. published: dashboard readers. own: the caller's rows. published_or_own: submitter list. */
    visibility:
      | { kind: "all"; status?: string; authorId?: string }
      | { kind: "published" }
      | { kind: "own"; authorId: string; status?: string }
      | { kind: "published_or_own"; authorId: string };
  }
) {
  let query = supabase
    .from("evangelism_testimonies")
    .select(STORY)
    .order("updated_at", { ascending: false })
    .limit(options.limit);

  const visibility = options.visibility;
  if (visibility.kind === "published") {
    query = query.eq("status", "published");
  } else if (visibility.kind === "published_or_own") {
    query = query.or(`status.eq.published,author_user_id.eq.${visibility.authorId}`);
  } else if (visibility.kind === "own") {
    query = query.eq("author_user_id", visibility.authorId);
    if (visibility.status) query = query.eq("status", visibility.status);
  } else {
    if (visibility.status) query = query.eq("status", visibility.status);
    if (visibility.authorId) query = query.eq("author_user_id", visibility.authorId);
  }
  return query;
}

export async function getTestimony(supabase: Client, id: string) {
  return supabase.from("evangelism_testimonies").select(STORY).eq("id", id).maybeSingle();
}

export async function insertTestimony(
  supabase: Client,
  row: {
    author_user_id: string;
    title: string;
    body: string;
    occurred_on: string;
    location_label: string;
    people_reached: number;
    decisions: number;
    outcome: string;
    consent_to_share: boolean;
    status: string;
    published_at?: string | null;
    published_by?: string | null;
    withheld_reason?: string | null;
  }
) {
  return supabase.from("evangelism_testimonies").insert(row).select(STORY).single();
}

export async function updateTestimony(supabase: Client, id: string, patch: Record<string, unknown>) {
  return supabase.from("evangelism_testimonies").update(patch).eq("id", id).select(STORY).single();
}

export async function deleteTestimony(supabase: Client, id: string) {
  return supabase.from("evangelism_testimonies").delete().eq("id", id);
}

export async function insertTestimonyMedia(
  supabase: Client,
  rows: Array<{
    testimony_id: string;
    kind: string;
    storage_path: string;
    content_type: string;
    size_bytes: number;
    sort_order: number;
    created_by: string;
  }>
) {
  return supabase.from("evangelism_media").insert(rows).select("id");
}

export async function listPublishedFeed(
  supabase: Client,
  options: { since: string | null; limit: number }
) {
  // First paint (no cursor) is the newest page. A cursor asks for what was
  // published after it, oldest first, so the screen can append.
  let query = supabase
    .from("evangelism_testimonies")
    .select(STORY)
    .eq("status", "published")
    .order("published_at", { ascending: Boolean(options.since) })
    .limit(options.limit);
  if (options.since) query = query.gt("published_at", options.since);
  return query;
}

export async function listPublishedForStats(
  supabase: Client,
  window: { from: string; to: string }
) {
  return supabase
    .from("evangelism_testimonies")
    .select("occurred_on, location_label, people_reached, decisions, outcome, published_at")
    .eq("status", "published")
    .gte("occurred_on", window.from)
    .lte("occurred_on", window.to)
    .order("occurred_on", { ascending: true })
    .limit(STATS_ROW_CAP);
}

export async function authorNames(supabase: Client, ids: string[]) {
  if (ids.length === 0) return { data: [], error: null };
  return supabase
    .from("users")
    .select("id, first_name, last_name, preferred_name")
    .in("id", ids);
}
