import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  createOutreachTeam,
  deleteOutreachTeam,
  getOutreachTeamDeleteBlockers,
  updateOutreachTeam,
} from "@/services/outreach-finance";
import {
  ARCHIVE_FIELDS,
  CREATE_TEAM_FIELDS,
  canManageOutreachTeams,
  describeDeleteBlockers,
  isSafeToDelete,
  type DeleteBlockers,
} from "@/lib/finance/outreach-team-admin";

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

  // Only the team's own columns: a new team can't arrive already archived.
  const fields: Record<string, unknown> = {};
  for (const key of CREATE_TEAM_FIELDS) {
    if (body[key] !== undefined) fields[key] = body[key];
  }

  // Anyone may start an outreach; they become its owner (migration 260).
  // A school is optional.
  const { data, error } = await createOutreachTeam(supabase, {
    ...(fields as { team_name: string }),
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

  // Archiving goes through /teams/archive, never a plain update.
  for (const key of ARCHIVE_FIELDS) delete updateData[key];

  const { data, error } = await updateOutreachTeam(supabase, id, updateData);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, team: data });
}

/**
 * Delete a team — outreach administrators only, and only when nothing would
 * be lost. A team with people or money records gets 409 and `archive: true`
 * so the client can offer Archive instead.
 */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const id: string | undefined = body?.id;
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  if (!(await canManageOutreachTeams(supabase))) {
    return NextResponse.json(
      { error: "Only admins and finance staff can delete outreach teams" },
      { status: 403 }
    );
  }

  const { data: blockers, error: checkError } = await getOutreachTeamDeleteBlockers(supabase, id);
  if (checkError) {
    return NextResponse.json({ error: checkError.message }, { status: 500 });
  }
  if (!isSafeToDelete(blockers as DeleteBlockers | null)) {
    return NextResponse.json(
      {
        error: "This team has linked records, so it can't be deleted. Archive it instead.",
        archive: true,
        blockers: describeDeleteBlockers(blockers as DeleteBlockers | null),
      },
      { status: 409 }
    );
  }

  const { error } = await deleteOutreachTeam(supabase, id);
  if (error) {
    // The database re-checks inside the delete; something linked in between.
    const linked = error.code === "23503";
    return NextResponse.json(
      linked
        ? { error: "This team has linked records, so it can't be deleted. Archive it instead.", archive: true }
        : { error: error.message },
      { status: linked ? 409 : error.code === "P0002" ? 404 : 500 }
    );
  }

  return NextResponse.json({ success: true });
}
