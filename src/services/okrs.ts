// Data access for the OKRs module — cycles, objectives, key results, check-ins.
//
// Pure query construction, caller supplies the client (see src/services/schools.ts).
// Callers pass the RLS-scoped server client: the policies in migration 182 are
// the access model, so passing an admin client here would quietly disable it.
//
// Note what is NOT embedded: check-ins carry an author_id, and objectives an
// owner_user_id, but neither joins users(...). Under the users-table RLS an
// embedded join hands a non-admin reader a list of nulls, so every member
// would read "Unknown". Names are hydrated separately — see hydrateUserNames.

import { createAdminClient } from "@/lib/supabase/admin";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const KEY_RESULT_FIELDS =
  "id, objective_id, position, label, description, notes, timeline, owner_note, " +
  "metric_unit, metric_start, metric_target, current_status, current_value, last_checkin_at";

const OBJECTIVE_FIELDS =
  "id, cycle_id, scope, staff_ministry_id, okr_team_id, subcategory_id, owner_user_id, position, " +
  "title, description, notes, owner_note, timeline, is_archived";

const TEAM_FIELDS = "id, name, slug, description, is_active, sort_order";

const CYCLE_FIELDS = "id, name, slug, starts_on, ends_on, is_current";

/* ── Cycles ─────────────────────────────────────────── */

export async function listCycles(supabase: Client) {
  return supabase.from("okr_cycles").select(CYCLE_FIELDS).order("starts_on", { ascending: false });
}

export async function getCurrentCycle(supabase: Client) {
  return supabase.from("okr_cycles").select(CYCLE_FIELDS).eq("is_current", true).maybeSingle();
}

export async function getCycleBySlug(supabase: Client, slug: string) {
  return supabase.from("okr_cycles").select(CYCLE_FIELDS).eq("slug", slug).maybeSingle();
}

export async function createCycle(
  supabase: Client,
  input: { name: string; slug: string; starts_on: string; ends_on: string }
) {
  return supabase.from("okr_cycles").insert(input).select(CYCLE_FIELDS).single();
}

export async function updateCycle(
  supabase: Client,
  id: string,
  patch: Partial<{ name: string; starts_on: string; ends_on: string }>
) {
  return supabase.from("okr_cycles").update(patch).eq("id", id).select(CYCLE_FIELDS).single();
}

/**
 * Promotion goes through the SQL function, not a pair of updates: the partial
 * unique index one_current_okr_cycle rejects a second current row, and two
 * PostgREST calls have no transaction between them to demote-then-promote in.
 */
export async function setCurrentCycle(supabase: Client, id: string) {
  return supabase.rpc("set_current_okr_cycle", { target_cycle_id: id });
}

/* ── OKR-only teams ─────────────────────────────────── */

/**
 * Groups that write OKRs without being staff ministries. Kept separate from
 * staff_ministries on purpose — these have no roster, no leaders and no
 * department; see the note at the top of migration 182.
 */
export async function listOkrTeams(supabase: Client) {
  return supabase
    .from("okr_teams")
    .select(TEAM_FIELDS)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
}

export async function getOkrTeam(supabase: Client, id: string) {
  return supabase.from("okr_teams").select(TEAM_FIELDS).eq("id", id).maybeSingle();
}

/* ── Objectives ─────────────────────────────────────── */

/**
 * Objectives with their key results nested. RLS decides what comes back, so
 * the same call serves a plain staff member and the leadership team.
 */
export async function listObjectives(
  supabase: Client,
  filters: {
    cycleId: string;
    ministryId?: string;
    teamId?: string;
    scope?: "ministry" | "individual";
    ownerUserId?: string;
    includeArchived?: boolean;
  }
) {
  let q = supabase
    .from("okr_objectives")
    .select(`${OBJECTIVE_FIELDS}, okr_key_results(${KEY_RESULT_FIELDS})`)
    .eq("cycle_id", filters.cycleId);

  if (filters.ministryId) q = q.eq("staff_ministry_id", filters.ministryId);
  if (filters.teamId) q = q.eq("okr_team_id", filters.teamId);
  if (filters.scope) q = q.eq("scope", filters.scope);
  if (filters.ownerUserId) q = q.eq("owner_user_id", filters.ownerUserId);
  if (!filters.includeArchived) q = q.eq("is_archived", false);

  return q
    .order("position", { ascending: true })
    .order("position", { ascending: true, referencedTable: "okr_key_results" });
}

export async function getObjective(supabase: Client, id: string) {
  return supabase
    .from("okr_objectives")
    .select(`${OBJECTIVE_FIELDS}, okr_key_results(${KEY_RESULT_FIELDS})`)
    .eq("id", id)
    .maybeSingle();
}

export async function createObjective(
  supabase: Client,
  input: {
    cycle_id: string;
    /** Exactly one of staff_ministry_id / okr_team_id. */
    staff_ministry_id?: string | null;
    okr_team_id?: string | null;
    scope?: "ministry" | "individual";
    owner_user_id?: string | null;
    subcategory_id?: string | null;
    position?: number;
    title: string;
    description?: string | null;
    notes?: string | null;
    owner_note?: string | null;
    timeline?: string | null;
    created_by?: string;
  }
) {
  return supabase.from("okr_objectives").insert(input).select(OBJECTIVE_FIELDS).single();
}

export async function updateObjective(
  supabase: Client,
  id: string,
  patch: Record<string, unknown>
) {
  return supabase.from("okr_objectives").update(patch).eq("id", id).select(OBJECTIVE_FIELDS).single();
}

// The deletes return the removed ids: RLS refuses a delete by matching no
// rows rather than by erroring, so an empty `data` is how a caller tells.
export async function deleteObjective(supabase: Client, id: string) {
  return supabase.from("okr_objectives").delete().eq("id", id).select("id");
}

/** Next free position within a ministry's objectives for this cycle. */
export async function nextObjectivePosition(
  supabase: Client,
  cycleId: string,
  owner: { ministryId?: string | null; teamId?: string | null }
): Promise<number> {
  let q = supabase.from("okr_objectives").select("position").eq("cycle_id", cycleId);
  q = owner.teamId
    ? q.eq("okr_team_id", owner.teamId)
    : q.eq("staff_ministry_id", owner.ministryId);
  const { data } = await q.order("position", { ascending: false }).limit(1).maybeSingle();
  return ((data as { position: number } | null)?.position ?? 0) + 1;
}

/* ── Key results ────────────────────────────────────── */

/**
 * Several key results at once, for the objective dialog's inline rows. One
 * insert rather than a loop, so a failure is atomic across the batch and the
 * caller only has the objective itself left to clean up.
 */
export async function createKeyResults(
  supabase: Client,
  rows: {
    objective_id: string;
    description: string;
    position: number;
    created_by?: string | null;
  }[]
) {
  return supabase.from("okr_key_results").insert(rows).select("id");
}

export async function createKeyResult(
  supabase: Client,
  input: {
    objective_id: string;
    position?: number;
    label?: string | null;
    description: string;
    notes?: string | null;
    timeline?: string | null;
    owner_note?: string | null;
    metric_unit?: string | null;
    metric_start?: number | null;
    metric_target?: number | null;
    created_by?: string;
  }
) {
  return supabase.from("okr_key_results").insert(input).select(KEY_RESULT_FIELDS).single();
}

export async function updateKeyResult(
  supabase: Client,
  id: string,
  patch: Record<string, unknown>
) {
  return supabase.from("okr_key_results").update(patch).eq("id", id).select(KEY_RESULT_FIELDS).single();
}

export async function deleteKeyResult(supabase: Client, id: string) {
  return supabase.from("okr_key_results").delete().eq("id", id).select("id");
}

export async function nextKeyResultPosition(
  supabase: Client,
  objectiveId: string
): Promise<number> {
  const { data } = await supabase
    .from("okr_key_results")
    .select("position")
    .eq("objective_id", objectiveId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  return ((data as { position: number } | null)?.position ?? 0) + 1;
}

/* ── Edit history ───────────────────────────────────── */

const EVENT_FIELDS =
  "id, key_result_id, objective_id, action, field, old_value, new_value, actor_id, created_at";

/**
 * Edits recorded against one key result. Written only by the migration-197
 * trigger, and RLS-scoped to the same audience as the key result itself.
 */
export async function listKeyResultEvents(supabase: Client, keyResultId: string, limit = 100) {
  return supabase
    .from("okr_events")
    .select(EVENT_FIELDS)
    .eq("key_result_id", keyResultId)
    .order("created_at", { ascending: false })
    .limit(limit);
}

/** Edits recorded against one objective — used for its notes provenance line. */
export async function listObjectiveEvents(supabase: Client, objectiveId: string, limit = 100) {
  return supabase
    .from("okr_events")
    .select(EVENT_FIELDS)
    .eq("objective_id", objectiveId)
    .order("created_at", { ascending: false })
    .limit(limit);
}

/* ── Check-ins ──────────────────────────────────────── */

const CHECKIN_FIELDS = "id, key_result_id, checkin_on, status, value, comment, author_id, created_at";

export async function listCheckins(supabase: Client, keyResultId: string) {
  return supabase
    .from("okr_checkins")
    .select(CHECKIN_FIELDS)
    .eq("key_result_id", keyResultId)
    .order("checkin_on", { ascending: false })
    .order("created_at", { ascending: false });
}

/**
 * Never writes current_status on the key result — the okr_checkins_refresh_kr
 * trigger does that, so the API, the sheet importer and manual SQL edits all
 * end up with the same answer.
 */
export async function createCheckin(
  supabase: Client,
  input: {
    key_result_id: string;
    status: string;
    value?: number | null;
    comment?: string | null;
    checkin_on?: string;
    author_id: string;
  }
) {
  return supabase.from("okr_checkins").insert(input).select(CHECKIN_FIELDS).single();
}

export async function updateCheckin(
  supabase: Client,
  id: string,
  patch: Record<string, unknown>
) {
  return supabase.from("okr_checkins").update(patch).eq("id", id).select(CHECKIN_FIELDS).single();
}

export async function deleteCheckin(supabase: Client, id: string) {
  return supabase.from("okr_checkins").delete().eq("id", id).select("id");
}

/* ── Identity hydration ─────────────────────────────── */

/**
 * Resolve user ids to display names with the admin client.
 *
 * public.users is own-row-or-admin, so a ministry leader reading their team's
 * check-ins gets nulls from any embedded users(...) join and every author
 * renders as "Unknown". Authorization has already happened by the time this
 * runs — only the NAMES come from the service role, and only { id, name }
 * leaves this function, so no service-role row reaches a client component.
 */
export async function hydrateUserNames(userIds: string[]): Promise<Record<string, string>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return {};

  const admin = createAdminClient();
  const { data } = await admin
    .from("users")
    .select("id, first_name, last_name, display_name, preferred_name")
    .in("id", ids);

  const names: Record<string, string> = {};
  for (const u of (data ?? []) as Record<string, string | null>[]) {
    const full = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
    names[u.id as string] = u.display_name || full || "Unknown";
  }
  return names;
}
