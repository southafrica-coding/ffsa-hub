import { redirect } from "next/navigation";
import { SUPER_ADMIN_ONLY_MODULES } from "@/config/modules";

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

/**
 * The one access rule behind all three exports: true if the user holds a
 * bypass role (see bypassRoles), a direct user_permission for any of the
 * modules, or one through an assigned role's bundle
 * (user_roles -> role_permissions -> permissions).
 *
 * The user's roles and their direct grant are independent reads, so they go
 * out together; the bundle lookup only runs if neither settles it. That is two
 * round trips at most — the checks used to run one after another (up to four).
 * Any failed read counts as "no", exactly as before: an error never grants.
 */
async function canAccessAnyModule(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  modules: string[]
): Promise<boolean> {
  const directQuery = supabase
    .from("user_permissions")
    .select("permissions!inner(module)")
    .eq("user_id", userId);

  const [{ data: roleRows }, { data: permCheck }] = await Promise.all([
    supabase.from("user_roles").select("role_id, roles(name)").eq("user_id", userId),
    (modules.length === 1
      ? directQuery.eq("permissions.module", modules[0])
      : directQuery.in("permissions.module", modules)
    ).limit(1),
  ]);

  const roles = (roleRows ?? []) as Array<{
    role_id: string;
    roles: { name: string } | { name: string }[] | null;
  }>;
  const roleNames = roles.flatMap((r) =>
    Array.isArray(r.roles) ? r.roles.map((x) => x.name) : r.roles ? [r.roles.name] : []
  );

  // Blanket role bypass (see bypassRoles)
  const bypass = bypassRoles(modules);
  if (roleNames.some((name) => bypass.includes(name))) return true;

  // Direct permission grant
  if (permCheck && permCheck.length > 0) return true;

  // Access granted through an assigned role's bundle
  const roleIds = roles.map((r) => r.role_id);
  if (roleIds.length === 0) return false;

  const bundleQuery = supabase
    .from("role_permissions")
    .select("permissions!inner(module)")
    .in("role_id", roleIds);
  const { data: rolePermCheck } = await (modules.length === 1
    ? bundleQuery.eq("permissions.module", modules[0])
    : bundleQuery.in("permissions.module", modules)
  ).limit(1);

  return !!(rolePermCheck && rolePermCheck.length > 0);
}

/**
 * Call at the top of any admin server page to enforce access.
 *
 * super_admin always passes; `admin` passes for every module except the
 * SUPER_ADMIN_ONLY_MODULES carve-outs. Everyone else must have at least one
 * user_permission row (direct or via a role bundle) for the given module.
 *
 * Usage:
 *   await requireModuleAccess(supabase, userId, "finance");
 */
export async function requireModuleAccess(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  module: string
) {
  if (await canAccessAnyModule(supabase, userId, [module])) return;
  redirect("/dashboard");
}

/**
 * Non-redirecting boolean version of requireModuleAccess. Use to conditionally
 * render UI (e.g. hide a hub card the user can't open) rather than to guard a
 * page. Same rule as requireModuleAccess: super_admin always true, `admin`
 * true outside the SUPER_ADMIN_ONLY_MODULES carve-outs, else a direct or
 * role-bundle permission for the module.
 */
export async function hasModuleAccess(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  module: string
): Promise<boolean> {
  return canAccessAnyModule(supabase, userId, [module]);
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
  modules: string[]
) {
  if (await canAccessAnyModule(supabase, userId, modules)) return;
  redirect("/dashboard");
}
