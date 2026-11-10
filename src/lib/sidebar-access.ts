import { grantCounts } from "@/lib/auth/grant-scope";
import { getAccessibleSchoolsProgramIds } from "@/lib/auth/schools-program-access";
import { getPermissionRowsForRoles } from "@/services/permissions";

export interface SidebarAccess {
  /** Role names assigned to the user (e.g. "super_admin", "events_admin"). */
  userRoles: string[];
  /** Module ids the user can reach, derived from direct + role-bundle permissions. */
  permittedModules: Set<string>;
  /**
   * True when the user IS authenticated but their roles/permissions could not be
   * loaded (after a retry). The sidebar should surface a visible "refresh" notice
   * instead of a misleading empty menu — a transient blip must never make a
   * fully-permissioned staff member look deauthorized.
   */
  menuLoadFailed: boolean;
}

const MAX_ATTEMPTS = 2;

/**
 * Run a Supabase read, retrying once on error. Throws if it still fails so the
 * caller can flag the menu as failed-to-load rather than render it silently empty.
 */
async function readOrThrow<T>(
  run: () => PromiseLike<{ data: T | null; error: unknown }>
): Promise<T | null> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { data, error } = await run();
    if (!error) return data;
    lastError = error;
  }
  throw lastError;
}

/**
 * Resolve the signed-in user's sidebar access (roles + permitted module ids).
 *
 * Robust by design — a momentary auth/DB blip must never blank a permissioned
 * user's menu (the "Luke can't see anything" false alarm):
 *   - Auth: getUser() revalidates the JWT with the auth server. If that call
 *     itself errors we fall back to the cookie session, so a transient blip is
 *     not mistaken for "logged out". A clean null user = genuinely signed out.
 *   - Reads: retried once. If they still fail for an authenticated user we set
 *     menuLoadFailed so the UI can prompt a refresh instead of hiding everything.
 */
export async function getSidebarAccess(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<SidebarAccess> {
  const result: SidebarAccess = {
    userRoles: [],
    permittedModules: new Set<string>(),
    menuLoadFailed: false,
  };

  // 1) Who is this? Prefer getUser() (revalidated); fall back to the cookie
  //    session only if getUser errors, so an auth-server blip doesn't read as
  //    logged out. A clean null user means genuinely signed out → empty menu.
  let userId: string | null = null;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (data?.user) {
      userId = data.user.id;
    } else if (error) {
      const { data: sessionData } = await supabase.auth.getSession();
      userId = sessionData?.session?.user?.id ?? null;
    }
  } catch {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      userId = sessionData?.session?.user?.id ?? null;
    } catch {
      userId = null;
    }
  }

  if (!userId) return result; // signed out — a minimal menu is correct

  // 2) Load roles + permitted modules. If this fails for an authenticated user,
  //    flag it so the sidebar shows a refresh prompt, not a phantom empty menu.
  try {
    // The account flag and the role rows are independent. A deactivated
    // account (is_active = false) counts for nothing. NULL stays active.
    // Global nav keeps unscoped assignments. A program-scoped schools grant
    // still lights Training; other modules stay unscoped.
    const [userRow, roleRows] = await Promise.all([
      readOrThrow<{ is_active: boolean | null } | null>(() =>
        supabase.from("users").select("is_active").eq("id", userId).maybeSingle()
      ),
      readOrThrow<
        Array<{
          role_id?: string;
          scope_type?: string | null;
          scope_id?: string | null;
          roles: { name: string } | { name: string }[] | null;
        }>
      >(() =>
        supabase
          .from("user_roles")
          .select("role_id, scope_type, scope_id, roles(name)")
          .eq("user_id", userId)
      ),
    ]);

    if (!userRow || userRow.is_active === false) return result;

    const unscopedRoles = (roleRows ?? []).filter((row) =>
      grantCounts(row.scope_type, row.scope_id, undefined)
    );

    result.userRoles = unscopedRoles
      .map((r) => {
        const role = Array.isArray(r.roles) ? r.roles[0] : r.roles;
        return role?.name ?? null;
      })
      .filter(Boolean) as string[];

    // Only super_admin can skip the per-permission lookup. A plain `admin`
    // sees every module except the SUPER_ADMIN_ONLY_MODULES carve-outs
    // (Records Library), so we still need their permitted set to decide
    // those — getAccessibleModules does the filtering.
    const isSuperAdmin = result.userRoles.includes("super_admin");

    if (!isSuperAdmin) {
      // Direct grants and role-bundle grants are independent reads — fetch
      // them together.
      const roleIds = unscopedRoles
        .map((r) => r.role_id)
        .filter((id): id is string => typeof id === "string");
      const [permRows, roleDerived, staffSeat, schoolsAccess] = await Promise.all([
        readOrThrow<
          Array<{
            scope_type?: string | null;
            scope_id?: string | null;
            permissions:
              | { module: string; key: string }
              | { module: string; key: string }[]
              | null;
          }>
        >(() =>
          supabase
            .from("user_permissions")
            .select("scope_type, scope_id, permissions(module, key)")
            .eq("user_id", userId)
        ),
        // Best-effort, as before: a failed bundle read contributes nothing
        // rather than flagging the whole menu.
        getPermissionRowsForRoles(supabase, roleIds).catch(() => []),
        // program_staff (migration 304) is not a schools.* grant. A missing
        // table, before the migration is applied, must not blank the menu.
        supabase
          .from("program_staff")
          .select("id")
          .eq("user_id", userId)
          .limit(1)
          .then((res: { data: { id: string }[] | null; error: unknown }) =>
            res.error ? [] : res.data ?? []
          )
          .catch(() => [] as { id: string }[]),
        // Program-scoped schools grants light Training without opening every module.
        getAccessibleSchoolsProgramIds(supabase, userId),
      ]);

      for (const row of permRows ?? []) {
        const perm = Array.isArray(row.permissions) ? row.permissions[0] : row.permissions;
        if (!perm?.module || !grantCounts(row.scope_type, row.scope_id, undefined, perm.key)) continue;
        // Training itself is decided by getAccessibleSchoolsProgramIds, so a
        // lone schools.assignable_as_contact grant cannot light the entry.
        if (perm.module !== "schools") result.permittedModules.add(perm.module);
        // Users with schools.manage can delegate the assignable-contact
        // permission, so they need access to the Users page.
        if (perm?.key === "schools.manage") result.permittedModules.add("users");
        // Rent a Vehicle and Equipment hire live under the Bookings hub — their
        // permissions must light up the single "Bookings" sidebar item.
        if (perm?.module === "vehicles" || perm?.module === "equipment") result.permittedModules.add("bookings");
      }

      // Also count modules reachable through assigned roles' bundles.
      for (const perm of roleDerived) {
        if (perm.module !== "schools") result.permittedModules.add(perm.module);
        if (perm.key === "schools.manage") result.permittedModules.add("users");
        if (perm.module === "vehicles" || perm.module === "equipment") result.permittedModules.add("bookings");
      }

      if (schoolsAccess === "all" || schoolsAccess.length > 0) result.permittedModules.add("schools");
      if (staffSeat.length > 0) result.permittedModules.add("schools");
    }
  } catch {
    // Authenticated, but we couldn't load access. Don't render a misleading
    // empty menu — let the sidebar surface a visible, self-healing refresh.
    result.menuLoadFailed = true;
  }

  return result;
}
