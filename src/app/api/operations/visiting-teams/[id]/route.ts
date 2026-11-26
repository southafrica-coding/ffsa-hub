import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CHECKLIST, cleanTeamPatch, dueFor, isStage, PRIVATE_FIELDS } from "@/lib/operations/visiting-teams";
import { listOpsTeam } from "@/services/operations";
import { deleteTeam, getTeam, isVisitingTeamsLead, savePrivate, setStepDue, updateTeam } from "@/services/visiting-teams";

// PATCH /api/operations/visiting-teams/[id] — change any detail, the stage,
// the host (lead only) or the private details. Every change is kept in the
// team's history by the database. When arrival or departure moves, the
// checklist dates that hang off them move too.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: current } = await getTeam(supabase, id);
  if (!current) return NextResponse.json({ error: "Team not found" }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const cleaned = cleanTeamPatch(body, current);
  if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });
  const patch: Record<string, unknown> = { ...cleaned.patch };

  if (body.stage !== undefined) {
    if (!isStage(body.stage)) return NextResponse.json({ error: "Unknown stage" }, { status: 400 });
    patch.stage = body.stage;
  }

  if (body.host_user_id !== undefined) {
    if (!(await isVisitingTeamsLead(supabase))) {
      return NextResponse.json({ error: "Only the Visiting teams lead can hand a team to another host" }, { status: 403 });
    }
    const host = body.host_user_id ? String(body.host_user_id) : null;
    if (host && !(await listOpsTeam(createAdminClient())).some((p) => p.id === host)) {
      return NextResponse.json({ error: "The host must be on the Operations team" }, { status: 400 });
    }
    patch.host_user_id = host;
  }

  const priv: Record<string, string | null> = {};
  for (const k of PRIVATE_FIELDS) {
    if (body[k] === undefined) continue;
    if (body[k] !== null && typeof body[k] !== "string") return NextResponse.json({ error: "Bad private details" }, { status: 400 });
    const t = typeof body[k] === "string" ? (body[k] as string).trim() : "";
    if (t.length > 8000) return NextResponse.json({ error: "Too long" }, { status: 400 });
    priv[k] = t || null;
  }

  if (Object.keys(patch).length) {
    const { data: row, error } = await updateTeam(supabase, id, patch);
    if (error || !row) return NextResponse.json({ error: error?.message ?? "Couldn't save" }, { status: 500 });

    if (row.arrival_on !== current.arrival_on || row.departure_on !== current.departure_on) {
      await Promise.all(
        CHECKLIST.filter((s) => s.due).map((s) => setStepDue(supabase, id, s.key, dueFor(s, row.arrival_on, row.departure_on)))
      );
    }
  }

  if (Object.keys(priv).length) {
    const { error } = await savePrivate(supabase, id, priv);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

// DELETE — lead only (RLS). For a team added by mistake; a team that
// isn't coming is Said no / Postponed / Cancelled instead.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await isVisitingTeamsLead(supabase))) {
    return NextResponse.json({ error: "Only the Visiting teams lead can remove a team" }, { status: 403 });
  }
  const { error } = await deleteTeam(supabase, id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
