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
    .select(
      "id, name, slug, description, is_active, sort_order, ministry_type, staff_ministry_members(count)"
    )
    .order("name", { ascending: true });
}

/**
 * Active MAIN staff ministries (slug + name), for the Department picker on
 * the profile, the completion gate and the admin user page.
 *
 * The Ministry tab is the single source of truth for departments; callers map
 * rows to { value: slug, label: name }. Part-time ministries are deliberately
 * excluded — a department is the main ministry someone serves in, and people
 * join part-time ministries through the roster instead. Retired ministries are
 * excluded for the same reason they always were.
 *
 * RLS is `auth.uid() IS NOT NULL`, so the normal server client suffices.
 */
export async function listActiveMinistries(supabase: Client) {
  return supabase
    .from("staff_ministries")
    .select("name, slug")
    .eq("is_active", true)
    .eq("ministry_type", "main")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
}

/**
 * The matching ministry row (or null) for a slug — active or retired. Used to
 * validate a department value on profile writes now that the static DB CHECK
 * is gone.
 */
export async function getMinistryBySlug(supabase: Client, slug: string) {
  return supabase
    .from("staff_ministries")
    .select("slug")
    .eq("slug", slug)
    .maybeSingle();
}

export async function getMinistry(supabase: Client, id: string) {
  return supabase
    .from("staff_ministries")
    .select("id, name, slug, description, is_active, sort_order, ministry_type")
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
      `id, member_role, is_point_leader, is_category_point_leader, status, subcategory_id, created_at,
       user:users!user_id(${MEMBER_USER_FIELDS})`
    )
    .eq("staff_ministry_id", ministryId)
    .order("member_role", { ascending: true }) // 'leader' < 'member' alphabetically
    .order("created_at", { ascending: true });
}

/**
 * All active ministry memberships across every ministry, as a flat list of
 * (user_id, role flags). Used to derive each person's ministry-based job title
 * on the Users list. Admin/service-role client recommended — the caller is a
 * cross-user admin report, and the users-table RLS would otherwise hide rows
 * for non-admin readers. Only `status = 'active'` rows are returned.
 */
export async function listActiveMinistryMemberships(supabase: Client) {
  return supabase
    .from("staff_ministry_members")
    .select("user_id, member_role, is_point_leader, is_category_point_leader, status")
    .eq("status", "active");
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
