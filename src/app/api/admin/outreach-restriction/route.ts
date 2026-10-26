import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { setOutreachRestriction } from "@/services/outreach-restrictions";
import { isUuid } from "@/lib/finance/outreach-access";

// Turn a person's "outreach limited to own teams" flag on or off (migration
// 274). Super Admins and General Admins only — checked here and again by
// the table's RLS (is_admin()). Their finance.view / finance.edit grants are
// never touched; the flag only stops those grants opening every outreach
// team.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: adminCheck } = await supabase
    .from("user_roles")
    .select("roles!inner(name)")
    .eq("user_id", authUser.id)
    .in("roles.name", ["super_admin", "admin"])
    .limit(1);
  if (!adminCheck || adminCheck.length === 0) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const userId = body?.user_id;
  const limited = body?.limited_to_own_teams;
  if (!isUuid(userId) || typeof limited !== "boolean") {
    return NextResponse.json(
      { error: "user_id and limited_to_own_teams (boolean) are required" },
      { status: 400 }
    );
  }

  const { data, error } = await setOutreachRestriction(supabase, {
    user_id: userId,
    limited_to_own_teams: limited,
    set_by: authUser.id,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await createAdminClient().from("audit_logs").insert({
    user_id: authUser.id,
    action: "update",
    resource_type: "outreach_user_restrictions",
    resource_id: userId,
    changes: { limited_to_own_teams: limited },
  });

  return NextResponse.json({ success: true, restriction: data });
}
