import type { SupabaseClient } from "@supabase/supabase-js";
import { canManageFinance } from "@/lib/api-auth";
import { ASSIGNABLE_CONTACT_PERMISSION_KEY } from "@/lib/auth/assignable-contacts";
import { userCanManageProgram } from "@/lib/auth/check-schools-access";
import { accountIsActive, permissionOf, type GrantScope } from "@/lib/auth/grant-scope";
import {
  getAccessibleSchoolsProgramIds,
  type SchoolsProgramAccess,
} from "@/lib/auth/schools-program-access";

// How a person stands on one school once program_staff exists (migration 304).
//
// staffScoped is the assigned-applicants view: no form, no emails, no
// roster. Only canManage or a schools.* grant lifts it. Finance access
// does not. It only adds the fees panel (showFees).

export type ProgramViewer = {
  userId: string;
  canManage: boolean;
  isStaff: boolean;
  canManageFinance: boolean;
  hasSchoolsGrant: boolean;
  staffScoped: boolean;
  showFees: boolean;
};

export function deriveProgramViewer(input: {
  userId: string;
  canManage: boolean;
  isStaff: boolean;
  canManageFinance: boolean;
  hasSchoolsGrant: boolean;
}): ProgramViewer {
  const staffScoped = input.isStaff && !input.canManage && !input.hasSchoolsGrant;
  const showFees = !staffScoped || input.canManageFinance;
  return { ...input, staffScoped, showFees };
}

/** Applicants a viewer may be handed. Staff-scoped viewers get their own assignments. */
export function applicationsForViewer<T extends { assigned_staff_id: string | null }>(
  rows: T[],
  viewer: { userId: string; staffScoped: boolean }
): T[] {
  if (!viewer.staffScoped) return rows;
  return rows.filter((row) => row.assigned_staff_id === viewer.userId);
}

/**
 * Schools home list. Unscoped module access keeps the list the query already
 * returned. Anyone else sees the schools they staff plus the programs on a
 * program-scoped schools grant, and nothing else.
 */
export function programsVisibleOnSchoolsHome<T extends { id: string }>(
  programs: T[],
  opts: { hasModuleAccess: boolean; staffProgramIds: string[]; grantProgramIds?: string[] }
): T[] {
  if (opts.hasModuleAccess) return programs;
  const allowed = new Set([...(opts.staffProgramIds ?? []), ...(opts.grantProgramIds ?? [])]);
  return programs.filter((program) => allowed.has(program.id));
}

type AssignableGrant = { scope_type: string | null; scope_id: string | null };

/**
 * Main's grantApplies: a missing scope counts for every program. A program
 * scope counts only for that program. Team and event scopes do not.
 */
function assignableCovers(grant: AssignableGrant, programId: string): boolean {
  if (!grant.scope_type || !grant.scope_id) return true;
  return grant.scope_type === "program" && grant.scope_id === programId;
}

/**
 * schools.assignable_as_contact grants. A deactivated account or any lookup
 * error yields none. An unscoped grant still covers every program; a program
 * scope covers only that program.
 */
async function assignableContactGrants(
  supabase: SupabaseClient,
  userId: string
): Promise<AssignableGrant[]> {
  if (!(await accountIsActive(supabase, userId))) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const direct = await db
    .from("user_permissions")
    .select("scope_type, scope_id, permissions!inner(key)")
    .eq("user_id", userId)
    .eq("permissions.key", ASSIGNABLE_CONTACT_PERMISSION_KEY);
  if (direct.error) return [];
  const grants: AssignableGrant[] = [];
  for (const row of (direct.data ?? []) as Array<{
    scope_type?: string | null;
    scope_id?: string | null;
    permissions?: { key?: string } | { key?: string }[] | null;
  }>) {
    if (permissionOf(row)?.key !== ASSIGNABLE_CONTACT_PERMISSION_KEY) continue;
    grants.push({ scope_type: row.scope_type ?? null, scope_id: row.scope_id ?? null });
  }

  const roles = await db
    .from("user_roles")
    .select("role_id, scope_type, scope_id")
    .eq("user_id", userId);
  if (roles.error) return [];
  if (!Array.isArray(roles.data) || roles.data.length === 0) return grants;

  const roleRows = roles.data as Array<{
    role_id?: string;
    scope_type?: string | null;
    scope_id?: string | null;
  }>;
  const roleIds = [
    ...new Set(roleRows.map((row) => row.role_id).filter((id): id is string => typeof id === "string")),
  ];
  if (roleIds.length === 0) return grants;

  const bundled = await db
    .from("role_permissions")
    .select("role_id, permissions!inner(key)")
    .in("role_id", roleIds)
    .eq("permissions.key", ASSIGNABLE_CONTACT_PERMISSION_KEY);
  if (bundled.error) return [];

  const carrying = new Set(
    ((bundled.data ?? []) as Array<{ role_id?: string; permissions?: { key?: string } | { key?: string }[] | null }>)
      .filter((row) => permissionOf(row)?.key === ASSIGNABLE_CONTACT_PERMISSION_KEY)
      .map((row) => row.role_id)
  );
  for (const row of roleRows) {
    if (!carrying.has(row.role_id)) continue;
    grants.push({ scope_type: row.scope_type ?? null, scope_id: row.scope_id ?? null });
  }
  return grants;
}

/**
 * Direct or role-bundle schools grant that covers this program.
 * Other schools keys use the active-account and program-scope rules.
 * schools.assignable_as_contact uses main's rule: an unscoped grant counts
 * for every program, a program-scoped grant counts only for that program.
 * Used so an existing permission holder who is also listed as staff is not
 * narrowed to assigned applicants.
 */
export async function userHasSchoolsGrant(
  supabase: SupabaseClient,
  userId: string,
  programId: string
): Promise<boolean> {
  const [access, assignable] = await Promise.all([
    getAccessibleSchoolsProgramIds(supabase, userId),
    assignableContactGrants(supabase, userId),
  ]);
  if (access === "all" || access.includes(programId)) return true;
  return assignable.some((grant) => assignableCovers(grant, programId));
}

export async function userIsProgramStaff(
  supabase: SupabaseClient,
  userId: string,
  programId: string
): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("program_staff")
    .select("id")
    .eq("program_id", programId)
    .eq("user_id", userId)
    .limit(1);
  if (error) return false;
  return !!data && data.length > 0;
}

export async function canOpenSchools(
  supabase: SupabaseClient,
  userId: string,
  scope?: GrantScope
): Promise<{
  open: boolean;
  /**
   * Unscoped Training access on the home. On a program page this is also true
   * for an unscoped schools.assignable_as_contact grant, which still opens
   * every program. A program-scoped contact grant does not set this flag.
   */
  hasModuleAccess: boolean;
  staffProgramIds: string[];
  /** Program ids from program-scoped schools grants. Empty when hasModuleAccess. */
  grantProgramIds: string[];
  schools: SchoolsProgramAccess;
}> {
  const [schools, staffProgramIds, assignable] = await Promise.all([
    getAccessibleSchoolsProgramIds(supabase, userId),
    listStaffProgramIds(supabase, userId),
    assignableContactGrants(supabase, userId),
  ]);
  const seesAll = schools === "all";
  const grantProgramIds = seesAll ? [] : schools;
  // An unscoped contact grant still opens every program page (main). A
  // program-scoped one opens only that program. Neither opens Training home.
  const unscopedContact = assignable.some((grant) => !grant.scope_type || !grant.scope_id);
  const contactOpens = (programId: string) =>
    assignable.some((grant) => assignableCovers(grant, programId));
  const covers = (programId: string) =>
    seesAll || grantProgramIds.includes(programId) || staffProgramIds.includes(programId);
  const open = scope?.programId
    ? covers(scope.programId) || contactOpens(scope.programId)
    : seesAll || grantProgramIds.length > 0 || staffProgramIds.length > 0;
  return {
    open,
    hasModuleAccess: seesAll || (!!scope?.programId && unscopedContact),
    staffProgramIds,
    grantProgramIds,
    schools,
  };
}

export async function listStaffProgramIds(
  supabase: SupabaseClient,
  userId: string
): Promise<string[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("program_staff")
    .select("program_id")
    .eq("user_id", userId);
  if (error || !data) return [];
  return (data as Array<{ program_id: string }>).map((row) => row.program_id);
}

/**
 * Add/remove staff, and the switch action. Mirrors has_schools_access
 * (migration 145): admins, schools.manage, and named leaders. Falls back
 * to userCanManageProgram when the RPC is not deployed yet so leader
 * management does not 500 before migration 304 is applied. That fallback
 * is slightly wider (approve / enrollment grants); after 304 the RPC wins.
 */
export async function userCanManageProgramStaff(
  supabase: SupabaseClient,
  userId: string,
  programId: string
): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data, error } = await db.rpc("has_schools_access", {
    target_program_id: programId,
  });
  if (!error && typeof data === "boolean") return data;
  return userCanManageProgram(supabase, userId, programId);
}

export async function resolveProgramViewer(
  supabase: SupabaseClient,
  userId: string,
  programId: string
): Promise<ProgramViewer> {
  const [canManage, isStaff, finance, hasSchoolsGrant] = await Promise.all([
    userCanManageProgram(supabase, userId, programId),
    userIsProgramStaff(supabase, userId, programId),
    canManageFinance(supabase, userId),
    userHasSchoolsGrant(supabase, userId, programId),
  ]);
  return deriveProgramViewer({
    userId,
    canManage,
    isStaff,
    canManageFinance: finance,
    hasSchoolsGrant,
  });
}
