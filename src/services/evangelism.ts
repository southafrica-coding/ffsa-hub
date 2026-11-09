// Evangelism testimonies — data access (slice 1: submit, review, list).
//
// Every read and write here takes the CALLER's client, so migration 307's
// RLS decides what they can see and change. The service-role client is only
// used for Storage (signing photo uploads/reads, removing objects) and for
// author display names, which plain users cannot read from public.users.
//
// Tables are not in the generated database.ts yet, so this uses the
// project's `Client = any` pattern with hand-written row types.

import type { EvangelismAccess } from "@/lib/auth/check-evangelism-access";
import type { Outcome, PhotoInput, TestimonyFields } from "@/lib/evangelism/validation";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export const EVANGELISM_BUCKET = "evangelism-media";
/** Signed photo reads live this long (seconds). */
export const SIGNED_READ_SECONDS = 60 * 30;

export type TestimonyStatus = "draft" | "submitted" | "published" | "withheld";

export type TestimonyMediaRow = {
  id: string;
  storage_path: string;
  content_type: string;
  size_bytes: number;
  sort_order: number;
};

export type TestimonyRow = {
  id: string;
  author_user_id: string;
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
  published_by: string | null;
  withheld_reason: string | null;
  created_at: string;
  updated_at: string;
  staff_ministries?: { name: string } | null;
  evangelism_media?: TestimonyMediaRow[] | null;
};

/** What the API returns. Author/review fields only for publishers and the author. */
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
};

const COLUMNS =
  "id, author_user_id, title, body, occurred_on, location_label, staff_ministry_id, people_reached, decisions, outcome, consent_to_share, status, published_at, published_by, withheld_reason, created_at, updated_at, staff_ministries(name), evangelism_media(id, storage_path, content_type, size_bytes, sort_order)";

// ── Missing schema → 503 ──────────────────────────────────

const MISSING_CODES = new Set(["42P01", "PGRST205", "PGRST200"]);

/** True when migration 307 has not been applied (table or bucket missing). */
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
  opts: { status?: TestimonyStatus; authorId?: string; limit?: number }
): Promise<{ data: TestimonyRow[]; error: unknown }> {
  let q = supabase.from("evangelism_testimonies").select(COLUMNS);
  if (opts.status) q = q.eq("status", opts.status);
  if (opts.authorId) q = q.eq("author_user_id", opts.authorId);
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

export async function createTestimony(
  supabase: Client,
  authorId: string,
  fields: TestimonyFields,
  status: "draft" | "submitted"
): Promise<{ data: TestimonyRow | null; error: unknown }> {
  const { data, error } = await supabase
    .from("evangelism_testimonies")
    .insert({ ...fields, author_user_id: authorId, status })
    .select(COLUMNS)
    .single();
  return { data: (data ?? null) as TestimonyRow | null, error };
}

export async function updateTestimony(
  supabase: Client,
  id: string,
  fields: TestimonyFields,
  status: "draft" | "submitted"
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
// The guard trigger stamps published_at / published_by from auth.uid();
// nothing here sends them.

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

export async function attachPhoto(supabase: Client, testimonyId: string, userId: string, photo: PhotoInput) {
  return supabase.from("evangelism_media").insert({
    testimony_id: testimonyId,
    kind: "photo",
    storage_path: photo.path,
    content_type: photo.content_type,
    size_bytes: photo.size,
    created_by: userId,
  });
}

export async function deletePhotoRows(supabase: Client, ids: string[]) {
  if (ids.length === 0) return { error: null };
  return supabase.from("evangelism_media").delete().in("id", ids);
}

/** Remove objects from the private bucket (service role). Best effort. */
export async function removePhotoObjects(admin: Client, paths: string[]) {
  if (paths.length === 0) return;
  await admin.storage.from(EVANGELISM_BUCKET).remove(paths);
}

/** Short-lived signed read URLs, keyed by storage path. */
export async function signPhotoUrls(admin: Client, rows: TestimonyRow[]): Promise<Map<string, string>> {
  const paths = rows.flatMap((r) => (r.evangelism_media ?? []).map((m) => m.storage_path));
  const out = new Map<string, string>();
  if (paths.length === 0) return out;
  const { data } = await admin.storage.from(EVANGELISM_BUCKET).createSignedUrls(paths, SIGNED_READ_SECONDS);
  for (const item of (data ?? []) as Array<{ path: string | null; signedUrl: string | null }>) {
    if (item.path && item.signedUrl) out.set(item.path, item.signedUrl);
  }
  return out;
}

/** Display names for authors — only fetched for rows the caller may attribute. */
export async function loadAuthorNames(admin: Client, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return out;
  const { data } = await admin
    .from("users")
    .select("id, display_name, first_name, last_name, email")
    .in("id", unique);
  for (const u of (data ?? []) as Array<{
    id: string;
    display_name: string | null;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
  }>) {
    const full = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
    out.set(u.id, u.display_name?.trim() || full || u.email || "Staff member");
  }
  return out;
}

// ── Presentation (privacy) ────────────────────────────────

/** Whether the caller may see who wrote it and the review fields. */
export function canSeeAttribution(row: Pick<TestimonyRow, "author_user_id">, viewer: { userId: string; access: EvangelismAccess }) {
  return viewer.access.publish || row.author_user_id === viewer.userId;
}

export function presentTestimony(
  row: TestimonyRow,
  viewer: { userId: string; access: EvangelismAccess },
  extras: { signed?: Map<string, string>; names?: Map<string, string> } = {}
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
    is_mine: row.author_user_id === viewer.userId,
    photo: media
      ? { id: media.id, url: extras.signed?.get(media.storage_path) ?? null, content_type: media.content_type }
      : null,
  };
  if (canSeeAttribution(row, viewer)) {
    out.author_name = extras.names?.get(row.author_user_id) ?? null;
    out.published_by = row.published_by;
    out.withheld_reason = row.withheld_reason;
  }
  return out;
}
