// Department gates.
//
// is_active = false denies. Any failed lookup denies — a role-table error
// must not fall through to "they're a member, let them in". Admin and
// super_admin are the unscoped grants only, the same rule as hasAnyRole
// after #551 (grantCounts treats a missing scope_type as not unscoped, and
// a program-scoped admin does not count when the caller passes no program).
//
// hasAnyRole itself swallows a lookup error as false, which would let a
// membership row allow the request during an outage of user_roles. The
// role rows are read here and passed through grantCounts / namesOf so the
// error stays visible.

import { accountIsActive, grantCounts, namesOf } from "@/lib/auth/grant-scope";
import {
  listActiveMemberships,
  listMinistriesBySlug,
  listUserRoleGrants,
  type ActiveMembership,
  type RoleGrant,
} from "./repository";
import { FINANCES_LEGAL_SLUG, LEADERSHIP_TEAM_SLUG } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const ADMIN_ROLES = ["super_admin", "admin"];
const LEADERSHIP_ROLE = ["leadership_team"];

export type DepartmentGate = {
  isAdmin: boolean;
  /** Unscoped leadership_team role. Membership of the ministry also counts. */
  isLeadershipRole: boolean;
  leadershipMinistryId: string | null;
  financeMinistryId: string | null;
  memberships: readonly ActiveMembership[];
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

/** Active member of Leadership Team, or the unscoped leadership_team role. */
export function isLeadershipMember(gate: DepartmentGate): boolean {
  if (gate.isLeadershipRole) return true;
  if (!gate.leadershipMinistryId) return false;
  return isMemberOf(gate, gate.leadershipMinistryId);
}

/** Admin, an active member of this ministry, or Leadership Team. */
export function viewDepartment(gate: DepartmentGate, ministryId: string): boolean {
  return gate.isAdmin || isMemberOf(gate, ministryId) || isLeadershipMember(gate);
}

/**
 * Admin, an active leader of this ministry, or any active member of
 * Finances & Legal (every department).
 */
export function readDepartmentBudget(gate: DepartmentGate, ministryId: string): boolean {
  if (gate.isAdmin || isLeaderOf(gate, ministryId)) return true;
  return !!gate.financeMinistryId && isMemberOf(gate, gate.financeMinistryId);
}

/** Admin, or an active leader of this ministry. Finance members do not edit. */
export function editDepartmentBudget(gate: DepartmentGate, ministryId: string): boolean {
  return gate.isAdmin || isLeaderOf(gate, ministryId);
}

/** Admin, or an active leader of this ministry. A plain member does not. */
export function editDepartmentRocks(gate: DepartmentGate, ministryId: string): boolean {
  return gate.isAdmin || isLeaderOf(gate, ministryId);
}

/** Leadership Team members and admins. A single ministry's leader is not enough. */
export function viewLeadershipRocks(gate: DepartmentGate): boolean {
  return gate.isAdmin || isLeadershipMember(gate);
}

/** Null means deny: inactive, or any of the three lookups failed. */
export async function loadDepartmentGate(
  supabase: Client,
  userId: string
): Promise<DepartmentGate | null> {
  const active = await accountIsActive(supabase, userId);
  if (!active) return null;

  const [roles, ministries, memberships] = await Promise.all([
    listUserRoleGrants(supabase, userId),
    listMinistriesBySlug(supabase, [LEADERSHIP_TEAM_SLUG, FINANCES_LEGAL_SLUG]),
    listActiveMemberships(supabase, userId),
  ]);
  if (roles.error || ministries.error || memberships.error) return null;

  const leadership = ministries.data.find((ministry) => ministry.slug === LEADERSHIP_TEAM_SLUG);
  const finance = ministries.data.find((ministry) => ministry.slug === FINANCES_LEGAL_SLUG);
  return {
    isAdmin: holdsUnscopedRole(roles.data, ADMIN_ROLES),
    isLeadershipRole: holdsUnscopedRole(roles.data, LEADERSHIP_ROLE),
    leadershipMinistryId: leadership?.id ?? null,
    financeMinistryId: finance?.id ?? null,
    memberships: memberships.data,
  };
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

export async function canViewDepartment(
  supabase: Client,
  userId: string,
  ministryId: string
): Promise<boolean> {
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

export async function canViewLeadershipRocks(supabase: Client, userId: string): Promise<boolean> {
  return withGate(supabase, userId, (gate) => viewLeadershipRocks(gate));
}
