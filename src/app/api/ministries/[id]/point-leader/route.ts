import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { callerLeadsMinistry } from "@/lib/auth/check-ministry-access";

// Set (or clear) the Point Leader — a display-only "primary" marker on one of
// the ministry's leaders. Admins or a Ministry Leader of this ministry.
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
  const targetUserId = body.user_id as string | null | undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient();

  // Clear the current flag first (partial unique index allows only one).
  const { error: clearError } = await admin
    .from("staff_ministry_members")
    .update({ is_point_leader: false })
    .eq("staff_ministry_id", id)
    .eq("is_point_leader", true);
  if (clearError) return NextResponse.json({ error: clearError.message }, { status: 500 });

  // null user_id = just clear the Point Leader.
  if (!targetUserId) return NextResponse.json({ success: true });

  // Set the new one — must be an existing leader of this ministry.
  const { data: updated, error } = await admin
    .from("staff_ministry_members")
    .update({ is_point_leader: true })
    .eq("staff_ministry_id", id)
    .eq("user_id", targetUserId)
    .eq("member_role", "leader")
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!updated || updated.length === 0)
    return NextResponse.json(
      { error: "That person must be a leader of this ministry first" },
      { status: 400 }
    );

  return NextResponse.json({ success: true });
}
