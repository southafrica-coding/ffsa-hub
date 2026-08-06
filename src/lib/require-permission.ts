import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Call at the top of any admin server page to enforce access.
 *
 * super_admin and admin always pass through.
 * Everyone else must have at least one user_permission row for the given module.
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
  // Check super_admin / admin first — always allowed
  const { data: adminCheck } = await supabase
    .from("user_roles")
    .select("roles!inner(name)")
    .eq("user_id", userId)
    .in("roles.name", ["super_admin", "admin"])
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
 * page. Same rule: super_admin/admin always true; else a direct or role-bundle
 * permission for the module.
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
    .in("roles.name", ["super_admin", "admin"])
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
    .in("roles.name", ["super_admin", "admin"])
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
