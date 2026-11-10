import { redirect } from "next/navigation";
import { SUPER_ADMIN_ONLY_MODULES } from "@/config/modules";
import {
  accountIsActive,
  grantCounts,
  namesOf,
  permissionOf,
  type GrantScope,
} from "@/lib/auth/grant-scope";

export type { GrantScope } from "@/lib/auth/grant-scope";

/**
 * The role names that get the blanket bypass for a given module.
 *
 * Normally super_admin and admin both pass. For a SUPER_ADMIN_ONLY_MODULES
 * carve-out (the Records Library) only super_admin does — a plain `admin`
 * falls through to the direct / role-bundle permission checks below, and so
 * needs an explicit `records_library.manage` grant. Mirrors
 * public.can_access_records_library() in migration 212.
 */
function bypassRoles(modules: string[]): string[] {
  const carvedOut = modules.some((m) => SUPER_ADMIN_ONLY_MODULES.has(m));
  return carvedOut ? ["super_admin"] : ["super_admin", "admin"];
}

type RoleAssignment = {
  role_id: string;
  scope_type?: string | null;
  scope_id?: string | null;
  names: string[];
};

type GrantRow = {
  role_id?: string;
  scope_type?: string | null;
  scope_id?: string | null;
  permissions?: { module?: string; key?: string } | { module?: string; key?: string }[] | null;
};

/**
 * The one access rule behind all three exports: true if an active user holds
 * a bypass role (see bypassRoles), a direct user_permission for any of the
 * modules, or one through an assigned role's bundle
 * (user_roles -> role_permissions -> permissions).
 *
 * Unscoped grants count everywhere. A program-scoped grant counts only when
 * `scope.programId` matches. finance.* keys still need an unscoped grant
 * (migration 316). The account read, the roles and the direct grant go out
 * together; the bundle lookup only runs if neither settles it.
 * Any failed read is false.
 */
async function canAccessAnyModule(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  modules: string[],
  scope?: GrantScope
): Promise<boolean> {
  const directQuery = supabase
    .from("user_permissions")
    .select("scope_type, scope_id, permissions!inner(module, key)")
    .eq("user_id", userId);

  const [active, rolesResult, permsResult] = await Promise.all([
    accountIsActive(supabase, userId),
    supabase
      .from("user_roles")
      .select("role_id, scope_type, scope_id, roles(name)")
      .eq("user_id", userId),
    modules.length === 1
      ? directQuery.eq("permissions.module", modules[0])
      : directQuery.in("permissions.module", modules),
  ]);
  if (!active || rolesResult.error || permsResult.error) return false;

  const assignments = ((rolesResult.data ?? []) as Array<{
    role_id?: string;
    scope_type?: string | null;
    scope_id?: string | null;
    roles?: { name?: string } | { name?: string }[] | null;
  }>)
    .filter((row): row is typeof row & { role_id: string } => typeof row.role_id === "string")
    .map(
      (row): RoleAssignment => ({
        role_id: row.role_id,
        scope_type: row.scope_type,
        scope_id: row.scope_id,
        names: namesOf(row.roles),
      })
    );

  const bypass = bypassRoles(modules);
  if (
    assignments.some(
      (row) =>
        row.names.some((name) => bypass.includes(name)) &&
        grantCounts(row.scope_type, row.scope_id, scope)
    )
  ) {
    return true;
  }

  const direct = (permsResult.data ?? []) as GrantRow[];
  if (
    direct.some((row) => {
      const perm = permissionOf(row);
      return (
        typeof perm?.module === "string" &&
        modules.includes(perm.module) &&
        grantCounts(row.scope_type, row.scope_id, scope, perm.key)
      );
    })
  ) {
    return true;
  }

  const roleIds = [
    ...new Set(
      assignments
        .filter((row) => grantCounts(row.scope_type, row.scope_id, scope))
        .map((row) => row.role_id)
    ),
  ];
  if (roleIds.length === 0) return false;

  const bundleQuery = supabase
    .from("role_permissions")
    .select("role_id, permissions!inner(module, key)")
    .in("role_id", roleIds);
  const bundled = await (modules.length === 1
    ? bundleQuery.eq("permissions.module", modules[0])
    : bundleQuery.in("permissions.module", modules));
  if (bundled.error) return false;

  return ((bundled.data ?? []) as GrantRow[]).some((row) => {
    const perm = permissionOf(row);
    if (typeof perm?.module !== "string" || !modules.includes(perm.module)) return false;
    return assignments.some(
      (assignment) =>
        assignment.role_id === row.role_id &&
        grantCounts(assignment.scope_type, assignment.scope_id, scope, perm.key)
    );
  });
}

/**
 * Call at the top of any admin server page to enforce access.
 *
 * An active super_admin passes; an active `admin` passes for every module
 * except the SUPER_ADMIN_ONLY_MODULES carve-outs. Everyone else must have at
 * least one matching user_permission (direct or via a role bundle). Pass
 * `{ programId }` on a program page so a grant scoped to that program counts.
 * Callers that omit it only see unscoped grants. A deactivated account
 * (is_active = false) never passes.
 *
 * Usage:
 *   await requireModuleAccess(supabase, userId, "finance");
 */
export async function requireModuleAccess(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  module: string,
  scope?: GrantScope
) {
  if (await canAccessAnyModule(supabase, userId, [module], scope)) return;
  redirect("/dashboard");
}

/**
 * Non-redirecting boolean version of requireModuleAccess. Use to conditionally
 * render UI (e.g. hide a hub card the user can't open) rather than to guard a
 * page. Same rule as requireModuleAccess, including the optional program scope.
 */
export async function hasModuleAccess(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  module: string,
  scope?: GrantScope
): Promise<boolean> {
  return canAccessAnyModule(supabase, userId, [module], scope);
}

/**
 * Like requireModuleAccess, but passes if the user can reach ANY of the given
 * modules. Used by umbrella pages such as the /bookings hub, which spans the
 * "bookings" (Space Bookings) and "vehicles" (Rent a Vehicle) modules.
 */
export async function requireAnyModuleAccess(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  modules: string[],
  scope?: GrantScope
) {
  if (await canAccessAnyModule(supabase, userId, modules, scope)) return;
  redirect("/dashboard");
}
