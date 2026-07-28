import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { callerIsSuperAdmin } from "@/lib/auth/check-role-grant";

// Sets a user's single "membership" role from the Users list. The three
// membership roles are mutually exclusive here (staff / student / community);
// selecting one removes the others and keeps the self_service floor. "none"
// strips all three (leaving just self_service).
//
// Department rule: only staff (or other elevated roles) may carry a
// department — so if the user ends up membership-only, their department is
// cleared.

const ROLE_BY_KEY = {
  staff: "staff",
  student: "student",
  community: "community_member",
} as const;

const MEMBERSHIP_ROLE_NAMES = ["staff", "student", "community_member"];
const MEMBERSHIP_ONLY = new Set(["student", "community_member", "self_service"]);

type Key = keyof typeof ROLE_BY_KEY | "none";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!(await callerIsSuperAdmin(supabase, authUser.id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const { user_id, role } = body as { user_id?: string; role?: Key };
  if (!user_id || !role || !["staff", "student", "community", "none"].includes(role)) {
    return NextResponse.json(
      { error: "user_id and role (staff|student|community|none) are required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

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
      .eq("user_id", user_id)
      .in("role_id", membershipIds);
  }

  const targetName = role === "none" ? null : ROLE_BY_KEY[role];
  const toGrant = [targetName, "self_service"].filter(
    (n): n is string => !!n && !!idByName[n]
  );
  if (toGrant.length > 0) {
    await admin.from("user_roles").upsert(
      toGrant.map((n) => ({
        user_id,
        role_id: idByName[n],
        scope_type: null,
        scope_id: null,
        assigned_by: authUser.id,
      })),
      { onConflict: "user_id,role_id,scope_type,scope_id", ignoreDuplicates: true }
    );
  }

  // Department rule: clear the department unless the user still holds an
  // elevated (non-membership) role.
  const { data: afterRows } = await admin
    .from("user_roles")
    .select("roles!inner(name)")
    .eq("user_id", user_id);
  const names = ((afterRows ?? []) as Array<{ roles: { name: string } | { name: string }[] }>)
    .map((r) => (Array.isArray(r.roles) ? r.roles[0]?.name : r.roles?.name))
    .filter((n): n is string => !!n);
  const isElevated = names.some((n) => !MEMBERSHIP_ONLY.has(n));
  if (!isElevated) {
    // department isn't in the (stale) generated users type yet; cast to match
    // the codebase pattern.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any).from("users").update({ department: null }).eq("id", user_id);
  }

  await admin.from("audit_logs").insert({
    user_id: authUser.id,
    action: "update",
    resource_type: "user_roles",
    resource_id: user_id,
    changes: { membership_role: role },
  });

  return NextResponse.json({ success: true });
}
