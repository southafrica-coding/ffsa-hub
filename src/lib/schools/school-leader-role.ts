// Keeps the `school_leader` role (migration 292) in step with program_leaders
// rows, the same way the ministries leaders API keeps ministry_leader in step
// with ministry leader rows. The role carries bookings.request only, so being
// on a school's leader team lets someone book a room like a ministry leader.
//
// Deliberately NOT program_leader: an unscoped program_leader is a global
// schools manager (see migration 292's header).
//
// Callers pass the service-role client — user_roles writes are admin-only.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export const SCHOOL_LEADER_ROLE = "school_leader";

async function schoolLeaderRoleId(admin: Client): Promise<string | null> {
  const { data } = await admin
    .from("roles")
    .select("id")
    .eq("name", SCHOOL_LEADER_ROLE)
    .single();
  return data?.id ?? null;
}

// Grant the school_leader role (global, no scope) if the user lacks it.
export async function ensureSchoolLeaderRole(
  admin: Client,
  userId: string,
  assignedBy: string
) {
  const roleId = await schoolLeaderRoleId(admin);
  if (!roleId) return; // migration 292 not applied yet
  const { data: existing } = await admin
    .from("user_roles")
    .select("id")
    .eq("user_id", userId)
    .eq("role_id", roleId)
    .is("scope_type", null)
    .limit(1);
  if (!existing || existing.length === 0) {
    const { error } = await admin
      .from("user_roles")
      .insert({ user_id: userId, role_id: roleId, assigned_by: assignedBy });
    if (error) console.error("[school-leader-role] grant failed:", error.message);
  }
}

// Revoke the school_leader role if the user no longer leads ANY program.
export async function revokeSchoolLeaderRoleIfOrphaned(
  admin: Client,
  userId: string
) {
  const { data: stillLeads } = await admin
    .from("program_leaders")
    .select("id")
    .eq("user_id", userId)
    .limit(1);
  if (stillLeads && stillLeads.length > 0) return;
  const roleId = await schoolLeaderRoleId(admin);
  if (!roleId) return;
  const { error } = await admin
    .from("user_roles")
    .delete()
    .eq("user_id", userId)
    .eq("role_id", roleId)
    .is("scope_type", null);
  if (error) console.error("[school-leader-role] revoke failed:", error.message);
}
