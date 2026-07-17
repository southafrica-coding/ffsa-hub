// Authorization helpers for the Ministry tab.
//
// Model:
//   - super_admin / admin can manage every ministry and appoint leaders.
//   - A Ministry Leader (an active `leader` membership row) can manage only
//     the ministries they lead — mirrors the SQL leads_staff_ministry()
//     helper (migration 126) so the API and RLS agree.

type Client = {
  from: (t: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export async function callerIsAdmin(
  supabase: Client,
  userId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("user_roles")
    .select("roles!inner(name)")
    .eq("user_id", userId)
    .in("roles.name", ["super_admin", "admin"])
    .limit(1);
  return ((data as unknown[] | null)?.length ?? 0) > 0;
}

/** Admin, or an active leader of this specific ministry. */
export async function callerLeadsMinistry(
  supabase: Client,
  userId: string,
  ministryId: string
): Promise<boolean> {
  if (await callerIsAdmin(supabase, userId)) return true;
  const { data } = await supabase
    .from("staff_ministry_members")
    .select("id")
    .eq("user_id", userId)
    .eq("staff_ministry_id", ministryId)
    .eq("member_role", "leader")
    .eq("status", "active")
    .limit(1);
  return ((data as unknown[] | null)?.length ?? 0) > 0;
}

/** Ministry ids the user actively leads (used for nav/point-leader gating). */
export async function getLedMinistryIds(
  supabase: Client,
  userId: string
): Promise<string[]> {
  const { data } = await supabase
    .from("staff_ministry_members")
    .select("staff_ministry_id")
    .eq("user_id", userId)
    .eq("member_role", "leader")
    .eq("status", "active");
  return ((data ?? []) as { staff_ministry_id: string }[]).map((r) => r.staff_ministry_id);
}
