// ────────────────────────────────────────────────────────────
// STAFF CV / PERSONAL CARD — data access (migration 218)
// ────────────────────────────────────────────────────────────
// public.staff_cv_entries (repeatable entries) + users.essence_statement
// (singleton). RLS on staff_cv_entries only covers self + admin, so any
// cross-user read/write here is expected to arrive on a service-role
// client — callers authorize with src/lib/auth/check-cv-access.ts first.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

import type { CvEntryCategory } from "@/lib/users/cv-entry-types";
import type { CvEntryScope } from "@/lib/auth/check-cv-access";

const CARD_USER_FIELDS =
  "id, first_name, last_name, display_name, preferred_name, email, avatar_url, essence_statement";

export async function getCardOwner(supabase: Client, userId: string) {
  return supabase.from("users").select(CARD_USER_FIELDS).eq("id", userId).maybeSingle();
}

export async function updateEssenceStatement(
  supabase: Client,
  userId: string,
  essenceStatement: string
) {
  return supabase
    .from("users")
    .update({ essence_statement: essenceStatement || null })
    .eq("id", userId);
}

export async function listCvEntries(supabase: Client, userId: string) {
  return supabase
    .from("staff_cv_entries")
    .select("id, user_id, category, title, description, added_by_role, created_by, sort_order, created_at")
    .eq("user_id", userId)
    .order("category", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
}

export async function createCvEntry(
  supabase: Client,
  input: {
    userId: string;
    category: CvEntryCategory;
    title: string;
    description?: string | null;
    scope: CvEntryScope;
    createdBy: string;
  }
) {
  return supabase
    .from("staff_cv_entries")
    .insert({
      user_id: input.userId,
      category: input.category,
      title: input.title,
      description: input.description || null,
      added_by_role: input.scope,
      created_by: input.createdBy,
    })
    .select()
    .single();
}

export async function getCvEntry(supabase: Client, entryId: string) {
  return supabase
    .from("staff_cv_entries")
    .select("id, user_id, category, title, description, added_by_role, created_by")
    .eq("id", entryId)
    .maybeSingle();
}

export async function updateCvEntry(
  supabase: Client,
  entryId: string,
  input: { title?: string; description?: string | null }
) {
  const updateData: Record<string, unknown> = {};
  if (input.title !== undefined) updateData.title = input.title;
  if (input.description !== undefined) updateData.description = input.description || null;
  return supabase.from("staff_cv_entries").update(updateData).eq("id", entryId).select().single();
}

export async function deleteCvEntry(supabase: Client, entryId: string) {
  return supabase.from("staff_cv_entries").delete().eq("id", entryId);
}

/**
 * Staff list for the Ministry-tab search box, scoped by the caller's
 * visibility: pass `ministryIds` to restrict to those ministries' active
 * members (ministry_leader), or omit for every active staff member
 * (admin / leadership_team).
 */
export async function listStaffForSearch(
  supabase: Client,
  options: { ministryIds?: string[] } = {}
) {
  if (options.ministryIds) {
    if (options.ministryIds.length === 0) return { data: [], error: null };
    const { data, error } = await supabase
      .from("staff_ministry_members")
      .select(`user:users!user_id(${CARD_USER_FIELDS})`)
      .eq("status", "active")
      .in("staff_ministry_id", options.ministryIds);
    if (error) return { data: null, error };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const seen = new Map<string, any>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const row of (data ?? []) as any[]) {
      if (row.user?.id) seen.set(row.user.id, row.user);
    }
    return { data: [...seen.values()], error: null };
  }

  return supabase.from("users").select(CARD_USER_FIELDS).order("first_name", { ascending: true });
}
