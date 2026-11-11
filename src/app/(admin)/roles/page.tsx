import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getPermissions, curatePermissions } from "@/services/permissions";
import { getRoleMemberCounts, getRoleMembers } from "@/services/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  callerIsSuperAdmin,
  callerIsAdmin,
  callerCanManageRoles,
  getEffectivePermissionKeys,
} from "@/lib/auth/check-role-grant";
import { RolesManager } from "./roles-manager";

export default async function RolesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // super_admin, admin or holders of administration.manage_roles may manage roles.
  if (!(await callerCanManageRoles(supabase, user.id))) {
    redirect("/home");
  }

  const isSuperAdmin = await callerIsSuperAdmin(supabase, user.id);
  const isAdmin = isSuperAdmin || (await callerIsAdmin(supabase, user.id));
  const callerKeys = Array.from(await getEffectivePermissionKeys(supabase, user.id));

  const [rolesRes, permissionsByModule, memberCounts] = await Promise.all([
    supabase
      .from("roles")
      .select("id, name, display_name, description, is_system")
      .order("is_system", { ascending: true })
      .order("display_name", { ascending: true }),
    getPermissions(supabase),
    getRoleMemberCounts(supabase),
  ]);

  // role_id -> permission_ids (the bundles)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rolePerms } = await (supabase as any)
    .from("role_permissions")
    .select("role_id, permission_id");
  const bundles: Record<string, string[]> = {};
  for (const rp of (rolePerms ?? []) as { role_id: string; permission_id: string }[]) {
    (bundles[rp.role_id] ||= []).push(rp.permission_id);
  }

  // Who holds each role. Super admins and admins only — this is the one list
  // that answers "who can see everything?", and it carries staff names and
  // emails, so a manage_roles holder (who may have no other access to user
  // identities) keeps the plain counts.
  const roleMembers = isAdmin
    ? await getRoleMembers(supabase, createAdminClient())
    : {};

  return (
    <RolesManager
      roles={rolesRes.data ?? []}
      permissionsByModule={curatePermissions(permissionsByModule)}
      memberCounts={memberCounts}
      roleMembers={roleMembers}
      bundles={bundles}
      callerKeys={callerKeys}
      isSuperAdmin={isAdmin}
      canGrantRecordsLibrary={isSuperAdmin}
    />
  );
}
