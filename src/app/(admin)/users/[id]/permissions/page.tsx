import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import { getUserById } from "@/services/users";
import { getAuthSignIn } from "@/lib/users/auth-signins";
import {
  getPermissions,
  getUserPermissions,
  getScopeOptions,
  curatePermissions,
} from "@/services/permissions";
import { getSchoolsManageScopes } from "@/lib/auth/schools-manage-scopes";
import { callerCanManageRoles } from "@/lib/auth/check-role-grant";
import { PermissionManager } from "../permission-manager";
import { RoleAssignment, type AssignedRole } from "../role-assignment";
import { AdvancedAccess } from "../advanced-access";
import { OutreachRestriction } from "../outreach-restriction";
import {
  getOutreachRestriction,
  getRolePermissionsWithKeys,
} from "@/services/outreach-restrictions";
import { UserTabs } from "../user-tabs";
import { UserHeader } from "../user-header";
import { SUPER_ADMIN_LOCKED_NOTE } from "@/components/super-admin-badge";

export default async function UserPermissionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) redirect("/login");

  // super_admin, admin (General Admin) or anyone with schools.manage may view
  // this page. Admins get the full editor; only a super_admin can hand out
  // Super Admin or Records Library access.
  const { data: adminTierRows } = await supabase
    .from("user_roles")
    .select("roles!inner(name)")
    .eq("user_id", authUser.id)
    .in("roles.name", ["super_admin", "admin"]);
  const callerTiers = new Set(
    ((adminTierRows ?? []) as { roles: { name: string } | { name: string }[] }[]).map(
      (r) => (Array.isArray(r.roles) ? r.roles[0]?.name : r.roles?.name)
    )
  );
  const isSuperAdmin = callerTiers.has("super_admin");
  const isAdmin = isSuperAdmin || callerTiers.has("admin");

  const manageScopes = isAdmin
    ? { hasGlobal: true, programIds: [] }
    : await getSchoolsManageScopes(supabase, authUser.id);

  const hasAnySchoolsManage =
    manageScopes.hasGlobal || manageScopes.programIds.length > 0;

  if (!isAdmin && !hasAnySchoolsManage) redirect(`/users/${id}`);

  const [{ data: targetUser, error }, authLastSignInAt] = await Promise.all([
    getUserById(supabase, id),
    getAuthSignIn(id),
  ]);
  if (error || !targetUser) notFound();

  const canManageRoles = await callerCanManageRoles(supabase, authUser.id);

  const [
    permissionsByModule,
    userPermissions,
    scopeOptions,
    targetSuperCheck,
    assignedRolesRes,
    assignableRolesRes,
  ] = await Promise.all([
    getPermissions(supabase),
    getUserPermissions(supabase, id),
    getScopeOptions(supabase),
    // Both admin tiers in one read — the Advanced panel shows a row for each.
    supabase
      .from("user_roles")
      .select("roles!inner(name)")
      .eq("user_id", id)
      .in("roles.name", ["super_admin", "admin"]),
    supabase
      .from("user_roles")
      .select("id, role_id, scope_type, scope_id, roles!inner(name, display_name, is_system)")
      .eq("user_id", id),
    // Non-system roles are the normal "job titles". program_leader is a
    // system role but is assignable here (scoped to a program) — allow it
    // through explicitly. The membership roles (staff/student/community_member)
    // are system roles too, but a super admin sets them by hand here.
    // The admin tiers (super_admin / admin) are NOT job titles — they have
    // their own rows in the Advanced panel below.
    supabase
      .from("roles")
      .select("id, name, display_name")
      .or("is_system.eq.false,name.eq.program_leader,name.in.(staff,student,community_member)")
      .order("display_name", { ascending: true }),
  ]);

  const targetTierRoles = new Set(
    (targetSuperCheck.data ?? []).map((r) => {
      const role = Array.isArray(r.roles) ? r.roles[0] : r.roles;
      return (role?.name as string) ?? "";
    })
  );
  const isTargetSuperAdmin = targetTierRoles.has("super_admin");
  const isTargetGeneralAdmin = targetTierRoles.has("admin");
  const isSelf = authUser.id === id;
  // A super admin's titles, tiers and standing are a super admin's to change.
  const targetLocked = isTargetSuperAdmin && !isSuperAdmin;

  // "Outreach: own teams only" (migration 274) — admins only. Whether the
  // person holds finance.view / finance.edit directly or through a title,
  // so the panel can say when the flag has nothing to limit yet.
  const FINANCE_KEYS = ["finance.view", "finance.edit"];
  let outreachLimited = false;
  let hasFinanceGrant = false;
  if (isAdmin) {
    const roleIds = (assignedRolesRes.data ?? []).map((r) => r.role_id as string);
    const [{ data: restriction }, { data: viaRole }] = await Promise.all([
      getOutreachRestriction(supabase, id),
      roleIds.length
        ? getRolePermissionsWithKeys(supabase, roleIds, FINANCE_KEYS)
        : Promise.resolve({ data: [] }),
    ]);
    outreachLimited = restriction?.limited_to_own_teams === true;
    hasFinanceGrant =
      userPermissions.some((p) => FINANCE_KEYS.includes(p.permissions?.key)) ||
      (viaRole ?? []).length > 0;
  }

  // Granular grid uses the curated catalog (legacy duplicates hidden).
  const curated = curatePermissions(permissionsByModule);

  // Job-title chips: the person's non-system roles only. (super_admin has its
  // own toggle in the Advanced panel; other system roles are legacy.)
  const assigned: AssignedRole[] = (assignedRolesRes.data ?? [])
    .map((r) => {
      const role = Array.isArray(r.roles) ? r.roles[0] : r.roles;
      return {
        id: r.id as string,
        role_id: r.role_id as string,
        scope_type: (r.scope_type as string | null) ?? null,
        scope_id: (r.scope_id as string | null) ?? null,
        display_name: (role?.display_name as string) ?? "Role",
        name: (role?.name as string) ?? "",
        is_system: !!role?.is_system,
      };
    })
    // Show non-system job titles, plus the scoped program_leader chip and the
    // membership roles (staff/student/community_member) so they can be removed.
    .filter(
      (r) =>
        !r.is_system ||
        r.name === "program_leader" ||
        r.name === "staff" ||
        r.name === "student" ||
        r.name === "community_member"
    )
    .map((r) => ({
      id: r.id,
      role_id: r.role_id,
      scope_type: r.scope_type,
      scope_id: r.scope_id,
      display_name: r.display_name,
    }));

  // Roles carrying a program scope prompt for a program when added.
  const assignable = (assignableRolesRes.data ?? []).map((r) => ({
    id: r.id as string,
    display_name: r.display_name as string,
    scope_type: (r.name as string) === "program_leader" ? "program" : null,
  }));

  const personName =
    targetUser.display_name ??
    ([targetUser.first_name, targetUser.last_name].filter(Boolean).join(" ") ||
      "this person");

  const scopeLabels: Record<string, string> = {};
  for (const s of scopeOptions) scopeLabels[s.id] = s.label;

  // Program-only options for the scoped-role picker (e.g. Program Leader).
  const programOptions = scopeOptions
    .filter((s) => s.scope_type === "program")
    .map((s) => ({ id: s.id, label: s.label }));

  return (
    <div className="ffsa-screen">
      <UserHeader
        user={targetUser}
        authLastSignInAt={authLastSignInAt}
        isSuperAdmin={isTargetSuperAdmin}
        eyebrow="Access management"
      />
      <UserTabs userId={id} active="permissions" showPermissions={true} />

      <div className="space-y-6 px-5 py-6 md:px-8 md:py-7">
      <RoleAssignment
        userId={id}
        assigned={assigned}
        assignable={assignable}
        scopeLabels={scopeLabels}
        programOptions={programOptions}
        canManage={(isAdmin || canManageRoles) && !targetLocked}
        canConvertToCommunity={isAdmin && !isSelf && !targetLocked}
        lockedNote={targetLocked ? SUPER_ADMIN_LOCKED_NOTE : undefined}
        personName={personName}
      />

      {isAdmin && (
        <OutreachRestriction
          userId={id}
          personName={personName}
          limited={outreachLimited}
          hasFinanceGrant={hasFinanceGrant}
        />
      )}

      <AdvancedAccess>
        <PermissionManager
          userId={id}
          currentStatus={targetUser.status ?? "invited"}
          currentJobTitle={targetUser.job_title ?? ""}
          permissionsByModule={curated}
          userPermissions={userPermissions}
          scopeOptions={scopeOptions}
          isSuperAdmin={isAdmin}
          canGrantSuperAdmin={isSuperAdmin}
          managedProgramIds={manageScopes.hasGlobal ? null : manageScopes.programIds}
          isTargetSuperAdmin={isTargetSuperAdmin}
          isTargetGeneralAdmin={isTargetGeneralAdmin}
          isSelf={isSelf}
          targetLocked={targetLocked}
          personName={personName}
        />
      </AdvancedAccess>
      </div>
    </div>
  );
}
