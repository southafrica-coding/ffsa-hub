import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import { callerCanAmendCheckin } from "@/lib/auth/check-okr-access";
import { deleteCheckin, updateCheckin } from "@/services/okrs";
import { OKR_STATUSES } from "@/types/okrs";

type Params = { params: Promise<{ id: string }> };

/**
 * A check-in is a log entry, not a field. Only its author or an admin may
 * amend or remove one — enforced by the RLS policies on okr_checkins
 * (migration 271), and asked up front here so a refusal is a clean 403.
 */
export async function PATCH(request: Request, { params }: Params) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  if (!(await callerCanAmendCheckin(supabase, user.id, id))) {
    return NextResponse.json({ error: "You cannot edit this check-in" }, { status: 403 });
  }
  const body = await request.json();

  const patch: Record<string, unknown> = {};
  if ("status" in body) {
    if (!OKR_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: "A valid status is required" }, { status: 400 });
    }
    patch.status = body.status;
  }
  if ("comment" in body) patch.comment = body.comment?.trim() || null;
  if ("value" in body) {
    const hasValue = body.value !== null && body.value !== undefined && body.value !== "";
    if (hasValue && !Number.isFinite(Number(body.value))) {
      return NextResponse.json({ error: "The figure must be a number" }, { status: 400 });
    }
    patch.value = hasValue ? Number(body.value) : null;
  }
  if ("checkin_on" in body) patch.checkin_on = body.checkin_on;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { data, error } = await updateCheckin(supabase, id, patch);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) {
    return NextResponse.json({ error: "You cannot edit this check-in" }, { status: 403 });
  }
  return NextResponse.json({ success: true, checkin: data });
}

export async function DELETE(_request: Request, { params }: Params) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  if (!(await callerCanAmendCheckin(supabase, user.id, id))) {
    return NextResponse.json({ error: "You cannot delete this check-in" }, { status: 403 });
  }

  const { data, error } = await deleteCheckin(supabase, id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // RLS refuses a delete by matching no rows, not by erroring.
  if (!data?.length) {
    return NextResponse.json({ error: "You cannot delete this check-in" }, { status: 403 });
  }

  // Removing the last check-in resets the key result to "not started" — the
  // refresh_okr_key_result_state trigger handles that.
  return NextResponse.json({ success: true });
}
