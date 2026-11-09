// Shared helper for resolving "who can be assigned as a point of contact"
// for a given program. Used by the staff-pickable API, the program detail
// server component, and the assignment routes (applications + enrollments).
//
// Eligibility, any of:
//   1. The user was EXPLICITLY granted the dedicated
//      `schools.assignable_as_contact` permission SCOPED TO THIS EXACT
//      PROGRAM. This permission is always program-scoped — a grant for
//      program A makes the user assignable for program A only. Holding other
//      schools permissions (manage, approve_applications, etc.) does NOT make
//      someone assignable.
//   2. The user is a super_admin. Super admins can manage/assign every
//      program (see userCanManageApplications), so they are always selectable
//      as a contact regardless of per-program grants.
//   3. The user is an active leader of THIS program. The Leaders tab stores
//      leaders as rows in program_leaders (migration 145) and deletes the row
//      to remove someone — there is no status, pending, or removed column.
//      A current row is an active leader, and only for that program_id.
//      A leader of program A is not assignable for program B.
//   4. The user is active staff of THIS program (program_staff, migration
//      304). Same shape as leaders: the row is the membership, and it does
//      not make them assignable for any other program.
//
// User must also be active (users.is_active is not false). A deactivated
// account is dropped on every path, including leaders and super admins.

export const ASSIGNABLE_CONTACT_PERMISSION_KEY = "schools.assignable_as_contact";

export const NOT_ASSIGNABLE_CONTACT_ERROR =
  "That person cannot be assigned to this school";

type AdminClient = {
  from: (t: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export type AssignableContact = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  email: string | null;
};

type ContactRow = AssignableContact & { is_active: boolean | null };

export async function fetchAssignableContacts(
  adminSupabase: AdminClient,
  programId: string
): Promise<AssignableContact[]> {
  const seen = new Map<string, AssignableContact>();

  const add = (u: ContactRow | null) => {
    if (!u || u.is_active === false) return;
    if (!seen.has(u.id)) {
      seen.set(u.id, {
        id: u.id,
        first_name: u.first_name,
        last_name: u.last_name,
        preferred_name: u.preferred_name,
        email: u.email,
      });
    }
  };

  // 1. Users explicitly granted the assignable-as-contact permission for this
  //    program.
  const { data: permRows } = await adminSupabase
    .from("user_permissions")
    .select(
      "user_id, scope_id, scope_type, permissions!inner(key), users!user_permissions_user_id_fkey!inner(id, first_name, last_name, preferred_name, email, is_active)"
    )
    .eq("permissions.key", ASSIGNABLE_CONTACT_PERMISSION_KEY)
    .eq("scope_type", "program")
    .eq("scope_id", programId);

  for (const row of (permRows ?? []) as Array<{ users: ContactRow }>) {
    add(row.users);
  }

  // 2. Super admins — always assignable on every program.
  const { data: superRows } = await adminSupabase
    .from("user_roles")
    .select(
      "user_id, roles!inner(name), users!user_roles_user_id_fkey!inner(id, first_name, last_name, preferred_name, email, is_active)"
    )
    .eq("roles.name", "super_admin");

  for (const row of (superRows ?? []) as Array<{ users: ContactRow }>) {
    add(row.users);
  }

  // 3. Active leaders of this program only. Membership is the row; removal
  //    deletes it, so a removed leader has nothing to join. Deactivated
  //    users are dropped by add().
  const { data: leaderRows } = await adminSupabase
    .from("program_leaders")
    .select(
      "user_id, program_id, users:user_id(id, first_name, last_name, preferred_name, email, is_active)"
    )
    .eq("program_id", programId);

  for (const row of (leaderRows ?? []) as Array<{ users: ContactRow | ContactRow[] | null }>) {
    const user = Array.isArray(row.users) ? row.users[0] ?? null : row.users;
    add(user);
  }

  // 4. Active staff of this program only. Same membership rule as leaders.
  const { data: staffRows } = await adminSupabase
    .from("program_staff")
    .select(
      "user_id, program_id, users:user_id(id, first_name, last_name, preferred_name, email, is_active)"
    )
    .eq("program_id", programId);

  for (const row of (staffRows ?? []) as Array<{ users: ContactRow | ContactRow[] | null }>) {
    const user = Array.isArray(row.users) ? row.users[0] ?? null : row.users;
    add(user);
  }

  return Array.from(seen.values()).sort((a, b) =>
    `${a.first_name ?? ""} ${a.last_name ?? ""}`
      .toLowerCase()
      .localeCompare(`${b.first_name ?? ""} ${b.last_name ?? ""}`.toLowerCase())
  );
}

/** Same rules as fetchAssignableContacts, for one user. */
export async function userIsAssignableContact(
  adminSupabase: AdminClient,
  programId: string,
  userId: string
): Promise<boolean> {
  if (!programId || !userId) return false;
  const contacts = await fetchAssignableContacts(adminSupabase, programId);
  return contacts.some((c) => c.id === userId);
}

/**
 * Null when this id may be saved as the assigned contact.
 * A null userId clears the assignment and is always allowed.
 */
export async function unassignableContactError(
  adminSupabase: AdminClient,
  programId: string,
  userId: string | null
): Promise<string | null> {
  if (!userId) return null;
  const ok = await userIsAssignableContact(adminSupabase, programId, userId);
  return ok ? null : NOT_ASSIGNABLE_CONTACT_ERROR;
}
