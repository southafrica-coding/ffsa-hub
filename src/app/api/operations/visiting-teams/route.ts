import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanTeamPatch, isStage, PRIVATE_FIELDS, stepsForTeam } from "@/lib/operations/visiting-teams";
import { listOpsTeam } from "@/services/operations";
import { createTeam, deleteTeam, insertSteps, isVisitingTeamsLead, savePrivate } from "@/services/visiting-teams";

// POST /api/operations/visiting-teams — add a team, with Mache's checklist.
// Only the Visiting teams lead adds teams (RLS enforces it too).
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await isVisitingTeamsLead(supabase))) {
    return NextResponse.json({ error: "Only the Visiting teams lead can add a team" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof body.name !== "string" || body.name.trim().length < 2) {
    return NextResponse.json({ error: "The team needs a name" }, { status: 400 });
  }
  const cleaned = cleanTeamPatch(body);
  if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });

  const stage = body.stage === undefined ? "enquiry" : body.stage;
  if (!isStage(stage)) return NextResponse.json({ error: "Unknown stage" }, { status: 400 });

  const host = body.host_user_id ? String(body.host_user_id) : user.id;
  const team = await listOpsTeam(createAdminClient());
  if (!team.some((p) => p.id === host) && host !== user.id) {
    return NextResponse.json({ error: "The host must be on the Operations team" }, { status: 400 });
  }

  const { data: row, error } = await createTeam(supabase, { ...cleaned.patch, stage, host_user_id: host });
  if (error || !row) return NextResponse.json({ error: error?.message ?? "Couldn't add the team" }, { status: 500 });

  const { error: stepsError } = await insertSteps(supabase, row.id, stepsForTeam(row));
  if (stepsError) {
    await deleteTeam(supabase, row.id);
    return NextResponse.json({ error: stepsError.message }, { status: 500 });
  }

  const priv: Record<string, string | null> = {};
  for (const k of PRIVATE_FIELDS) if (typeof body[k] === "string" && (body[k] as string).trim()) priv[k] = (body[k] as string).trim();
  if (Object.keys(priv).length) {
    const { error: privError } = await savePrivate(supabase, row.id, priv);
    if (privError) return NextResponse.json({ success: true, id: row.id, warning: "Team added, but the private details didn't save" });
  }

  return NextResponse.json({ success: true, id: row.id });
}
