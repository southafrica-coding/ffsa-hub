import { addUserToBaseCalendar, removeUserFromBaseCalendar } from "@/lib/google/calendar";

// Sets a user's single "membership" role. The three membership roles are
// mutually exclusive (staff / student / community); setting one removes the
// others and keeps the self_service floor. "none" strips all three (leaving
// just self_service).
//
// Department rule: only staff (or other elevated roles) may carry a
// department — so if the user ends up membership-only, their department is
// cleared.
//
// Callers do their own authorization first: the Users list route is super
// admin only; the Leadership Track staff-decision route is Leadership Team
// and only for a recorded "yes". Pass the service-role client.

export const MEMBERSHIP_ROLE_KEYS = ["staff", "student", "community", "none"] as const;
export type MembershipRoleKey = (typeof MEMBERSHIP_ROLE_KEYS)[number];

const ROLE_BY_KEY = {
  staff: "staff",
  student: "student",
  community: "community_member",
} as const;

const MEMBERSHIP_ROLE_NAMES = ["staff", "student", "community_member"];
const MEMBERSHIP_ONLY = new Set(["student", "community_member", "self_service"]);

type Client = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export async function setMembershipRole(
  admin: Client,
  userId: string,
  role: MembershipRoleKey,
  actorId: string
): Promise<{ roleNames: string[] }> {
  const { data: roleRows } = await admin
    .from("roles")
    .select("id, name")
    .in("name", [...MEMBERSHIP_ROLE_NAMES, "self_service"]);
  const idByName: Record<string, string> = {};
  for (const r of (roleRows ?? []) as Array<{ id: string; name: string }>) {
    idByName[r.name] = r.id;
  }

  // Clear the three membership roles (unscoped), then grant the selected one.
  const membershipIds = MEMBERSHIP_ROLE_NAMES.map((n) => idByName[n]).filter(Boolean);
  if (membershipIds.length > 0) {
    await admin
      .from("user_roles")
      .delete()
      .eq("user_id", userId)
      .in("role_id", membershipIds);
  }

  // Only insert what they don't already hold. The delete above clears the
  // three membership roles, but NOT self_service — nearly everyone already has
  // an unscoped self_service row, so re-inserting it blindly duplicated it
  // (NULL scope columns never match a conflict target, so the upsert's
  // ON CONFLICT never fired). Migration 209 makes that a hard error, and a
  // multi-row insert aborts as a unit — which would silently drop the
  // membership change too.
  const targetName = role === "none" ? null : ROLE_BY_KEY[role];
  const wanted = [targetName, "self_service"].filter(
    (n): n is string => !!n && !!idByName[n]
  );

  const { data: heldRows } = await admin
    .from("user_roles")
    .select("role_id")
    .eq("user_id", userId)
    .is("scope_type", null)
    .is("scope_id", null);
  const held = new Set(
    ((heldRows ?? []) as { role_id: string }[]).map((r) => r.role_id)
  );

  const toGrant = wanted
    .map((n) => idByName[n])
    .filter((roleId) => !held.has(roleId));
  if (toGrant.length > 0) {
    await admin.from("user_roles").insert(
      toGrant.map((roleId) => ({
        user_id: userId,
        role_id: roleId,
        scope_type: null,
        scope_id: null,
        assigned_by: actorId,
      }))
    );
  }

  // Department rule: clear the department unless the user still holds an
  // elevated (non-membership) role.
  const { data: afterRows } = await admin
    .from("user_roles")
    .select("roles!inner(name)")
    .eq("user_id", userId);
  const names = ((afterRows ?? []) as Array<{ roles: { name: string } | { name: string }[] }>)
    .map((r) => (Array.isArray(r.roles) ? r.roles[0]?.name : r.roles?.name))
    .filter((n): n is string => !!n);
  const isElevated = names.some((n) => !MEMBERSHIP_ONLY.has(n));
  if (!isElevated) {
    await admin.from("users").update({ department: null }).eq("id", userId);
  }

  await admin.from("audit_logs").insert({
    user_id: actorId,
    action: "update",
    resource_type: "user_roles",
    resource_id: userId,
    changes: { membership_role: role },
  });

  try {
    const { data: u } = await admin
      .from("users")
      .select("email")
      .eq("id", userId)
      .maybeSingle();
    if (u?.email) {
      if (names.includes("staff")) await addUserToBaseCalendar(u.email);
      else await removeUserFromBaseCalendar(u.email);
    }
  } catch (err) {
    console.error("[google-calendar] membership sync failed", err);
  }

  return { roleNames: names };
}
