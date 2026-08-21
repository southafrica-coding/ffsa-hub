import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import { callerCanEditMinistryOkrs } from "@/lib/auth/check-okr-access";
import { createObjective, listObjectives, nextObjectivePosition } from "@/services/okrs";

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
  const { cycle_id, staff_ministry_id, title, scope } = body;

  if (!cycle_id || !staff_ministry_id || !title?.trim()) {
    return NextResponse.json(
      { error: "cycle_id, staff_ministry_id and title are required" },
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

  if (!(await callerCanEditMinistryOkrs(supabase, user.id, staff_ministry_id))) {
    return NextResponse.json(
      { error: "You can only add objectives to a ministry you lead" },
      { status: 403 }
    );
  }

  const { data, error } = await createObjective(supabase, {
    cycle_id,
    staff_ministry_id,
    scope: "ministry",
    title: title.trim(),
    description: body.description ?? null,
    timeline: body.timeline ?? null,
    owner_note: body.owner_note ?? null,
    subcategory_id: body.subcategory_id ?? null,
    position: body.position ?? (await nextObjectivePosition(supabase, cycle_id, staff_ministry_id)),
    created_by: user.id,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, objective: data });
}
