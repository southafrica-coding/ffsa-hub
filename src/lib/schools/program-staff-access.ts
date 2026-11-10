import type { SupabaseClient } from "@supabase/supabase-js";
import { canManageFinance } from "@/lib/api-auth";
import { userCanManageProgram } from "@/lib/auth/check-schools-access";
import type { GrantScope } from "@/lib/auth/grant-scope";
import { hasModuleAccess } from "@/lib/require-permission";

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
 * Schools home list. Module access keeps the list the query already returned
 * (RLS). A person who can open Training only because they are program staff
 * sees the schools they staff.
 */
export function programsVisibleOnSchoolsHome<T extends { id: string }>(
  programs: T[],
  opts: { hasModuleAccess: boolean; staffProgramIds: string[] }
): T[] {
  if (opts.hasModuleAccess) return programs;
  const allowed = new Set(opts.staffProgramIds);
  return programs.filter((program) => allowed.has(program.id));
}

type GrantRow = {
  scope_type: string | null;
  scope_id: string | null;
  permissions: { key: string } | { key: string }[] | null;
};

function grantKey(row: GrantRow): string | null {
  const perm = Array.isArray(row.permissions) ? row.permissions[0] : row.permissions;
  return perm?.key ?? null;
}

function grantApplies(row: GrantRow, programId: string): boolean {
  if (!row.scope_type || !row.scope_id) return true;
  return row.scope_type === "program" && row.scope_id === programId;
}

/**
 * Direct or role-bundle schools.* grant that covers this program (global
 * scope counts). Used so an existing permission holder who is also listed
 * as staff is not narrowed.
 */
export async function userHasSchoolsGrant(
  supabase: SupabaseClient,
  userId: string,
  programId: string
): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: direct, error: directError } = await db
    .from("user_permissions")
    .select("scope_type, scope_id, permissions!inner(key)")
    .eq("user_id", userId);
  if (directError) return false;

  for (const row of (direct ?? []) as GrantRow[]) {
    const key = grantKey(row);
    if (key?.startsWith("schools.") && grantApplies(row, programId)) return true;
  }

  const { data: roles, error: rolesError } = await db
    .from("user_roles")
    .select("role_id, scope_type, scope_id")
    .eq("user_id", userId);
  if (rolesError || !roles || roles.length === 0) return false;

  const roleIds = (roles as Array<{ role_id: string; scope_type: string | null; scope_id: string | null }>)
    .filter((role) => !role.scope_type || (role.scope_type === "program" && role.scope_id === programId))
    .map((role) => role.role_id);
  if (roleIds.length === 0) return false;

  const { data: bundle, error: bundleError } = await db
    .from("role_permissions")
    .select("permissions!inner(key)")
    .in("role_id", roleIds);
  if (bundleError) return false;

  return (bundle ?? []).some((row: { permissions: { key: string } | { key: string }[] }) => {
    const perm = Array.isArray(row.permissions) ? row.permissions[0] : row.permissions;
    return !!perm?.key?.startsWith("schools.");
  });
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
): Promise<{ open: boolean; hasModuleAccess: boolean; staffProgramIds: string[] }> {
  const [moduleAccess, staffProgramIds] = await Promise.all([
    hasModuleAccess(supabase, userId, "schools", scope),
    listStaffProgramIds(supabase, userId),
  ]);
  return {
    open: moduleAccess || staffProgramIds.length > 0,
    hasModuleAccess: moduleAccess,
    staffProgramIds,
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
