// Data access for the Ministry tab — staff ministries and their rosters.
//
// These are the staff_ministries / staff_ministry_members tables (NOT the
// bookings-owned public.ministries lookup — see the memory note). The roster
// query deliberately does NOT embed user_roles(*, roles(*)) (the pattern
// getUsers uses): under the users-table RLS, embedded role rows come back
// empty for non-admin readers, so a Ministry Leader would see blank members.
// We select plain user fields via staff_ministry_members instead.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const MEMBER_USER_FIELDS =
  "id, first_name, last_name, display_name, preferred_name, email, job_title, avatar_url, status";

/** All staff ministries with a member-count, for the list page. */
export async function listMinistries(supabase: Client) {
  return supabase
    .from("staff_ministries")
    .select("id, name, slug, description, is_active, sort_order, staff_ministry_members(count)")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
}

export async function getMinistry(supabase: Client, id: string) {
  return supabase
    .from("staff_ministries")
    .select("id, name, slug, description, is_active, sort_order")
    .eq("id", id)
    .single();
}

/**
 * A ministry's roster: leaders first, then members. Joins users directly so
 * names/emails render for any authorized reader (no user_roles embed).
 */
export async function getMinistryRoster(supabase: Client, ministryId: string) {
  return supabase
    .from("staff_ministry_members")
    .select(
      `id, member_role, is_point_leader, status, subcategory_id, created_at,
       user:users!user_id(${MEMBER_USER_FIELDS})`
    )
    .eq("staff_ministry_id", ministryId)
    .order("member_role", { ascending: true }) // 'leader' < 'member' alphabetically
    .order("created_at", { ascending: true });
}

// ────────────────────────────────────────────────────────────
// Sub-categories — named sub-groups within a single ministry.
// The list is admin-managed (RLS: is_admin()); members are assigned to a
// sub-category via the staff_ministry_members.subcategory_id column.
// ────────────────────────────────────────────────────────────

/** A ministry's sub-categories, ordered for display. */
export async function listSubcategories(supabase: Client, ministryId: string) {
  return supabase
    .from("staff_ministry_subcategories")
    .select("id, staff_ministry_id, name, sort_order")
    .eq("staff_ministry_id", ministryId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
}

export async function createSubcategory(
  supabase: Client,
  input: { staff_ministry_id: string; name: string; sort_order?: number }
) {
  return supabase
    .from("staff_ministry_subcategories")
    .insert({
      staff_ministry_id: input.staff_ministry_id,
      name: input.name,
      sort_order: input.sort_order ?? 0,
    })
    .select("id, staff_ministry_id, name, sort_order")
    .single();
}

export async function updateSubcategory(
  supabase: Client,
  subId: string,
  patch: { name?: string; sort_order?: number }
) {
  return supabase
    .from("staff_ministry_subcategories")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", subId)
    .select("id, staff_ministry_id, name, sort_order")
    .single();
}

export async function deleteSubcategory(supabase: Client, subId: string) {
  return supabase.from("staff_ministry_subcategories").delete().eq("id", subId);
}

/**
 * Candidate users for the "add staff / add leader" pickers. Returns the full
 * user row (all profile columns) so the caller can keep only those whose
 * profile is fully set up (deriveUserLifecycle → no missing required fields).
 * `users.status` is not used for this — it's unreliable (see auth-signins.ts).
 */
export async function listPickableUsers(supabase: Client) {
  return supabase
    .from("users")
    .select("*")
    .order("first_name", { ascending: true });
}
