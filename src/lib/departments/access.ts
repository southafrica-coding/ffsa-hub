// Department gates.
//
// Leadership is an active membership of the leadership_team ministry.
// The leadership_team role does not count: a stale role must not open
// another department or the roll-up.
//
// Leadership may view overview, people, OKRs and rocks for every home.
// Budget read is separate: that ministry's leaders, active Finances &
// Legal members, and unscoped admin. A donors_dev member may view the
// finances_legal home and does not gain its budget.

import { accountIsActive, grantCounts, namesOf, permissionOf } from "@/lib/auth/grant-scope";
import { rpcFlag } from "./rpc";
import { FINANCES_LEGAL_SLUG, FOLDED_DEPARTMENTS, LEADERSHIP_TEAM_SLUG } from "./homes";
import {
  listActiveMemberships,
  listAliases,
  listMinistriesBySlug,
  listUserRoleGrants,
  type ActiveMembership,
  type MinistryAlias,
  type RoleGrant,
} from "./repository";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const ADMIN_ROLES = ["super_admin", "admin"];

export type DepartmentGate = {
  isAdmin: boolean;
  /** Unscoped finance_admin role. */
  isFinanceAdmin: boolean;
  /** Unscoped finance.view or finance.edit, direct or via a role bundle. */
  hasFinanceRead: boolean;
  leadershipMinistryId: string | null;
  financeMinistryId: string | null;
  memberships: readonly ActiveMembership[];
  /** Source ministry id → home ministry id. Aliases plus FOLDED_DEPARTMENTS. */
  foldedTo: ReadonlyMap<string, string>;
};

export function holdsUnscopedRole(rows: readonly RoleGrant[], names: readonly string[]): boolean {
  return rows.some(
    (row) =>
      namesOf(row.roles).some((name) => names.includes(name)) &&
      grantCounts(row.scope_type, row.scope_id, undefined)
  );
}

export function isMemberOf(gate: DepartmentGate, ministryId: string): boolean {
  return gate.memberships.some((membership) => membership.staff_ministry_id === ministryId);
}

export function isLeaderOf(gate: DepartmentGate, ministryId: string): boolean {
  return gate.memberships.some(
    (membership) => membership.staff_ministry_id === ministryId && membership.member_role === "leader"
  );
}

/** Active member of the Leadership Team ministry. The role alone is not enough. */
export function isLeadershipMember(gate: DepartmentGate): boolean {
  if (!gate.leadershipMinistryId) return false;
  return isMemberOf(gate, gate.leadershipMinistryId);
}

function foldedInto(gate: DepartmentGate, homeId: string): boolean {
  return gate.memberships.some((membership) => gate.foldedTo.get(membership.staff_ministry_id) === homeId);
}

/** Active member (including a folded child), Leadership Team, or unscoped admin. */
export function canSeeDepartmentDetail(gate: DepartmentGate, ministryId: string): boolean {
  return gate.isAdmin || isLeadershipMember(gate) || isMemberOf(gate, ministryId) || foldedInto(gate, ministryId);
}

export const viewDepartment = canSeeDepartmentDetail;

/**
 * Matches dept_can_read_budget: ministry leader (member_role = leader),
 * Finances & Legal member, unscoped admin / super_admin, unscoped
 * finance_admin, or unscoped finance.view / finance.edit.
 * is_point_leader alone does not count. Leadership Team membership alone does not.
 */
export function canSeeBudget(gate: DepartmentGate, ministryId: string): boolean {
  if (gate.isAdmin || gate.isFinanceAdmin || gate.hasFinanceRead || isLeaderOf(gate, ministryId)) return true;
  return !!gate.financeMinistryId && isMemberOf(gate, gate.financeMinistryId);
}

export const readDepartmentBudget = canSeeBudget;

/** Matches dept_can_write_budget: member_role = leader, or unscoped admin. */
export function editDepartmentBudget(gate: DepartmentGate, ministryId: string): boolean {
  return gate.isAdmin || isLeaderOf(gate, ministryId);
}

/** Matches dept_can_write_rock: member_role = leader, or unscoped admin. */
export function editDepartmentRocks(gate: DepartmentGate, ministryId: string): boolean {
  return gate.isAdmin || isLeaderOf(gate, ministryId);
}

/** Leadership Team members and unscoped admins. */
export function viewLeadershipRocks(gate: DepartmentGate): boolean {
  return gate.isAdmin || isLeadershipMember(gate);
}

/** member_role = leader, or unscoped admin. is_point_leader alone does not count. */
export function canSeePeopleEmails(gate: DepartmentGate, ministryId: string): boolean {
  return gate.isAdmin || isLeaderOf(gate, ministryId);
}

export const revealPeopleEmails = canSeePeopleEmails;

export function canOpenDepartment(gate: DepartmentGate, ministryId: string): boolean {
  return canSeeDepartmentDetail(gate, ministryId) || canSeeBudget(gate, ministryId);
}

export type DepartmentAccessFlags = {
  canSeeDepartmentDetail: boolean;
  canSeeBudget: boolean;
  canEditBudget: boolean;
  canEditRocks: boolean;
  canSeePeopleEmails: boolean;
};

export function accessFlags(gate: DepartmentGate, ministryId: string): DepartmentAccessFlags {
  return {
    canSeeDepartmentDetail: canSeeDepartmentDetail(gate, ministryId),
    canSeeBudget: canSeeBudget(gate, ministryId),
    canEditBudget: editDepartmentBudget(gate, ministryId),
    canEditRocks: editDepartmentRocks(gate, ministryId),
    canSeePeopleEmails: canSeePeopleEmails(gate, ministryId),
  };
}

function foldedMap(
  aliases: readonly MinistryAlias[],
  ministries: readonly { id: string; slug: string }[]
): Map<string, string> {
  const bySlug = new Map(ministries.map((ministry) => [ministry.slug, ministry.id]));
  const map = new Map<string, string>();
  for (const alias of aliases) map.set(alias.staff_ministry_id, alias.resolves_to_id);
  for (const [source, target] of Object.entries(FOLDED_DEPARTMENTS)) {
    const sourceId = bySlug.get(source);
    const targetId = bySlug.get(target);
    if (sourceId && targetId && !map.has(sourceId)) map.set(sourceId, targetId);
  }
  return map;
}

/** Null means deny: inactive, or any lookup failed. */
export async function loadDepartmentGate(supabase: Client, userId: string): Promise<DepartmentGate | null> {
  const active = await accountIsActive(supabase, userId);
  if (!active) return null;

  const slugs = [LEADERSHIP_TEAM_SLUG, FINANCES_LEGAL_SLUG, ...Object.keys(FOLDED_DEPARTMENTS)];
  const [roles, ministries, memberships, aliases] = await Promise.all([
    listUserRoleGrants(supabase, userId),
    listMinistriesBySlug(supabase, slugs),
    listActiveMemberships(supabase, userId),
    listAliases(supabase),
  ]);
  if (roles.error || ministries.error || memberships.error || aliases.error) return null;
  const financeRead = await unscopedFinanceRead(supabase, userId);
  if (financeRead.error) return null;

  return {
    isAdmin: holdsUnscopedRole(roles.data, ADMIN_ROLES),
    isFinanceAdmin: holdsUnscopedRole(roles.data, ["finance_admin"]),
    hasFinanceRead: financeRead.allowed,
    leadershipMinistryId: ministries.data.find((ministry) => ministry.slug === LEADERSHIP_TEAM_SLUG)?.id ?? null,
    financeMinistryId: ministries.data.find((ministry) => ministry.slug === FINANCES_LEGAL_SLUG)?.id ?? null,
    memberships: memberships.data,
    foldedTo: foldedMap(aliases.data, ministries.data),
  };
}

const FINANCE_KEYS = ["finance.view", "finance.edit"];

async function unscopedFinanceRead(
  supabase: Client,
  userId: string
): Promise<{ allowed: boolean; error: boolean }> {
  const direct = await supabase
    .from("user_permissions")
    .select("scope_type, scope_id, permissions!inner(key)")
    .eq("user_id", userId)
    .in("permissions.key", FINANCE_KEYS);
  if (direct.error) return { allowed: false, error: true };
  const rows = (Array.isArray(direct.data) ? direct.data : []) as Array<{
    scope_type?: string | null;
    scope_id?: string | null;
    permissions?: { key?: string } | { key?: string }[] | null;
  }>;
  if (
    rows.some((row) => {
      const key = permissionOf(row)?.key;
      return (
        (key === "finance.view" || key === "finance.edit") &&
        grantCounts(row.scope_type, row.scope_id, undefined, key)
      );
    })
  ) {
    return { allowed: true, error: false };
  }

  const roles = await supabase.from("user_roles").select("role_id, scope_type, scope_id").eq("user_id", userId);
  if (roles.error) return { allowed: false, error: true };
  const assignments = (Array.isArray(roles.data) ? roles.data : []) as Array<{
    role_id?: string;
    scope_type?: string | null;
    scope_id?: string | null;
  }>;
  const matching = assignments.filter(
    (row) => typeof row.role_id === "string" && grantCounts(row.scope_type, row.scope_id, undefined, "finance.view")
  );
  const roleIds = [...new Set(matching.map((row) => row.role_id as string))];
  if (roleIds.length === 0) return { allowed: false, error: false };

  const bundled = await supabase
    .from("role_permissions")
    .select("role_id, permissions!inner(key)")
    .in("role_id", roleIds)
    .in("permissions.key", FINANCE_KEYS);
  if (bundled.error) return { allowed: false, error: true };
  const bundleRows = (Array.isArray(bundled.data) ? bundled.data : []) as Array<{
    role_id?: string;
    permissions?: { key?: string } | { key?: string }[] | null;
  }>;
  const allowed = bundleRows.some((row) => {
    const key = permissionOf(row)?.key;
    if (key !== "finance.view" && key !== "finance.edit") return false;
    return matching.some(
      (assignment) => assignment.role_id === row.role_id && grantCounts(assignment.scope_type, assignment.scope_id, undefined, key)
    );
  });
  return { allowed, error: false };
}

async function withGate(
  supabase: Client,
  userId: string,
  allow: (gate: DepartmentGate) => boolean
): Promise<boolean> {
  const gate = await loadDepartmentGate(supabase, userId);
  if (!gate) return false;
  return allow(gate);
}

export async function canViewDepartment(supabase: Client, userId: string, ministryId: string): Promise<boolean> {
  return withGate(supabase, userId, (gate) => viewDepartment(gate, ministryId));
}

export async function canReadDepartmentBudget(
  supabase: Client,
  userId: string,
  ministryId: string
): Promise<boolean> {
  return withGate(supabase, userId, (gate) => readDepartmentBudget(gate, ministryId));
}

export async function canEditDepartmentBudget(
  supabase: Client,
  userId: string,
  ministryId: string
): Promise<boolean> {
  return withGate(supabase, userId, (gate) => editDepartmentBudget(gate, ministryId));
}

export async function canEditDepartmentRocks(
  supabase: Client,
  userId: string,
  ministryId: string
): Promise<boolean> {
  return withGate(supabase, userId, (gate) => editDepartmentRocks(gate, ministryId));
}

async function seesFoldedHome(
  supabase: Client,
  homeId: string
): Promise<{ ok: true; value: boolean } | { ok: false }> {
  const home = await supabase.from("staff_ministries").select("slug").eq("id", homeId).maybeSingle();
  if (home.error) return { ok: false };
  const slug = (home.data as { slug?: string } | null)?.slug;
  const sources = Object.entries(FOLDED_DEPARTMENTS)
    .filter(([, target]) => target === slug)
    .map(([source]) => source);
  if (sources.length === 0) return { ok: true, value: false };
  const rows = await supabase.from("staff_ministries").select("id, slug").in("slug", sources);
  if (rows.error) return { ok: false };
  const ids = (Array.isArray(rows.data) ? rows.data : []).map((row: { id: string }) => row.id);
  const checks = await Promise.all(
    ids.map((id: string) => rpcFlag(supabase, "dept_is_ministry_member", { p_ministry_id: id, p_leaders_only: false }))
  );
  if (checks.some((check) => !check.ok)) return { ok: false };
  return { ok: true, value: checks.some((check) => check.value) };
}

/**
 * Flags for one home. Budget and rock writes come from the database
 * functions. canSeePeopleEmails matches dept_can_write_rock: a leader
 * (member_role = leader) or an unscoped admin. is_point_leader does not
 * grant any of these. The donors_dev fold is not in dept_can_read_rock,
 * so detail adds that membership check.
 * ok false means the access lookup failed (403). denied means 404.
 */
/** Homes a folded child (donors_dev) may open. One membership check per source, not per home. */
export async function foldedDetailIds(
  supabase: Client,
  ministries: readonly { id: string; slug: string }[]
): Promise<{ ok: true; ids: Set<string> } | { ok: false }> {
  const bySlug = new Map(ministries.map((ministry) => [ministry.slug, ministry.id]));
  const pairs = Object.entries(FOLDED_DEPARTMENTS).flatMap(([source, target]) => {
    const sourceId = bySlug.get(source);
    const targetId = bySlug.get(target);
    if (!sourceId || !targetId) return [];
    return [{ sourceId, targetId }];
  });
  if (pairs.length === 0) return { ok: true, ids: new Set() };
  const checks = await Promise.all(
    pairs.map((pair) =>
      rpcFlag(supabase, "dept_is_ministry_member", { p_ministry_id: pair.sourceId, p_leaders_only: false })
    )
  );
  if (checks.some((check) => !check.ok)) return { ok: false };
  const ids = new Set<string>();
  checks.forEach((check, index) => {
    if (check.ok && check.value) ids.add(pairs[index]!.targetId);
  });
  return { ok: true, ids };
}

export async function loadMinistryAccess(
  supabase: Client,
  ministryId: string,
  options?: { fold?: boolean }
): Promise<{ ok: true; access: DepartmentAccessFlags; denied: boolean } | { ok: false }> {
  const [readRock, readBudget, writeBudget, writeRock] = await Promise.all([
    rpcFlag(supabase, "dept_can_read_rock", { p_ministry_id: ministryId }),
    rpcFlag(supabase, "dept_can_read_budget", { p_ministry_id: ministryId }),
    rpcFlag(supabase, "dept_can_write_budget", { p_ministry_id: ministryId }),
    rpcFlag(supabase, "dept_can_write_rock", { p_ministry_id: ministryId }),
  ]);
  if (!readRock.ok || !readBudget.ok || !writeBudget.ok || !writeRock.ok) return { ok: false };

  let detail = readRock.value;
  if (!detail && options?.fold !== false) {
    const folded = await seesFoldedHome(supabase, ministryId);
    if (!folded.ok) return { ok: false };
    detail = folded.value;
  }

  const access: DepartmentAccessFlags = {
    canSeeDepartmentDetail: detail,
    canSeeBudget: readBudget.value,
    canEditBudget: writeBudget.value,
    canEditRocks: writeRock.value,
    canSeePeopleEmails: writeRock.value,
  };
  return { ok: true, access, denied: !access.canSeeDepartmentDetail && !access.canSeeBudget };
}

export async function canViewLeadershipRocks(supabase: Client, userId: string): Promise<boolean> {
  return withGate(supabase, userId, (gate) => viewLeadershipRocks(gate));
}
