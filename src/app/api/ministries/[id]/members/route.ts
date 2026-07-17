import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { callerLeadsMinistry } from "@/lib/auth/check-ministry-access";

// Add a staff member to a ministry. Admins (any ministry) or a Ministry
// Leader (their own). Admin/leader adds land active immediately.
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
  if (!(await callerLeadsMinistry(supabase, user.id, id)))
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const targetUserId = body.user_id as string | undefined;
  if (!targetUserId)
    return NextResponse.json({ error: "user_id is required" }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient();
  const { error } = await admin.from("staff_ministry_members").insert({
    staff_ministry_id: id,
    user_id: targetUserId,
    member_role: "member",
    status: "active",
    added_by: user.id,
    approved_by: user.id,
  });
  if (error) {
    const msg =
      error.code === "23505" ? "That person is already in this ministry" : error.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}

// Approve a pending membership. Admins or a Ministry Leader of this ministry.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await callerLeadsMinistry(supabase, user.id, id)))
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const membershipId = body.membership_id as string | undefined;
  if (!membershipId)
    return NextResponse.json({ error: "membership_id is required" }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient();
  const { error } = await admin
    .from("staff_ministry_members")
    .update({ status: "active", approved_by: user.id })
    .eq("id", membershipId)
    .eq("staff_ministry_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}

// Remove a member from the ministry. Leaders are removed via the leaders
// route (this only touches member rows), so role sync stays in one place.
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
  if (!(await callerLeadsMinistry(supabase, user.id, id)))
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const membershipId = body.membership_id as string | undefined;
  if (!membershipId)
    return NextResponse.json({ error: "membership_id is required" }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient();
  const { data: deleted, error } = await admin
    .from("staff_ministry_members")
    .delete()
    .eq("id", membershipId)
    .eq("staff_ministry_id", id)
    .eq("member_role", "member")
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!deleted || deleted.length === 0)
    return NextResponse.json(
      { error: "That person is a leader — remove them as leader first" },
      { status: 400 }
    );

  return NextResponse.json({ success: true });
}
