import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import { callerCanEditMinistryOkrs } from "@/lib/auth/check-okr-access";
import {
  createKeyResults,
  createObjective,
  deleteObjective,
  listObjectives,
  nextObjectivePosition,
} from "@/services/okrs";

export async function GET(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const url = new URL(request.url);
  const cycleId = url.searchParams.get("cycle");
  if (!cycleId) {
    return NextResponse.json({ error: "cycle is required" }, { status: 400 });
  }

  // RLS decides what comes back; no extra authorization needed to read.
  const { data, error } = await listObjectives(supabase, {
    cycleId,
    ministryId: url.searchParams.get("ministry") ?? undefined,
    teamId: url.searchParams.get("team") ?? undefined,
    scope: url.searchParams.get("scope") === "individual" ? "individual" : "ministry",
    ownerUserId: url.searchParams.get("owner") ?? undefined,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ objectives: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json();
  const { cycle_id, staff_ministry_id, okr_team_id, title, scope } = body;

  if (!cycle_id || !title?.trim()) {
    return NextResponse.json({ error: "cycle_id and title are required" }, { status: 400 });
  }

  // Exactly one owning group, matching okr_objectives_owner_group_ck. Caught
  // here so the caller gets a sentence rather than a constraint name.
  if (!staff_ministry_id === !okr_team_id) {
    return NextResponse.json(
      { error: "An objective needs exactly one owner — a ministry or an OKR team" },
      { status: 400 }
    );
  }

  // Individual OKRs are a later build. Until the portal ships, refusing here
  // keeps half-owned rows out of the table rather than letting an API caller
  // create objectives nothing can display.
  if (scope && scope !== "ministry") {
    return NextResponse.json(
      { error: "Only ministry objectives can be created yet" },
      { status: 400 }
    );
  }

  // A team has no roster, so passing null asks the leadership/admin question —
  // the same answer the RLS policy gives via leads_staff_ministry(NULL).
  if (!(await callerCanEditMinistryOkrs(supabase, user.id, staff_ministry_id ?? null))) {
    return NextResponse.json(
      {
        error: okr_team_id
          ? "Only leadership can add objectives for an OKR team"
          : "You can only add objectives to a ministry you lead",
      },
      { status: 403 }
    );
  }

  const { data, error } = await createObjective(supabase, {
    cycle_id,
    staff_ministry_id: staff_ministry_id ?? null,
    okr_team_id: okr_team_id ?? null,
    scope: "ministry",
    title: title.trim(),
    description: body.description ?? null,
    timeline: body.timeline ?? null,
    notes: body.notes ?? null,
    owner_note: body.owner_note ?? null,
    subcategory_id: body.subcategory_id ?? null,
    position:
      body.position ??
      (await nextObjectivePosition(supabase, cycle_id, {
        ministryId: staff_ministry_id ?? null,
        teamId: okr_team_id ?? null,
      })),
    created_by: user.id,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Optional key results, written in the same dialog as the objective.
  //
  // If any of them fails the objective is deleted and the whole call fails.
  // PostgREST has no transaction across calls, so the choice is between
  // rolling back by hand and leaving someone an objective they thought they
  // had cancelled — an empty objective they did not ask for is worse than a
  // retry, so it rolls back.
  const rows = Array.isArray(body.key_results) ? body.key_results : [];
  const wanted = rows
    .map((r: { description?: string }) => (r?.description ?? "").trim())
    .filter((d: string) => d !== "");

  if (wanted.length > 0) {
    const objectiveId = (data as { id: string }).id;
    const inserts = wanted.map((description: string, i: number) => ({
      objective_id: objectiveId,
      description,
      position: i + 1,
      created_by: user.id,
    }));

    const { error: krError } = await createKeyResults(supabase, inserts);
    if (krError) {
      await deleteObjective(supabase, objectiveId);
      return NextResponse.json(
        { error: `The objective was not saved — ${krError.message}` },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ success: true, objective: data, keyResults: wanted.length });
}
