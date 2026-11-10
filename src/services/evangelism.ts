// Evangelism testimonies — data access (slice 1: submit, review, list).
//
// Every read and write here takes the CALLER's client, so migration 307's
// RLS decides what they can see and change. Who wrote a story is hidden in
// the database itself: author_user_id / published_by / withheld_reason are
// not column-readable by `authenticated`, so names and review fields come
// from the evangelism_attribution() RPC, again on the caller's client.
//
// The service-role client is only used for Storage: minting/recording
// upload paths, signing photo reads (paths are not readable by users), and
// removing objects.
//
// Tables are not in the generated database.ts yet, so this uses the
// project's `Client = any` pattern with hand-written row types.

import type { Outcome, PhotoInput, TestimonyFields } from "@/lib/evangelism/validation";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export const EVANGELISM_BUCKET = "evangelism-media";
/** Signed photo reads live this long (seconds). */
export const SIGNED_READ_SECONDS = 60 * 30;

export type TestimonyStatus = "draft" | "submitted" | "published" | "withheld";

/** What `authenticated` can read of a photo — no path, no uploader. */
export type TestimonyMediaRow = {
  id: string;
  content_type: string;
  size_bytes: number;
  sort_order: number;
};

/** The column-granted shape of a story (no author or review fields). */
export type TestimonyRow = {
  id: string;
  title: string;
  body: string;
  occurred_on: string;
  location_label: string;
  staff_ministry_id: string | null;
  people_reached: number;
  decisions: number;
  outcome: Outcome;
  consent_to_share: boolean;
  status: TestimonyStatus;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  staff_ministries?: { name: string } | null;
  evangelism_media?: TestimonyMediaRow[] | null;
};

/**
 * One row of evangelism_attribution(). Name/review fields are null unless
 * allowed. `withheld_by_other` is not on main's RPC (307). Migration 311
 * (#537 at cdb354e6) adds it as the last column: true only when
 * the story is withheld by someone other than the viewer and the viewer
 * is not a moderator. The raw withheld_by uuid is never selected.
 */
export type Attribution = {
  id: string;
  is_mine: boolean;
  author_name: string | null;
  published_by: string | null;
  withheld_reason: string | null;
  withheld_by_other?: boolean;
};

/** What the API returns. Author/review fields only appear when the DB released them. */
export type PresentedTestimony = {
  id: string;
  title: string;
  body: string;
  occurred_on: string;
  location_label: string;
  staff_ministry_id: string | null;
  ministry_name: string | null;
  people_reached: number;
  decisions: number;
  outcome: Outcome;
  consent_to_share: boolean;
  status: TestimonyStatus;
  published_at: string | null;
  updated_at: string;
  is_mine: boolean;
  photo: { id: string; url: string | null; content_type: string } | null;
  author_name?: string | null;
  published_by?: string | null;
  withheld_reason?: string | null;
  /** From attribution, only when the RPC returns it. Never the raw uuid. */
  withheld_by_other?: boolean;
};

const COLUMNS =
  "id, title, body, occurred_on, location_label, staff_ministry_id, people_reached, decisions, outcome, consent_to_share, status, published_at, created_at, updated_at, staff_ministries(name), evangelism_media(id, content_type, size_bytes, sort_order)";

// ── Missing schema → 503 ──────────────────────────────────

const MISSING_CODES = new Set(["42P01", "42883", "PGRST205", "PGRST200", "PGRST202"]);

/** True when migration 307 has not been applied (table, RPC or bucket missing). */
export function isEvangelismNotReady(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (typeof code === "string" && MISSING_CODES.has(code)) return true;
  const text = typeof message === "string" ? message : "";
  return /bucket not found/i.test(text) || (/evangelism_/.test(text) && /does not exist|schema cache/i.test(text));
}

// ── Reads ─────────────────────────────────────────────────

export async function listTestimonies(
  supabase: Client,
  opts: { status?: TestimonyStatus; mine?: boolean; limit?: number }
): Promise<{ data: TestimonyRow[]; error: unknown }> {
  let q = supabase.from("evangelism_testimonies").select(COLUMNS);
  if (opts.mine) {
    // author_user_id isn't readable, so "mine" comes from a definer RPC.
    const { data: ids, error } = await supabase.rpc("evangelism_my_testimony_ids");
    if (error) return { data: [], error };
    const list = (Array.isArray(ids) ? ids : []) as string[];
    if (list.length === 0) return { data: [], error: null };
    q = q.in("id", list);
  }
  if (opts.status) q = q.eq("status", opts.status);
  q =
    opts.status === "published"
      ? q.order("published_at", { ascending: false })
      : q.order("updated_at", { ascending: false });
  const { data, error } = await q.limit(Math.min(Math.max(opts.limit ?? 50, 1), 200));
  return { data: (data ?? []) as TestimonyRow[], error };
}

export async function getTestimony(
  supabase: Client,
  id: string
): Promise<{ data: TestimonyRow | null; error: unknown }> {
  const { data, error } = await supabase.from("evangelism_testimonies").select(COLUMNS).eq("id", id).maybeSingle();
  return { data: (data ?? null) as TestimonyRow | null, error };
}

/** Attribution for rows the caller can already see, keyed by story id. */
export async function getAttribution(
  supabase: Client,
  ids: string[]
): Promise<{ data: Map<string, Attribution>; error: unknown }> {
  const out = new Map<string, Attribution>();
  if (ids.length === 0) return { data: out, error: null };
  const { data, error } = await supabase.rpc("evangelism_attribution", { p_ids: ids });
  for (const a of (Array.isArray(data) ? data : []) as Array<Attribution | null>) {
    if (!a || typeof a !== "object" || typeof a.id !== "string") continue;
    out.set(a.id, a);
  }
  return { data: out, error };
}

/** Active ministries for the optional tag on the submit form. */
export async function listActiveMinistries(supabase: Client): Promise<Array<{ id: string; name: string }>> {
  const { data } = await supabase
    .from("staff_ministries")
    .select("id, name")
    .eq("is_active", true)
    .order("sort_order");
  return (data ?? []) as Array<{ id: string; name: string }>;
}

// ── Author writes ─────────────────────────────────────────
// author_user_id defaults to auth.uid() in the database.

export async function createTestimony(
  supabase: Client,
  fields: TestimonyFields,
  status: "draft" | "submitted"
): Promise<{ data: TestimonyRow | null; error: unknown }> {
  const { data, error } = await supabase
    .from("evangelism_testimonies")
    .insert({ ...fields, status })
    .select(COLUMNS)
    .single();
  return { data: (data ?? null) as TestimonyRow | null, error };
}

export async function updateTestimony(
  supabase: Client,
  id: string,
  fields: TestimonyFields,
  status: "draft" | "submitted" | "published" | "withheld"
): Promise<{ data: TestimonyRow | null; error: unknown }> {
  const { data, error } = await supabase
    .from("evangelism_testimonies")
    .update({ ...fields, status })
    .eq("id", id)
    .select(COLUMNS)
    .maybeSingle();
  return { data: (data ?? null) as TestimonyRow | null, error };
}

// ── Publisher writes ──────────────────────────────────────
// The guard trigger stamps published_at / published_by from auth.uid(),
// allows publishing only from submitted/withheld, and refuses any change
// to someone else's content or consent.

export async function publishTestimony(supabase: Client, id: string) {
  const { data, error } = await supabase
    .from("evangelism_testimonies")
    .update({ status: "published" })
    .eq("id", id)
    .select(COLUMNS)
    .maybeSingle();
  return { data: (data ?? null) as TestimonyRow | null, error };
}

export async function withholdTestimony(supabase: Client, id: string, reason: string | null) {
  const { data, error } = await supabase
    .from("evangelism_testimonies")
    .update({ status: "withheld", withheld_reason: reason })
    .eq("id", id)
    .select(COLUMNS)
    .maybeSingle();
  return { data: (data ?? null) as TestimonyRow | null, error };
}

/** Returns how many rows RLS actually let the caller delete (0 or 1). */
export async function deleteTestimony(supabase: Client, id: string) {
  const { data, error } = await supabase.from("evangelism_testimonies").delete().eq("id", id).select("id");
  return { deleted: Array.isArray(data) ? data.length : 0, error };
}

// ── Photos ────────────────────────────────────────────────

/** created_by defaults to auth.uid(); RLS checks the path is in the caller's ledger. */
export async function attachPhoto(supabase: Client, testimonyId: string, photo: PhotoInput) {
  return supabase.from("evangelism_media").insert({
    testimony_id: testimonyId,
    kind: "photo",
    storage_path: photo.path,
    content_type: photo.content_type,
    size_bytes: photo.size,
  });
}

export async function deletePhotoRows(supabase: Client, ids: string[]) {
  if (ids.length === 0) return { error: null };
  return supabase.from("evangelism_media").delete().in("id", ids);
}

/** Record a freshly minted upload path against its user (service role). */
export async function recordUpload(admin: Client, path: string, userId: string) {
  return admin.from("evangelism_uploads").insert({ storage_path: path, user_id: userId });
}

/** Of these paths, the ones the ledger says this user minted (service role). */
export async function ownedUploadPaths(admin: Client, paths: string[], userId: string): Promise<string[]> {
  if (paths.length === 0) return [];
  const { data } = await admin.from("evangelism_uploads").select("storage_path, user_id").in("storage_path", paths);
  return ((data ?? []) as Array<{ storage_path: string; user_id: string }>)
    .filter((r) => r.user_id === userId)
    .map((r) => r.storage_path);
}

/** Storage paths for media ids the caller already saw through RLS (service role). */
export async function mediaPaths(admin: Client, mediaIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (mediaIds.length === 0) return out;
  const { data } = await admin.from("evangelism_media").select("id, storage_path").in("id", mediaIds);
  for (const m of (data ?? []) as Array<{ id: string; storage_path: string }>) out.set(m.id, m.storage_path);
  return out;
}

/** Remove objects from the private bucket and their ledger rows (service role). */
export async function removePhotoObjects(admin: Client, paths: string[]) {
  if (paths.length === 0) return;
  await admin.storage.from(EVANGELISM_BUCKET).remove(paths);
  await admin.from("evangelism_uploads").delete().in("storage_path", paths);
}

/**
 * Short-lived signed read URLs keyed by MEDIA ID. Only call with media ids
 * from rows the caller's own client returned, so RLS already decided they
 * may see the photo. Paths are random/random — they don't name the author.
 */
export async function signPhotoUrls(admin: Client, rows: TestimonyRow[]): Promise<Map<string, string>> {
  const ids = rows.flatMap((r) => (r.evangelism_media ?? []).map((m) => m.id));
  const out = new Map<string, string>();
  const paths = await mediaPaths(admin, ids);
  if (paths.size === 0) return out;
  const { data } = await admin.storage
    .from(EVANGELISM_BUCKET)
    .createSignedUrls([...paths.values()], SIGNED_READ_SECONDS);
  const byPath = new Map<string, string>();
  for (const item of (data ?? []) as Array<{ path: string | null; signedUrl: string | null }>) {
    if (item.path && item.signedUrl) byPath.set(item.path, item.signedUrl);
  }
  for (const [id, path] of paths) {
    const url = byPath.get(path);
    if (url) out.set(id, url);
  }
  return out;
}

// ── Presentation ──────────────────────────────────────────

/**
 * API shape. Author/review fields come only from the attribution RPC, which
 * already nulls them for callers who may not see them; nulls are dropped so
 * a viewer's response doesn't even carry the keys.
 */
export function presentTestimony(
  row: TestimonyRow,
  attribution: Attribution | undefined,
  signed: Map<string, string> = new Map(),
  opts?: { moderate?: boolean }
): PresentedTestimony {
  const media = [...(row.evangelism_media ?? [])].sort((a, b) => a.sort_order - b.sort_order)[0];
  const out: PresentedTestimony = {
    id: row.id,
    title: row.title,
    body: row.body,
    occurred_on: row.occurred_on,
    location_label: row.location_label,
    staff_ministry_id: row.staff_ministry_id,
    ministry_name: row.staff_ministries?.name ?? null,
    people_reached: row.people_reached,
    decisions: row.decisions,
    outcome: row.outcome,
    consent_to_share: row.consent_to_share,
    status: row.status,
    published_at: row.published_at,
    updated_at: row.updated_at,
    is_mine: attribution?.is_mine ?? false,
    photo: media ? { id: media.id, url: signed.get(media.id) ?? null, content_type: media.content_type } : null,
  };
  if (attribution?.author_name) out.author_name = attribution.author_name;
  if (attribution?.published_by) out.published_by = attribution.published_by;
  if (attribution?.withheld_reason) out.withheld_reason = attribution.withheld_reason;
  // Flag from the RPC, or a missing row on someone else's withheld story.
  if (attribution?.withheld_by_other === true) out.withheld_by_other = true;
  else if (!attribution && !opts?.moderate && row.status === "withheld") out.withheld_by_other = true;
  return out;
}
