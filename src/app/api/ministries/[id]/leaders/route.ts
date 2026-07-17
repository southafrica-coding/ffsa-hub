import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { callerIsAdmin } from "@/lib/auth/check-ministry-access";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ministryLeaderRoleId(admin: any): Promise<string | null> {
  const { data } = await admin
    .from("roles")
    .select("id")
    .eq("name", "ministry_leader")
    .single();
  return data?.id ?? null;
}

// Grant the ministry_leader role (global, no scope) if the user lacks it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureLeaderRole(admin: any, userId: string, assignedBy: string) {
  const roleId = await ministryLeaderRoleId(admin);
  if (!roleId) return;
  const { data: existing } = await admin
    .from("user_roles")
    .select("id")
    .eq("user_id", userId)
    .eq("role_id", roleId)
    .is("scope_type", null)
    .limit(1);
  if (!existing || existing.length === 0) {
    await admin
      .from("user_roles")
      .insert({ user_id: userId, role_id: roleId, assigned_by: assignedBy });
  }
}

// Revoke the ministry_leader role if the user no longer leads ANY ministry.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function revokeLeaderRoleIfOrphaned(admin: any, userId: string) {
  const { data: stillLeads } = await admin
    .from("staff_ministry_members")
    .select("id")
    .eq("user_id", userId)
    .eq("member_role", "leader")
    .limit(1);
  if (stillLeads && stillLeads.length > 0) return;
  const roleId = await ministryLeaderRoleId(admin);
  if (!roleId) return;
  await admin
    .from("user_roles")
    .delete()
    .eq("user_id", userId)
    .eq("role_id", roleId)
    .is("scope_type", null);
}

// Appoint a Ministry Leader. Admin-only (leaders don't create leaders).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await callerIsAdmin(supabase, user.id)))
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const targetUserId = body.user_id as string | undefined;
  if (!targetUserId)
    return NextResponse.json({ error: "user_id is required" }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient();
  // Upsert the membership as an active leader (promotes an existing member).
  const { error } = await admin.from("staff_ministry_members").upsert(
    {
      staff_ministry_id: id,
      user_id: targetUserId,
      member_role: "leader",
      status: "active",
      added_by: user.id,
      approved_by: user.id,
    },
    { onConflict: "staff_ministry_id,user_id" }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await ensureLeaderRole(admin, targetUserId, user.id);

  await admin.from("audit_logs").insert({
    user_id: user.id,
    action: "create",
    resource_type: "ministry_leaders",
    resource_id: id,
    changes: { ministry_id: id, leader: targetUserId },
  });

  return NextResponse.json({ success: true });
}

// Remove a Ministry Leader — demote to a plain member and clear their Point
// Leader flag; revoke the ministry_leader role if they lead nothing else.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await callerIsAdmin(supabase, user.id)))
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const targetUserId = body.user_id as string | undefined;
  if (!targetUserId)
    return NextResponse.json({ error: "user_id is required" }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient();
  const { error } = await admin
    .from("staff_ministry_members")
    .update({ member_role: "member", is_point_leader: false })
    .eq("staff_ministry_id", id)
    .eq("user_id", targetUserId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await revokeLeaderRoleIfOrphaned(admin, targetUserId);

  await admin.from("audit_logs").insert({
    user_id: user.id,
    action: "delete",
    resource_type: "ministry_leaders",
    resource_id: id,
    changes: { ministry_id: id, leader: targetUserId },
  });

  return NextResponse.json({ success: true });
}
