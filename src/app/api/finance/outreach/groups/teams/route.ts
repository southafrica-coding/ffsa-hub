import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/finance/outreach-access";
import {
  addTeamToOutreachGroup,
  canManageOutreachGroupRpc,
  removeTeamFromOutreachGroup,
} from "@/services/outreach-groups";

// Putting a team in a group, or taking it out (migration 273). Outreach
// administrators may do it for any group, a manager only for the groups
// they manage — the database's can_manage_outreach_group() decides, here
// and again in RLS. A team taken out of a group drops out of that group's
// managers' access immediately.

const FORBIDDEN = "Only this group's managers, admins and finance staff can change its teams";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function mayManage(supabase: any, groupId: string): Promise<boolean> {
  const { data, error } = await canManageOutreachGroupRpc(supabase, groupId);
  return !error && data === true;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { group_id, team_id } = body ?? {};
  if (!isUuid(group_id) || !isUuid(team_id)) {
    return NextResponse.json({ error: "group_id and team_id are required" }, { status: 400 });
  }
  if (!(await mayManage(supabase, group_id))) {
    return NextResponse.json({ error: FORBIDDEN }, { status: 403 });
  }

  const { data, error } = await addTeamToOutreachGroup(supabase, {
    group_id,
    team_id,
    added_by: user.id,
  });
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "That team is already in this group" }, { status: 409 });
    }
    if (error.code === "23503") {
      return NextResponse.json({ error: "Team or group not found" }, { status: 404 });
    }
    if (error.code === "42501") {
      return NextResponse.json({ error: FORBIDDEN }, { status: 403 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, link: data });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const groupId = searchParams.get("group_id");
  const teamId = searchParams.get("team_id");
  if (!isUuid(groupId) || !isUuid(teamId)) {
    return NextResponse.json({ error: "group_id and team_id are required" }, { status: 400 });
  }
  if (!(await mayManage(supabase, groupId))) {
    return NextResponse.json({ error: FORBIDDEN }, { status: 403 });
  }

  const { data, error } = await removeTeamFromOutreachGroup(supabase, groupId, teamId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) {
    return NextResponse.json({ error: "That team isn't in this group" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
