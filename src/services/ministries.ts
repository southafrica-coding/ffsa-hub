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
      `id, member_role, is_point_leader, status, created_at,
       user:users!user_id(${MEMBER_USER_FIELDS})`
    )
    .eq("staff_ministry_id", ministryId)
    .order("member_role", { ascending: true }) // 'leader' < 'member' alphabetically
    .order("created_at", { ascending: true });
}

/** Active users to offer in the "add staff / add leader" pickers. */
export async function listPickableUsers(supabase: Client) {
  return supabase
    .from("users")
    .select("id, first_name, last_name, display_name, preferred_name, email")
    .eq("status", "active")
    .order("first_name", { ascending: true });
}
