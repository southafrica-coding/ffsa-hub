// Authorization helpers for the OKRs module.
//
// These do NOT replace the row-level policies — RLS is the real gate, and
// every route writes with the caller's own client so a policy violation is
// unavoidable. These exist so a refused write comes back as a clean 403 with
// a sentence a human can read, instead of a raw PostgREST constraint string.
//
// WHO MAY CHANGE AN OKR. Keep in step with can_edit_okr_objective() /
// can_create_okr() (migration 182, narrowed by 271):
//   - admin / super_admin, anywhere;
//   - an active leader of the ministry the objective belongs to;
//   - the owner of an individual objective.
// That is all. The Leadership Team role is NOT on this list any more: 182 let
// it edit and delete every ministry's OKRs, which is how a Leadership Team
// member could delete another ministry's objectives. Leadership still READS
// everything (the SELECT policies are unchanged) and still runs cycles.

import { callerIsAdmin, getLedMinistryIds } from "./check-ministry-access";

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

/**
 * Who may see and record Leadership Track staff decisions (migration 247):
 * the Leadership Team, plus super_admin. A plain `admin` (General Admin) is
 * still NOT enough — this stays a role-only area. Writes go through the
 * service-role client after this check, so RLS on the table is not involved.
 */
export async function canUseStaffDecisions(
  supabase: Client,
  userId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("user_roles")
    .select("roles!inner(name)")
    .eq("user_id", userId)
    .in("roles.name", ["leadership_team", "super_admin"])
    .limit(1);
  return ((data as unknown[] | null)?.length ?? 0) > 0;
}

// ────────────────────────────────────────────────────────────
// The rule
// ────────────────────────────────────────────────────────────

/** What the rule needs to know about the caller. */
export type OkrCaller = {
  userId: string;
  isAdmin: boolean;
  /** Ministries the caller is an active `leader` of. */
  ledMinistryIds: readonly string[];
};

/** What the rule needs to know about the objective (existing or proposed). */
export type OkrTarget = {
  scope: string;
  /** NULL for an objective owned by an OKR-only team. */
  ministryId: string | null;
  ownerUserId: string | null;
};

/**
 * May this caller create, edit or delete this objective (and so its key
 * results and check-ins)? Pure, so it can be tested without a database.
 *
 * A NULL ministryId means an OKR-only team, which has no roster and so no
 * leader — admins only. Same as the SQL, where leads_staff_ministry(NULL)
 * collapses to is_admin().
 */
export function canChangeOkr(caller: OkrCaller, target: OkrTarget): boolean {
  if (caller.isAdmin) return true;
  if (
    target.scope === "individual" &&
    !!target.ownerUserId &&
    target.ownerUserId === caller.userId
  ) {
    return true;
  }
  return !!target.ministryId && caller.ledMinistryIds.includes(target.ministryId);
}

// ────────────────────────────────────────────────────────────
// Database-backed wrappers
// ────────────────────────────────────────────────────────────

async function loadCaller(supabase: Client, userId: string): Promise<OkrCaller> {
  const [isAdmin, ledMinistryIds] = await Promise.all([
    callerIsAdmin(supabase, userId),
    getLedMinistryIds(supabase, userId),
  ]);
  return { userId, isAdmin, ledMinistryIds };
}

/** Admin, or an active leader of that ministry. NULL (an OKR team) is admin-only. */
export async function callerCanEditMinistryOkrs(
  supabase: Client,
  userId: string,
  ministryId: string | null
): Promise<boolean> {
  return canChangeOkr(await loadCaller(supabase, userId), {
    scope: "ministry",
    ministryId,
    ownerUserId: null,
  });
}

/**
 * Mirrors the SQL can_create_okr(scope, ministry_id, owner_user_id): the
 * INSERT-time question, before a row exists to look up. Individual OKRs
 * (migration 218's CV-card "Personal OKRs" section) may always be created by
 * their owner.
 */
export async function callerCanCreateOkr(
  supabase: Client,
  userId: string,
  input: { scope: "ministry" | "individual"; ministryId: string | null; ownerUserId: string | null }
): Promise<boolean> {
  return canChangeOkr(await loadCaller(supabase, userId), input);
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

  const row = data as {
    staff_ministry_id: string | null;
    scope: string;
    owner_user_id: string | null;
  };
  return canChangeOkr(await loadCaller(supabase, userId), {
    scope: row.scope,
    ministryId: row.staff_ministry_id,
    ownerUserId: row.owner_user_id,
  });
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

/**
 * May this caller amend or remove an existing check-in? A check-in is a log
 * entry, not a field: its author may correct their own, and an admin may
 * correct anyone's. Mirrors the okr_checkins UPDATE/DELETE policies (271).
 */
export function canAmendCheckin(caller: Pick<OkrCaller, "userId" | "isAdmin">, authorId: string | null): boolean {
  return caller.isAdmin || (!!authorId && authorId === caller.userId);
}

export async function callerCanAmendCheckin(
  supabase: Client,
  userId: string,
  checkinId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("okr_checkins")
    .select("author_id")
    .eq("id", checkinId)
    .maybeSingle();
  if (!data) return false;
  return canAmendCheckin(
    { userId, isAdmin: await callerIsAdmin(supabase, userId) },
    (data as { author_id: string | null }).author_id
  );
}

/**
 * Who may open and close cycles. Leadership keeps this: a cycle is the
 * base-wide calendar, not any one ministry's OKRs.
 */
export async function callerCanManageCycles(
  supabase: Client,
  userId: string
): Promise<boolean> {
  if (await callerIsAdmin(supabase, userId)) return true;
  return isLeadershipTeam(supabase, userId);
}
