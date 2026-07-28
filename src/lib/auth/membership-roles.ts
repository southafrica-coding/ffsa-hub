// Membership-role automation driven by school-application lifecycle.
//
// Two rules, both operating with the service-role admin client (they write
// user_roles / users, which RLS otherwise guards):
//
//   - ensureStudentRole: applying for / being accepted into a school makes
//     the person a student, with precedence staff > student > community.
//   - deactivateMembershipProfile: when a student leaves (application
//     rejected/cancelled, or enrollment dismissed) their account is
//     deactivated — but only "membership-level" accounts, never staff/admin.
//
// Both are safe no-ops when userId is null (public applicants who have no
// account yet — they pick up the student role when an admin accepts them).

// The Supabase generic is heavy; the codebase passes admin clients as `any`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

// Roles that, on their own, describe a plain member. If a user holds ANY role
// outside this set (staff, admin, super_admin, program/team/finance/comms/
// mission/ministry leaders, …) they are considered elevated and are never
// auto-deactivated.
const MEMBERSHIP_ONLY = new Set(["student", "community_member", "self_service"]);

async function getRoleNames(admin: Admin, userId: string): Promise<string[]> {
  const { data } = await admin
    .from("user_roles")
    .select("role_id, roles!inner(name)")
    .eq("user_id", userId);
  return ((data ?? []) as Array<{ roles: { name: string } | { name: string }[] }>)
    .map((r) => (Array.isArray(r.roles) ? r.roles[0]?.name : r.roles?.name))
    .filter((n): n is string => !!n);
}

/**
 * Ensure the user carries the `student` role, honoring staff > student >
 * community precedence:
 *   - staff present        → leave unchanged (staff overrules student)
 *   - student absent       → grant student (self_service floor untouched)
 *   - community_member present → remove it (student overrules community)
 */
export async function ensureStudentRole(
  admin: Admin,
  userId: string | null,
  assignedBy: string
): Promise<void> {
  if (!userId) return;

  const names = await getRoleNames(admin, userId);
  if (names.includes("staff")) return; // staff overrules student

  let changed = false;

  if (!names.includes("student")) {
    const { data: studentRole } = await admin
      .from("roles")
      .select("id")
      .eq("name", "student")
      .single();
    if (studentRole) {
      await admin.from("user_roles").upsert(
        {
          user_id: userId,
          role_id: studentRole.id,
          scope_type: null,
          scope_id: null,
          assigned_by: assignedBy,
        },
        { onConflict: "user_id,role_id,scope_type,scope_id", ignoreDuplicates: true }
      );
      changed = true;
    }
  }

  if (names.includes("community_member")) {
    const { data: communityRole } = await admin
      .from("roles")
      .select("id")
      .eq("name", "community_member")
      .single();
    if (communityRole) {
      await admin
        .from("user_roles")
        .delete()
        .eq("user_id", userId)
        .eq("role_id", communityRole.id);
      changed = true;
    }
  }

  if (changed) {
    await admin.from("audit_logs").insert({
      user_id: assignedBy,
      action: "update",
      resource_type: "user_roles",
      resource_id: userId,
      changes: { auto_role: "student", reason: "school_application" },
    });
  }
}

/**
 * Deactivate a membership-level account (sets users.status = 'inactive').
 * Guarded so staff/admin/leader accounts are never auto-deactivated — only
 * users whose roles are a subset of {student, community_member, self_service}.
 * Reversible via the existing super-admin status controls.
 */
export async function deactivateMembershipProfile(
  admin: Admin,
  userId: string | null,
  reason: string
): Promise<void> {
  if (!userId) return;

  const names = await getRoleNames(admin, userId);
  const isElevated = names.some((n) => !MEMBERSHIP_ONLY.has(n));
  if (isElevated) return; // never deactivate staff/admin accounts

  await admin.from("users").update({ status: "inactive" }).eq("id", userId);

  await admin.from("audit_logs").insert({
    user_id: userId,
    action: "update",
    resource_type: "users",
    resource_id: userId,
    changes: { status: "inactive", reason },
  });
}
