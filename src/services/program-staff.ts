// FFSA Hub — Program staff (migration 304).
//
// Staff are not leaders. A row here does not grant has_schools_access.
// These helpers back the Staff tab and the switch action. Callers pass
// an admin client for identity joins; authorization happens in the route.

import { revokeSchoolLeaderRoleIfOrphaned } from "@/lib/schools/school-leader-role";
import {
  INTERVIEW_OUTCOMES,
  isInterviewOutcome,
  type InterviewOutcome,
} from "@/lib/schools/interview-outcomes";

export { INTERVIEW_OUTCOMES, isInterviewOutcome };
export type { InterviewOutcome };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type ProgramStaffMember = {
  id: string;
  user_id: string;
  created_at: string;
  users: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
  } | null;
};

export async function listProgramStaff(admin: Client, programId: string) {
  return admin
    .from("program_staff")
    .select(
      "id, user_id, created_at, users:user_id(id, first_name, last_name, email)"
    )
    .eq("program_id", programId)
    .order("created_at", { ascending: true });
}

/** Add a staff member. Idempotent on (program_id, user_id). */
export async function addProgramStaff(
  admin: Client,
  programId: string,
  userId: string,
  addedBy: string
) {
  return admin.from("program_staff").upsert(
    { program_id: programId, user_id: userId, added_by: addedBy },
    { onConflict: "program_id,user_id", ignoreDuplicates: true }
  );
}

export async function removeProgramStaff(
  admin: Client,
  programId: string,
  userId: string
) {
  return admin
    .from("program_staff")
    .delete()
    .eq("program_id", programId)
    .eq("user_id", userId);
}

export type StaffSwitchResult = {
  removedLeader: boolean;
  removedPermissionKeys: string[];
};

/**
 * Move one person to staff of this program.
 *
 * Idempotent. Adds the program_staff row first, then drops the leader
 * row for this program only, revokes school_leader if they lead nothing
 * else, and deletes schools.* user_permissions scoped to this program.
 * Unscoped grants and every other program are left as they are. Refuses
 * super admins. Does not remove a global program_leader role — that role
 * is an all-schools manager and has to be taken off by hand.
 */
export async function switchPersonToProgramStaff(
  admin: Client,
  programId: string,
  userId: string,
  actorId: string
): Promise<{ data: StaffSwitchResult | null; error: { message: string } | null }> {
  const { data: superRows, error: superError } = await admin
    .from("user_roles")
    .select("user_id, roles!inner(name)")
    .eq("user_id", userId)
    .eq("roles.name", "super_admin")
    .limit(1);
  if (superError) return { data: null, error: superError };
  if (superRows && superRows.length > 0) {
    return { data: null, error: { message: "Refusing to switch a super admin" } };
  }

  const { error: addError } = await addProgramStaff(admin, programId, userId, actorId);
  if (addError) return { data: null, error: addError };

  const { data: leaderRows, error: leaderReadError } = await admin
    .from("program_leaders")
    .select("id")
    .eq("program_id", programId)
    .eq("user_id", userId)
    .limit(1);
  if (leaderReadError) return { data: null, error: leaderReadError };

  const removedLeader = !!leaderRows && leaderRows.length > 0;
  if (removedLeader) {
    const { error: leaderDeleteError } = await admin
      .from("program_leaders")
      .delete()
      .eq("program_id", programId)
      .eq("user_id", userId);
    if (leaderDeleteError) return { data: null, error: leaderDeleteError };
  }

  await revokeSchoolLeaderRoleIfOrphaned(admin, userId);

  const { data: grants, error: grantError } = await admin
    .from("user_permissions")
    .select("id, permissions!inner(key)")
    .eq("user_id", userId)
    .eq("scope_type", "program")
    .eq("scope_id", programId);
  if (grantError) return { data: null, error: grantError };

  const removedPermissionKeys: string[] = [];
  const grantIds: string[] = [];
  for (const row of (grants ?? []) as Array<{
    id: string;
    permissions: { key: string } | { key: string }[];
  }>) {
    const perm = Array.isArray(row.permissions) ? row.permissions[0] : row.permissions;
    if (perm?.key?.startsWith("schools.")) {
      grantIds.push(row.id);
      removedPermissionKeys.push(perm.key);
    }
  }

  if (grantIds.length > 0) {
    const { error: deleteGrantsError } = await admin
      .from("user_permissions")
      .delete()
      .in("id", grantIds);
    if (deleteGrantsError) return { data: null, error: deleteGrantsError };
  }

  return {
    data: { removedLeader, removedPermissionKeys },
    error: null,
  };
}
