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
// Three modes, keyed off the body:
//   - { membership_id, subcategory_ids } → REPLACE the person's whole set of
//     sub-categories (migration 205 — a member can be in several). An empty
//     array moves them back to Uncategorized. Set-replace rather than
//     add/remove ops: it is idempotent, matches the checkbox UI, and avoids a
//     lost update when two leaders edit at once.
//   - { membership_id, subcategory_id }  → the old single-value form, kept as
//     a thin alias for [id] / [] so existing callers keep working.
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

  // Sub-category assignment vs. approval. The single-value form collapses
  // into the set form so there is only one code path below.
  const assigning = "subcategory_ids" in body || "subcategory_id" in body;
  let wanted: string[] = [];
  if (assigning) {
    if ("subcategory_ids" in body) {
      if (!Array.isArray(body.subcategory_ids))
        return NextResponse.json(
          { error: "subcategory_ids must be an array" },
          { status: 400 }
        );
      wanted = (body.subcategory_ids as unknown[]).filter(
        (v): v is string => typeof v === "string"
      );
    } else if (body.subcategory_id) {
      wanted = [body.subcategory_id as string];
    }
    wanted = [...new Set(wanted)];
  }

  if (!assigning) {
    const { error } = await admin
      .from("staff_ministry_members")
      .update({ status: "active", approved_by: user.id })
      .eq("id", membershipId)
      .eq("staff_ministry_id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ success: true });
  }

  // The membership must belong to THIS ministry — the join table is keyed on
  // membership_id alone, so this is the only thing scoping the write.
  const { data: membership } = await admin
    .from("staff_ministry_members")
    .select("id")
    .eq("id", membershipId)
    .eq("staff_ministry_id", id)
    .maybeSingle();
  if (!membership)
    return NextResponse.json({ error: "Membership not found" }, { status: 404 });

  // Guard: every sub-category must belong to THIS ministry (the FK only checks
  // existence, so this stops one ministry tagging with another's id).
  if (wanted.length > 0) {
    const { data: subs } = await admin
      .from("staff_ministry_subcategories")
      .select("id")
      .eq("staff_ministry_id", id)
      .in("id", wanted);
    if (!subs || subs.length !== wanted.length)
      return NextResponse.json({ error: "That category no longer exists" }, { status: 400 });
  }

  // Replace the set: drop the links that are no longer wanted, then add the
  // new ones. Upsert-ignore so an unchanged link keeps its is_point_leader.
  const dropQuery = admin
    .from("staff_ministry_member_subcategories")
    .delete()
    .eq("membership_id", membershipId);
  const { error: dropError } = await (wanted.length > 0
    ? dropQuery.not("subcategory_id", "in", `(${wanted.join(",")})`)
    : dropQuery);
  if (dropError)
    return NextResponse.json({ error: dropError.message }, { status: 400 });

  if (wanted.length > 0) {
    const { error: addError } = await admin
      .from("staff_ministry_member_subcategories")
      .upsert(
        wanted.map((subcategoryId) => ({
          membership_id: membershipId,
          subcategory_id: subcategoryId,
        })),
        { onConflict: "membership_id,subcategory_id", ignoreDuplicates: true }
      );
    if (addError) {
      // FK violation → the sub-category was deleted between the check and here.
      const msg =
        addError.code === "23503" ? "That category no longer exists" : addError.message;
      return NextResponse.json({ error: msg }, { status: 400 });
    }
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
