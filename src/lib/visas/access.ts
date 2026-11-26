// Who may open the Visas screens. Rows are filtered by RLS (361); this only
// decides whether to show the page and which buttons to offer. The database
// functions (363) check every move again, so a wrong guess here can hide a
// button but never let anyone through.

import { hasAnyRole } from "@/lib/api-auth";
import { accountIsActive } from "@/lib/auth/grant-scope";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export interface VisaAccess {
  /** Admin, or visas.manage without a scope: every case and the reference lists. */
  globalLegal: boolean;
  /** Programs where the user holds visas.manage (scoped). */
  legalPrograms: string[];
  /** Programs where the user holds visas.follow_up (scoped), or "all". */
  followUpPrograms: string[] | "all";
  /** Any of the above: the Visas page opens. */
  open: boolean;
}

type GrantRow = { scope_type?: string | null; scope_id?: string | null };

/** The user's visa grants, direct or through a role bundle, with their scopes. */
async function visaGrants(supabase: Client, userId: string, key: string): Promise<GrantRow[]> {
  const [direct, roles] = await Promise.all([
    supabase
      .from("user_permissions")
      .select("scope_type, scope_id, permissions!inner(key)")
      .eq("user_id", userId)
      .eq("permissions.key", key),
    supabase.from("user_roles").select("role_id, scope_type, scope_id").eq("user_id", userId),
  ]);
  const rows: GrantRow[] = Array.isArray(direct.data) ? direct.data : [];
  const assignments: Array<GrantRow & { role_id?: string }> = Array.isArray(roles.data) ? roles.data : [];
  const roleIds = [...new Set(assignments.map((a) => a.role_id).filter((id): id is string => !!id))];
  if (roleIds.length > 0) {
    const bundled = await supabase
      .from("role_permissions")
      .select("role_id, permissions!inner(key)")
      .in("role_id", roleIds)
      .eq("permissions.key", key);
    const withKey = new Set(
      (Array.isArray(bundled.data) ? bundled.data : []).map((r: { role_id: string }) => r.role_id)
    );
    for (const a of assignments) if (a.role_id && withKey.has(a.role_id)) rows.push(a);
  }
  return rows;
}

/** Splits grants into "everywhere" or the programs they're scoped to. */
export function scopeOf(rows: GrantRow[]): string[] | "all" {
  if (rows.some((r) => r.scope_type === null)) return "all";
  return [
    ...new Set(
      rows.filter((r) => r.scope_type === "program" && typeof r.scope_id === "string").map((r) => r.scope_id as string)
    ),
  ];
}

export async function getVisaAccess(supabase: Client, userId: string): Promise<VisaAccess> {
  const [admin, active, manage, followUp] = await Promise.all([
    hasAnyRole(supabase, userId, ["super_admin", "admin"]),
    accountIsActive(supabase, userId),
    visaGrants(supabase, userId, "visas.manage"),
    visaGrants(supabase, userId, "visas.follow_up"),
  ]);
  const none: VisaAccess = { globalLegal: false, legalPrograms: [], followUpPrograms: [], open: false };
  if (!active) return none;
  const manageScope = scopeOf(manage);
  const globalLegal = admin || manageScope === "all";
  const legalPrograms = manageScope === "all" ? [] : manageScope;
  const followUpPrograms = scopeOf(followUp);
  const open =
    globalLegal ||
    legalPrograms.length > 0 ||
    followUpPrograms === "all" ||
    followUpPrograms.length > 0;
  return { globalLegal, legalPrograms, followUpPrograms, open };
}

/** Legal for a case covering these programs? */
export function isLegalFor(access: VisaAccess, programIds: string[]): boolean {
  return access.globalLegal || programIds.some((p) => access.legalPrograms.includes(p));
}

/** May follow this case up (leader or legal)? */
export function canFollowUp(access: VisaAccess, programIds: string[]): boolean {
  if (isLegalFor(access, programIds)) return true;
  if (access.followUpPrograms === "all") return true;
  const scoped = access.followUpPrograms;
  return programIds.some((p) => scoped.includes(p));
}
