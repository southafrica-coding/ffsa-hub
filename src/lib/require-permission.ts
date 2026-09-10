import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
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
  // Blanket role bypass first (see bypassRoles)
  const { data: adminCheck } = await supabase
    .from("user_roles")
    .select("roles!inner(name)")
    .eq("user_id", userId)
    .in("roles.name", bypassRoles([module]))
    .limit(1);

  if ((adminCheck?.length ?? 0) > 0) return;

  // Direct permission grant for this module
  const { data: permCheck } = await supabase
    .from("user_permissions")
    .select("permissions!inner(module)")
    .eq("user_id", userId)
    .eq("permissions.module", module)
    .limit(1);

  if (permCheck && permCheck.length > 0) return;

  // Or access granted through an assigned role's bundle
  // (user_roles -> role_permissions -> permissions for this module)
  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("role_id")
    .eq("user_id", userId);

  const roleIds = (roleRows ?? []).map((r: { role_id: string }) => r.role_id);
  if (roleIds.length > 0) {
    const { data: rolePermCheck } = await supabase
      .from("role_permissions")
      .select("permissions!inner(module)")
      .in("role_id", roleIds)
      .eq("permissions.module", module)
      .limit(1);

    if (rolePermCheck && rolePermCheck.length > 0) return;
  }

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
  const { data: adminCheck } = await supabase
    .from("user_roles")
    .select("roles!inner(name)")
    .eq("user_id", userId)
    .in("roles.name", bypassRoles([module]))
    .limit(1);

  if ((adminCheck?.length ?? 0) > 0) return true;

  const { data: permCheck } = await supabase
    .from("user_permissions")
    .select("permissions!inner(module)")
    .eq("user_id", userId)
    .eq("permissions.module", module)
    .limit(1);

  if (permCheck && permCheck.length > 0) return true;

  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("role_id")
    .eq("user_id", userId);

  const roleIds = (roleRows ?? []).map((r: { role_id: string }) => r.role_id);
  if (roleIds.length > 0) {
    const { data: rolePermCheck } = await supabase
      .from("role_permissions")
      .select("permissions!inner(module)")
      .in("role_id", roleIds)
      .eq("permissions.module", module)
      .limit(1);

    if (rolePermCheck && rolePermCheck.length > 0) return true;
  }

  return false;
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
  const { data: adminCheck } = await supabase
    .from("user_roles")
    .select("roles!inner(name)")
    .eq("user_id", userId)
    .in("roles.name", bypassRoles(modules))
    .limit(1);

  if ((adminCheck?.length ?? 0) > 0) return;

  const { data: permCheck } = await supabase
    .from("user_permissions")
    .select("permissions!inner(module)")
    .eq("user_id", userId)
    .in("permissions.module", modules)
    .limit(1);

  if (permCheck && permCheck.length > 0) return;

  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("role_id")
    .eq("user_id", userId);

  const roleIds = (roleRows ?? []).map((r: { role_id: string }) => r.role_id);
  if (roleIds.length > 0) {
    const { data: rolePermCheck } = await supabase
      .from("role_permissions")
      .select("permissions!inner(module)")
      .in("role_id", roleIds)
      .in("permissions.module", modules)
      .limit(1);

    if (rolePermCheck && rolePermCheck.length > 0) return;
  }

  redirect("/dashboard");
}
