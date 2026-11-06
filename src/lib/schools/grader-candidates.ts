import { canBeCourseGrader } from "./learning-course";

// People a program manager may assign as graders for THIS school.
// Not a directory of every Hub user. Someone is included only when they are
// attached to the program (a school leader, a role scoped to the program, or
// a permission scoped to the program) and canBeCourseGrader is true
// (staff or another elevated role, not a student-only account).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type GraderCandidate = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
};

const CAP = 200;

export async function fetchGraderCandidates(
  admin: Client,
  programId: string
): Promise<{ data: GraderCandidate[]; error: { code?: string; message?: string } | null }> {
  const [leaders, scopedRoles, scopedPerms] = await Promise.all([
    admin.from("program_leaders").select("user_id").eq("program_id", programId),
    admin.from("user_roles").select("user_id").eq("scope_type", "program").eq("scope_id", programId),
    admin.from("user_permissions").select("user_id").eq("scope_type", "program").eq("scope_id", programId),
  ]);
  for (const result of [leaders, scopedRoles, scopedPerms]) {
    if (result.error) return { data: [], error: result.error };
  }

  const ids = [
    ...new Set(
      [leaders.data, scopedRoles.data, scopedPerms.data]
        .flatMap((rows) => (rows ?? []) as Array<{ user_id?: string }>)
        .map((row) => row.user_id)
        .filter((id): id is string => typeof id === "string")
    ),
  ]
    .sort()
    .slice(0, CAP);

  if (ids.length === 0) return { data: [], error: null };

  const [users, roleRows] = await Promise.all([
    admin.from("users").select("id, first_name, last_name, preferred_name, is_active").in("id", ids),
    admin.from("user_roles").select("user_id, roles(name)").in("user_id", ids),
  ]);
  if (users.error) return { data: [], error: users.error };
  if (roleRows.error) return { data: [], error: roleRows.error };

  const rolesByUser = new Map<string, string[]>();
  for (const row of (roleRows.data ?? []) as Array<{
    user_id: string;
    roles: { name: string } | { name: string }[] | null;
  }>) {
    const names = Array.isArray(row.roles)
      ? row.roles.map((role) => role.name)
      : row.roles
        ? [row.roles.name]
        : [];
    rolesByUser.set(row.user_id, [...(rolesByUser.get(row.user_id) ?? []), ...names]);
  }

  const candidates = ((users.data ?? []) as Array<GraderCandidate & { is_active?: boolean | null }>)
    .filter((user) => user.is_active !== false && canBeCourseGrader(rolesByUser.get(user.id) ?? []))
    .map((user) => ({
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      preferred_name: user.preferred_name,
    }))
    .sort((a, b) => display(a).localeCompare(display(b)));

  return { data: candidates, error: null };
}

function display(person: GraderCandidate): string {
  return `${person.preferred_name || person.first_name || ""} ${person.last_name || ""}`.trim().toLowerCase();
}
