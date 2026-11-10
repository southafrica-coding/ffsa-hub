// Scope and account rules shared by hasAnyRole, hasAnyPermission and
// hasModuleAccess. They follow migrations 313 and 316:
//
//   * users.is_active IS NOT FALSE. false is out. NULL is still active.
//   * A grant with scope_type NULL counts for every caller.
//   * A program-scoped grant counts only when the caller passes that programId.
//   * team and event scopes never satisfy a programId.
//   * finance.* keys count only from an unscoped grant, even when programId matches.
//
// A missing scope_type is not treated as unscoped: a read that forgot the
// column fails closed.

export type GrantScope = {
  programId?: string | null;
};

/** Optional scope plus, for hasAnyPermission, whether a role bundle counts. */
export type PermissionCheck = GrantScope & {
  /**
   * Also honour the key when an assigned role's bundle carries it.
   * The role assignment's own scope is what must match. Default false,
   * so existing direct-grant callers stay direct-grant callers.
   * canManageApplicationTemplates (PR #550) should pass true and no
   * programId: that is an unscoped schools.manage grant, direct or bundled.
   */
  viaRoleBundle?: boolean;
};

export function grantCounts(
  scopeType: string | null | undefined,
  scopeId: string | null | undefined,
  scope: GrantScope | undefined,
  permissionKey?: string | null
): boolean {
  if (typeof permissionKey === "string" && permissionKey.startsWith("finance.") && scopeType != null) {
    return false;
  }
  if (scopeType === null) return true;
  if (scopeType !== "program") return false;
  const programId = scope?.programId;
  if (typeof programId !== "string" || programId.length === 0) return false;
  return scopeId === programId;
}

/** True when this account may hold access. Lookup errors and a missing row are false. */
export async function accountIsActive(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("users")
    .select("is_active")
    .eq("id", userId)
    .maybeSingle();
  if (error || data == null || Array.isArray(data)) return false;
  return (data as { is_active?: boolean | null }).is_active !== false;
}

export function permissionOf(row: {
  permissions?: { module?: string; key?: string } | { module?: string; key?: string }[] | null;
}): { module?: string; key?: string } | null {
  const perm = Array.isArray(row.permissions) ? row.permissions[0] : row.permissions;
  return perm ?? null;
}

export function namesOf(
  roles: { name?: string } | { name?: string }[] | null | undefined
): string[] {
  if (Array.isArray(roles)) {
    return roles.map((r) => r.name).filter((n): n is string => typeof n === "string");
  }
  return typeof roles?.name === "string" ? [roles.name] : [];
}
