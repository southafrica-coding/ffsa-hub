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

// Update a membership. Admins or a Ministry Leader of this ministry.
// Two modes, keyed off the body:
//   - { membership_id, subcategory_id }  → move the person into a sub-category
//     (subcategory_id may be null to move them back to Uncategorized).
//   - { membership_id }                  → approve a pending membership.
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

  // Sub-category assignment vs. approval.
  const assigning = "subcategory_id" in body;
  const subcategoryId = assigning ? ((body.subcategory_id as string | null) ?? null) : null;

  // Guard: a non-null sub-category must belong to THIS ministry (the FK only
  // checks existence, so this stops one ministry tagging with another's id).
  if (assigning && subcategoryId) {
    const { data: sub } = await admin
      .from("staff_ministry_subcategories")
      .select("id")
      .eq("id", subcategoryId)
      .eq("staff_ministry_id", id)
      .maybeSingle();
    if (!sub)
      return NextResponse.json({ error: "That category no longer exists" }, { status: 400 });
  }

  const update = assigning
    ? { subcategory_id: subcategoryId }
    : { status: "active", approved_by: user.id };

  const { error } = await admin
    .from("staff_ministry_members")
    .update(update)
    .eq("id", membershipId)
    .eq("staff_ministry_id", id);
  if (error) {
    // FK violation → the sub-category doesn't belong to this ministry (or was deleted).
    const msg =
      error.code === "23503" ? "That category no longer exists" : error.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }

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
