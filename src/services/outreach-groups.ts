// Outreach groups and their managers (migration 273). Every read here goes
// through RLS, so callers only get the groups, links and managers the
// signed-in person may see.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

// ────────────────────────────────────────────────────────────
// GROUPS
// ────────────────────────────────────────────────────────────

export async function getOutreachGroups(supabase: Client) {
  return supabase
    .from("outreach_groups")
    .select("id, name, category, description, created_at")
    .order("name");
}

export async function createOutreachGroup(
  supabase: Client,
  data: { name: string; category: string | null; description: string | null; created_by: string }
) {
  return supabase.from("outreach_groups").insert(data).select().single();
}

export async function updateOutreachGroup(
  supabase: Client,
  groupId: string,
  data: { name?: string; category?: string | null; description?: string | null }
) {
  return supabase
    .from("outreach_groups")
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq("id", groupId)
    .select()
    .single();
}

export async function deleteOutreachGroup(supabase: Client, groupId: string) {
  return supabase.from("outreach_groups").delete().eq("id", groupId).select("id");
}

// ────────────────────────────────────────────────────────────
// TEAMS IN GROUPS
// ────────────────────────────────────────────────────────────

export async function getOutreachGroupTeamLinks(supabase: Client) {
  return supabase.from("outreach_group_teams").select("group_id, team_id");
}

export async function addTeamToOutreachGroup(
  supabase: Client,
  data: { group_id: string; team_id: string; added_by: string }
) {
  return supabase.from("outreach_group_teams").insert(data).select().single();
}

export async function removeTeamFromOutreachGroup(supabase: Client, groupId: string, teamId: string) {
  return supabase
    .from("outreach_group_teams")
    .delete()
    .eq("group_id", groupId)
    .eq("team_id", teamId)
    .select("team_id");
}

/** Every team's name, place and dates (no money) for the group team picker. */
export async function getOutreachGroupTeamDirectory(supabase: Client) {
  return supabase.rpc("outreach_group_team_directory");
}

// ────────────────────────────────────────────────────────────
// MANAGERS
// ────────────────────────────────────────────────────────────

export async function getOutreachGroupManagers(supabase: Client) {
  return supabase.from("outreach_group_managers").select("group_id, user_id");
}

export async function getMyManagedOutreachGroupIds(supabase: Client, userId: string) {
  return supabase.from("outreach_group_managers").select("group_id").eq("user_id", userId);
}

export async function addOutreachGroupManager(
  supabase: Client,
  data: { group_id: string; user_id: string; added_by: string }
) {
  return supabase.from("outreach_group_managers").insert(data).select().single();
}

export async function removeOutreachGroupManager(supabase: Client, groupId: string, userId: string) {
  return supabase
    .from("outreach_group_managers")
    .delete()
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .select("user_id");
}

// ────────────────────────────────────────────────────────────
// ACCESS CHECKS (the database's own answer)
// ────────────────────────────────────────────────────────────

export async function canManageOutreachGroupRpc(supabase: Client, groupId: string) {
  return supabase.rpc("can_manage_outreach_group", { p_group: groupId });
}

export async function isOutreachStaffViewerRpc(supabase: Client) {
  return supabase.rpc("is_outreach_staff_viewer");
}

export async function isOutreachStaffEditorRpc(supabase: Client) {
  return supabase.rpc("is_outreach_staff_editor");
}
