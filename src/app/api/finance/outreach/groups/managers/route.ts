import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canManageOutreachTeams } from "@/lib/finance/outreach-team-admin";
import { isUuid } from "@/lib/finance/outreach-access";
import {
  addOutreachGroupManager,
  removeOutreachGroupManager,
} from "@/services/outreach-groups";

// Assigning and unassigning group managers (migration 273): outreach
// administrators only. Managers cannot appoint other managers. Checked
// here and again by RLS.

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  if (!(await canManageOutreachTeams(supabase))) {
    return {
      error: NextResponse.json(
        { error: "Only admins and finance staff can assign group managers" },
        { status: 403 }
      ),
    };
  }
  return { supabase, user };
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => ({}));
  const { group_id, user_id } = body ?? {};
  if (!isUuid(group_id) || !isUuid(user_id)) {
    return NextResponse.json({ error: "group_id and user_id are required" }, { status: 400 });
  }

  const { data, error } = await addOutreachGroupManager(auth.supabase, {
    group_id,
    user_id,
    added_by: auth.user.id,
  });
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "They already manage this group" }, { status: 409 });
    }
    if (error.code === "23503") {
      return NextResponse.json({ error: "Person or group not found" }, { status: 404 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, manager: data });
}

export async function DELETE(request: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);
  const groupId = searchParams.get("group_id");
  const userId = searchParams.get("user_id");
  if (!isUuid(groupId) || !isUuid(userId)) {
    return NextResponse.json({ error: "group_id and user_id are required" }, { status: 400 });
  }

  const { data, error } = await removeOutreachGroupManager(auth.supabase, groupId, userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) {
    return NextResponse.json({ error: "They don't manage this group" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
