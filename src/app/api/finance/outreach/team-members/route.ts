import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  addTeamMember,
  updateTeamMemberRole,
  removeTeamMember,
  transferOutreachOwnership,
} from "@/services/outreach-finance";

// Who may do what is decided by RLS (migrations 260, 273): the owner adds and
// changes co-leaders, co-leaders and group managers add plain team members,
// finance staff can do either. A refused write comes back as an RLS error or
// zero rows.
const ROLES = ["co_leader", "team_member"];

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const { team_id, user_id } = body;
  const role = body.role || "team_member";

  if (!team_id || !user_id) {
    return NextResponse.json(
      { error: "team_id and user_id are required" },
      { status: 400 }
    );
  }
  if (!ROLES.includes(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  const { data, error } = await addTeamMember(supabase, { team_id, user_id, role });

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "User is already a member of this team" },
        { status: 409 }
      );
    }
    if (error.code === "42501") {
      return NextResponse.json(
        {
          error:
            role === "co_leader"
              ? "Only the outreach's owner can add co-leaders"
              : "Only the owner, co-leaders and group managers can add team members",
        },
        { status: 403 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, member: data });
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const { id, role } = body;

  // Hand the outreach over: that person becomes owner, the old owner a co-leader.
  if (body.make_owner) {
    if (!id || !body.team_id) {
      return NextResponse.json({ error: "id and team_id are required" }, { status: 400 });
    }
    const { error } = await transferOutreachOwnership(supabase, body.team_id, id);
    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: error.code === "42501" ? 403 : 400 }
      );
    }
    return NextResponse.json({ success: true });
  }

  if (!id || !role) {
    return NextResponse.json(
      { error: "id and role are required" },
      { status: 400 }
    );
  }
  if (!ROLES.includes(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  const { data, error } = await updateTeamMemberRole(supabase, id, role);

  if (error) {
    // PGRST116: no row came back, i.e. RLS hid it from this update.
    if (error.code === "PGRST116" || error.code === "42501") {
      return NextResponse.json(
        { error: "Only the outreach's owner can change roles" },
        { status: 403 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, member: data });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const { data, error } = await removeTeamMember(supabase, id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data?.length) {
    return NextResponse.json(
      { error: "You can't remove this person (the owner can't be removed; only the owner removes co-leaders)" },
      { status: 403 }
    );
  }

  return NextResponse.json({ success: true });
}
