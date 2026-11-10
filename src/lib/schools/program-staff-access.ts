import type { SupabaseClient } from "@supabase/supabase-js";
import { canManageFinance } from "@/lib/api-auth";
import { userCanManageProgram } from "@/lib/auth/check-schools-access";
import type { GrantScope } from "@/lib/auth/grant-scope";
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

/**
 * Direct or role-bundle schools grant that covers this program (an unscoped
 * grant counts everywhere). schools.assignable_as_contact does not.
 * Used so an existing permission holder who is also listed as staff is not
 * narrowed to assigned applicants.
 */
export async function userHasSchoolsGrant(
  supabase: SupabaseClient,
  userId: string,
  programId: string
): Promise<boolean> {
  const access = await getAccessibleSchoolsProgramIds(supabase, userId);
  if (access === "all") return true;
  return access.includes(programId);
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
  /** Unscoped Training access: the home lists every program and Create Program shows. */
  hasModuleAccess: boolean;
  staffProgramIds: string[];
  /** Program ids from program-scoped schools grants. Empty when hasModuleAccess. */
  grantProgramIds: string[];
  schools: SchoolsProgramAccess;
}> {
  const [schools, staffProgramIds] = await Promise.all([
    getAccessibleSchoolsProgramIds(supabase, userId),
    listStaffProgramIds(supabase, userId),
  ]);
  const seesAll = schools === "all";
  const grantProgramIds = seesAll ? [] : schools;
  const covers = (programId: string) =>
    seesAll || grantProgramIds.includes(programId) || staffProgramIds.includes(programId);
  const open = scope?.programId
    ? covers(scope.programId)
    : seesAll || grantProgramIds.length > 0 || staffProgramIds.length > 0;
  return {
    open,
    hasModuleAccess: seesAll,
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
