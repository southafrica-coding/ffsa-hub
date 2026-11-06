// Data access for evangelism testimonies.
//
// Tables are drafted in migration 293 (PR #508), not applied. Until that
// file is applied, queries fail and the routes answer 503.
// This module does not add or renumber a migration.
//
// Visibility matches that SQL: viewers read published rows only. Authors
// read and write their own draft and submitted rows, and delete drafts.
// Withheld rows are visible to publishers only.
// evangelism_removals is optional (not in migration 293). recordRemoval and
// listRemovalsSince still target it. Callers use the service role and treat
// a missing table as an empty log. UNIQUE(testimony_id) is upserted, not inserted twice.
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
    // Published stories, plus the caller's drafts and submissions.
    // Withheld rows stay out: migration 293 hides them from the author.
    query = query.or(
      `status.eq.published,and(author_user_id.eq.${visibility.authorId},status.in.(draft,submitted))`
    );
  } else if (visibility.kind === "own") {
    query = query.eq("author_user_id", visibility.authorId);
    if (visibility.status) query = query.eq("status", visibility.status);
    else query = query.in("status", ["draft", "submitted"]);
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

export async function listPublishedByIds(supabase: Client, ids: string[]) {
  if (ids.length === 0) return { data: [], error: null };
  return supabase.from("evangelism_testimonies").select(STORY).eq("status", "published").in("id", ids);
}

/**
 * Tombstones newer than `since`. One id per testimony even if the table
 * returns the same id twice. Call with the service role: viewers are not
 * granted SELECT on evangelism_removals.
 */
export async function listRemovalsSince(supabase: Client, since: string) {
  const result = await supabase
    .from("evangelism_removals")
    .select("testimony_id")
    .gt("removed_at", since)
    .limit(200);
  if (result.error || !Array.isArray(result.data)) return result;
  const seen = new Set<string>();
  const data = [];
  for (const row of result.data as Array<{ testimony_id: string }>) {
    if (!row?.testimony_id || seen.has(row.testimony_id)) continue;
    seen.add(row.testimony_id);
    data.push(row);
  }
  return { ...result, data };
}

/**
 * One tombstone per testimony. A second withhold, delete, or retry updates
 * reason and removed_at instead of failing UNIQUE(testimony_id).
 * If that unique is not created yet, fall back to insert, and on a unique
 * violation update the existing row.
 */
export async function recordRemoval(
  supabase: Client,
  row: { testimony_id: string; reason: "withheld" | "deleted" }
) {
  const payload = {
    testimony_id: row.testimony_id,
    reason: row.reason,
    removed_at: new Date().toISOString(),
  };
  const upserted = await supabase
    .from("evangelism_removals")
    .upsert(payload, { onConflict: "testimony_id" })
    .select("testimony_id")
    .maybeSingle();
  if (!upserted.error) return upserted;
  if (upserted.error.code === "42P10") {
    const inserted = await supabase.from("evangelism_removals").insert(payload).select("testimony_id").maybeSingle();
    if (!inserted.error || inserted.error.code !== "23505") return inserted;
    return updateRemoval(supabase, payload);
  }
  if (upserted.error.code === "23505") return updateRemoval(supabase, payload);
  return upserted;
}

async function updateRemoval(
  supabase: Client,
  payload: { testimony_id: string; reason: "withheld" | "deleted"; removed_at: string }
) {
  return supabase
    .from("evangelism_removals")
    .update({ reason: payload.reason, removed_at: payload.removed_at })
    .eq("testimony_id", payload.testimony_id)
    .select("testimony_id")
    .maybeSingle();
}

export async function listWithheldSince(supabase: Client, since: string) {
  return supabase
    .from("evangelism_testimonies")
    .select("id")
    .eq("status", "withheld")
    .not("published_at", "is", null)
    .gt("updated_at", since);
}

export async function authorNames(supabase: Client, ids: string[]) {
  if (ids.length === 0) return { data: [], error: null };
  return supabase
    .from("users")
    .select("id, first_name, last_name, preferred_name")
    .in("id", ids);
}
