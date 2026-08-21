import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import { callerCanEditObjective } from "@/lib/auth/check-okr-access";
import { createKeyResult, nextKeyResultPosition } from "@/services/okrs";
import { normaliseMetric } from "@/lib/okrs/metric-input";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id: objectiveId } = await params;
  if (!(await callerCanEditObjective(supabase, user.id, objectiveId))) {
    return NextResponse.json({ error: "You cannot add key results here" }, { status: 403 });
  }

  const body = await request.json();
  if (!body.description?.trim()) {
    return NextResponse.json({ error: "description is required" }, { status: 400 });
  }

  const metric = normaliseMetric(body);
  if ("error" in metric) {
    return NextResponse.json({ error: metric.error }, { status: 400 });
  }

  const { data, error } = await createKeyResult(supabase, {
    objective_id: objectiveId,
    description: body.description.trim(),
    label: body.label ?? null,
    notes: body.notes ?? null,
    timeline: body.timeline ?? null,
    owner_note: body.owner_note ?? null,
    ...metric,
    position: body.position ?? (await nextKeyResultPosition(supabase, objectiveId)),
    created_by: user.id,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, keyResult: data });
}
