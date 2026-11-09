// FFSA Hub — Program staff (migration 304).
//
// Staff are not leaders. A row here does not grant has_schools_access.
// These helpers back the Staff tab and the switch action. Callers pass
// an admin client for identity joins; authorization happens in the route.

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

/** Drop the staff row and clear this program's contact assignments. Atomic in the database. */
export async function removeProgramStaff(
  supabase: Client,
  programId: string,
  userId: string
) {
  const { error } = await supabase.rpc("remove_program_staff", {
    target_program_id: programId,
    target_user_id: userId,
  });
  return { error };
}

export type StaffSwitchResult = {
  removed_leader: boolean;
  removed_assignable: boolean;
};

export const SWITCH_NEEDS_ADMIN =
  "An admin is needed to move this person to staff.";

/** Map the database exception to an HTTP status. The message is the database's. */
export function switchFailure(message: string): { status: number; error: string } {
  if (message.includes("super admin")) {
    return { status: 400, error: "Refusing to switch a super admin" };
  }
  if (message.includes(SWITCH_NEEDS_ADMIN)) {
    return { status: 403, error: message };
  }
  if (message.includes("Not authorized") || message.includes("Not authenticated")) {
    return { status: 403, error: "Not authorized" };
  }
  return { status: 500, error: message };
}

/**
 * One database function. Adds staff, drops this program's leader row and
 * a program-scoped schools.assignable_as_contact, and clears contact
 * assignments. Other program-scoped schools.* grants are left in place
 * and block the call unless the caller is an admin.
 */
export async function switchPersonToProgramStaff(
  supabase: Client,
  programId: string,
  userId: string
): Promise<{ data: StaffSwitchResult | null; error: { message: string; status: number } | null }> {
  const { data, error } = await supabase.rpc("switch_person_to_program_staff", {
    target_program_id: programId,
    target_user_id: userId,
  });
  if (error) {
    const failure = switchFailure(error.message ?? "Could not move this person to staff");
    return { data: null, error: { message: failure.error, status: failure.status } };
  }
  return { data: data as StaffSwitchResult, error: null };
}
