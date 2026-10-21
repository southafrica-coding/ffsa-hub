import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createOutreachTeam, updateOutreachTeam } from "@/services/outreach-finance";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const { team_name } = body;

  if (!team_name) {
    return NextResponse.json({ error: "team_name is required" }, { status: 400 });
  }

  // Anyone may start an outreach; they become its owner (migration 260).
  // A school is optional.
  const { data, error } = await createOutreachTeam(supabase, {
    ...body,
    program_id: body.program_id || null,
    created_by: user.id,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, team: data });
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
  const { id, ...updateData } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const { data, error } = await updateOutreachTeam(supabase, id, updateData);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, team: data });
}
