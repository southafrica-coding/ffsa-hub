// Per-person outreach restrictions (migration 274). When a person's
// "limited to own teams" flag is on, their finance.view / finance.edit grants
// stop opening every outreach team; they keep the teams they are on and the
// groups they manage. Admins read and set anyone's flag; a person may read
// their own.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

// ────────────────────────────────────────────────────────────
// RESTRICTIONS
// ────────────────────────────────────────────────────────────

export async function getOutreachRestriction(supabase: Client, userId: string) {
  return supabase
    .from("outreach_user_restrictions")
    .select("user_id, limited_to_own_teams, set_by, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
}

/** Whether any of these roles bundles one of these permission keys (≤1 row). */
export async function getRolePermissionsWithKeys(supabase: Client, roleIds: string[], keys: string[]) {
  return supabase
    .from("role_permissions")
    .select("permissions!inner(key)")
    .in("role_id", roleIds)
    .in("permissions.key", keys)
    .limit(1);
}

export async function setOutreachRestriction(
  supabase: Client,
  data: { user_id: string; limited_to_own_teams: boolean; set_by: string }
) {
  return supabase
    .from("outreach_user_restrictions")
    .upsert({ ...data, updated_at: new Date().toISOString() }, { onConflict: "user_id" })
    .select("user_id, limited_to_own_teams")
    .single();
}
