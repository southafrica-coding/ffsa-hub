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
import { UserTabs } from "../user-tabs";
import { UserHeader } from "../user-header";

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

  // super_admin or anyone with schools.manage may view this page.
  const { data: superCheck } = await supabase
    .from("user_roles")
    .select("roles!inner(name)")
    .eq("user_id", authUser.id)
    .eq("roles.name", "super_admin")
    .limit(1);
  const isSuperAdmin = (superCheck?.length ?? 0) > 0;

  const manageScopes = isSuperAdmin
    ? { hasGlobal: true, programIds: [] }
    : await getSchoolsManageScopes(supabase, authUser.id);

  const hasAnySchoolsManage =
    manageScopes.hasGlobal || manageScopes.programIds.length > 0;

  if (!isSuperAdmin && !hasAnySchoolsManage) redirect(`/users/${id}`);

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
    supabase
      .from("user_roles")
      .select("roles!inner(name)")
      .eq("user_id", id)
      .eq("roles.name", "super_admin")
      .limit(1),
    supabase
      .from("user_roles")
      .select("id, role_id, scope_type, scope_id, roles!inner(name, display_name, is_system)")
      .eq("user_id", id),
    // Non-system roles are the normal "job titles". program_leader is a
    // system role but is assignable here (scoped to a program) — allow it
    // through explicitly. The membership roles (staff/student/community_member)
    // are system roles too, but a super admin sets them by hand here.
    supabase
      .from("roles")
      .select("id, name, display_name")
      .or("is_system.eq.false,name.eq.program_leader,name.in.(staff,student,community_member)")
      .order("display_name", { ascending: true }),
  ]);

  const isTargetSuperAdmin = (targetSuperCheck.data?.length ?? 0) > 0;
  const isSelf = authUser.id === id;

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
        canManage={isSuperAdmin || canManageRoles}
        canConvertToCommunity={isSuperAdmin && !isSelf}
      />

      <AdvancedAccess>
        <PermissionManager
          userId={id}
          currentStatus={targetUser.status ?? "invited"}
          currentJobTitle={targetUser.job_title ?? ""}
          permissionsByModule={curated}
          userPermissions={userPermissions}
          scopeOptions={scopeOptions}
          isSuperAdmin={isSuperAdmin}
          managedProgramIds={manageScopes.hasGlobal ? null : manageScopes.programIds}
          isTargetSuperAdmin={isTargetSuperAdmin}
          isSelf={isSelf}
        />
      </AdvancedAccess>
      </div>
    </div>
  );
}
