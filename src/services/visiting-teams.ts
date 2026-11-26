// Operations → Visiting teams: data access (migration 402).
// docs/operations-outreach-teams.md. RLS decides who sees what: the
// Visiting teams lead sees every team, a host sees their own.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const TEAM_SELECT =
  "*, host:users!visiting_teams_host_user_id_fkey(display_name)";

// ── Who ─────────────────────────────────────────────────────

/** Mirrors public.is_visiting_teams_lead() — admins and holders of the lead permission. */
export async function isVisitingTeamsLead(supabase: Client): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_visiting_teams_lead");
  return !error && data === true;
}

// ── Teams ───────────────────────────────────────────────────

export async function listTeams(supabase: Client) {
  return supabase
    .from("visiting_teams")
    .select(TEAM_SELECT)
    .order("arrival_on", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
}

export async function getTeam(supabase: Client, id: string) {
  return supabase.from("visiting_teams").select(TEAM_SELECT).eq("id", id).maybeSingle();
}

export async function createTeam(supabase: Client, row: Record<string, unknown>) {
  return supabase.from("visiting_teams").insert(row).select("id, stage, arrival_on, departure_on").single();
}

export async function updateTeam(supabase: Client, id: string, patch: Record<string, unknown>) {
  return supabase.from("visiting_teams").update(patch).eq("id", id).select("id, stage, arrival_on, departure_on").single();
}

export async function deleteTeam(supabase: Client, id: string) {
  return supabase.from("visiting_teams").delete().eq("id", id);
}

// ── Private details ─────────────────────────────────────────

export async function getPrivate(supabase: Client, teamId: string) {
  return supabase.from("visiting_team_private").select("members, dietary, medical, updated_at").eq("team_id", teamId).maybeSingle();
}

export async function savePrivate(supabase: Client, teamId: string, patch: Record<string, string | null>) {
  return supabase.from("visiting_team_private").upsert({ team_id: teamId, ...patch }, { onConflict: "team_id" });
}

// ── Checklist ───────────────────────────────────────────────

export async function listSteps(supabase: Client, teamId: string) {
  return supabase
    .from("visiting_team_steps")
    .select("id, step_key, stage, label, sort, due_on, done_at, note, done_by_user:users!visiting_team_steps_done_by_fkey(display_name)")
    .eq("team_id", teamId)
    .order("sort");
}

/** Open steps across every team the caller can see (for the list page). */
export async function listOpenSteps(supabase: Client) {
  return supabase
    .from("visiting_team_steps")
    .select("id, team_id, step_key, stage, label, sort, due_on, done_at, note")
    .is("done_at", null);
}

export async function insertSteps(supabase: Client, teamId: string, rows: Record<string, unknown>[]) {
  return supabase.from("visiting_team_steps").insert(rows.map((r) => ({ ...r, team_id: teamId })));
}

export async function updateStep(supabase: Client, teamId: string, stepId: string, patch: Record<string, unknown>) {
  return supabase.from("visiting_team_steps").update(patch).eq("id", stepId).eq("team_id", teamId).select("id").single();
}

/** Re-date one step (after arrival or departure moved). */
export async function setStepDue(supabase: Client, teamId: string, stepKey: string, dueOn: string | null) {
  return supabase.from("visiting_team_steps").update({ due_on: dueOn }).eq("team_id", teamId).eq("step_key", stepKey);
}

// ── History ─────────────────────────────────────────────────

export async function listChanges(supabase: Client, teamId: string, limit = 200) {
  return supabase
    .from("visiting_team_changes")
    .select("id, field, old_value, new_value, changed_at, by:users!visiting_team_changes_changed_by_fkey(display_name)")
    .eq("team_id", teamId)
    .order("changed_at", { ascending: false })
    .limit(limit);
}
