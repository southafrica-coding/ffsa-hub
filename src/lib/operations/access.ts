// Who is on the operations team.
//
// Operations is a DEPARTMENT (Jack's Departments & Services model): the
// staff ministry with slug `operations`. Its active members and leaders
// are the team. Admins pass, and the operations.team key covers a helper
// from outside the department. Mirrors public.is_ops_team() (migration 400).

import { hasModuleAccess } from "@/lib/require-permission";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export const OPERATIONS_DEPARTMENT_SLUG = "operations";

/** Active member or leader of the Operations department. */
export async function isOperationsMember(client: Client, userId: string): Promise<boolean> {
  const { data, error } = await client
    .from("staff_ministry_members")
    .select("id, staff_ministries!inner(slug, is_active)")
    .eq("user_id", userId)
    .eq("status", "active")
    .eq("staff_ministries.slug", OPERATIONS_DEPARTMENT_SLUG)
    .eq("staff_ministries.is_active", true)
    .limit(1);
  if (error) return false;
  return ((data as unknown[] | null)?.length ?? 0) > 0;
}

/** Admin, operations.team holder, or Operations department member. Inactive accounts never pass. */
export async function isOpsTeam(client: Client, userId: string): Promise<boolean> {
  if (await hasModuleAccess(client, userId, "operations")) return true;
  const { data: user } = await client.from("users").select("is_active").eq("id", userId).maybeSingle();
  if (!user || user.is_active === false) return false;
  return isOperationsMember(client, userId);
}
