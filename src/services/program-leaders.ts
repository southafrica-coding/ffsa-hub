// FFSA Hub — Program (school) leader teams (migration 145).
//
// A school is led by a team: any number of users can be named leaders of
// a program, and that membership grants them program-scoped schools
// access (see has_schools_access in the migration). These helpers back
// the "Leaders" management UI on the program page and the add/remove API.
//
// Reads join the five safe identity columns on users; callers pass an
// admin client (the program page is already admin-gated and reads user
// identities that way) to sidestep the users-PII RLS.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type ProgramLeader = {
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

export async function listProgramLeaders(admin: Client, programId: string) {
  return admin
    .from("program_leaders")
    .select(
      "id, user_id, created_at, users:user_id(id, first_name, last_name, email)"
    )
    .eq("program_id", programId)
    .order("created_at", { ascending: true });
}

/** Add a leader to a program. Idempotent on (program_id, user_id). */
export async function addProgramLeader(
  admin: Client,
  programId: string,
  userId: string,
  addedBy: string
) {
  return admin
    .from("program_leaders")
    .upsert(
      { program_id: programId, user_id: userId, added_by: addedBy },
      { onConflict: "program_id,user_id", ignoreDuplicates: true }
    );
}

export async function removeProgramLeader(
  admin: Client,
  programId: string,
  userId: string
) {
  return admin
    .from("program_leaders")
    .delete()
    .eq("program_id", programId)
    .eq("user_id", userId);
}
