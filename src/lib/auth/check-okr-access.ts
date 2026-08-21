// Authorization helpers for the OKRs module.
//
// These do NOT replace the row-level policies in migration 182 — RLS is the
// real gate, and every route writes with the caller's own client so a policy
// violation is unavoidable. These exist so a refused write comes back as a
// clean 403 with a sentence a human can read, instead of a raw PostgREST
// constraint string.
//
// Keep them in step with can_edit_okr_objective() / can_create_okr() in that
// migration: same three grants — admin, the trigger-synced leadership_team
// role, and an active leader of the ministry the objective belongs to (plus
// the owner, once individual OKRs ship).

import { callerIsAdmin, callerLeadsMinistry } from "./check-ministry-access";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

/** Membership of the Leadership Team, via the role trigger-synced in 131. */
export async function isLeadershipTeam(
  supabase: Client,
  userId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("user_roles")
    .select("roles!inner(name)")
    .eq("user_id", userId)
    .eq("roles.name", "leadership_team")
    .limit(1);
  return ((data as unknown[] | null)?.length ?? 0) > 0;
}

/** Admin, leadership team, or an active leader of that ministry. */
export async function callerCanEditMinistryOkrs(
  supabase: Client,
  userId: string,
  ministryId: string
): Promise<boolean> {
  if (await isLeadershipTeam(supabase, userId)) return true;
  // callerLeadsMinistry already folds in the admin check.
  return callerLeadsMinistry(supabase, userId, ministryId);
}

/**
 * The same question, asked about an existing objective. Reads the objective
 * with the caller's client, so an objective they cannot even see comes back
 * null and is refused — a leader must not learn that a hidden individual
 * objective exists by probing this.
 */
export async function callerCanEditObjective(
  supabase: Client,
  userId: string,
  objectiveId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("okr_objectives")
    .select("staff_ministry_id, scope, owner_user_id")
    .eq("id", objectiveId)
    .maybeSingle();
  if (!data) return false;

  const row = data as { staff_ministry_id: string; scope: string; owner_user_id: string | null };
  if (row.scope === "individual" && row.owner_user_id === userId) return true;
  return callerCanEditMinistryOkrs(supabase, userId, row.staff_ministry_id);
}

/** As above, reached through a key result. */
export async function callerCanEditKeyResult(
  supabase: Client,
  userId: string,
  keyResultId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("okr_key_results")
    .select("objective_id")
    .eq("id", keyResultId)
    .maybeSingle();
  if (!data) return false;
  return callerCanEditObjective(supabase, userId, (data as { objective_id: string }).objective_id);
}

/** Who may open and close cycles. */
export async function callerCanManageCycles(
  supabase: Client,
  userId: string
): Promise<boolean> {
  if (await callerIsAdmin(supabase, userId)) return true;
  return isLeadershipTeam(supabase, userId);
}
