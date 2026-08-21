import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import { callerCanEditKeyResult } from "@/lib/auth/check-okr-access";
import { deleteKeyResult, updateKeyResult } from "@/services/okrs";
import { normaliseMetric } from "@/lib/okrs/metric-input";

type Params = { params: Promise<{ id: string }> };

const EDITABLE = ["description", "label", "notes", "timeline", "owner_note", "position"] as const;

export async function PATCH(request: Request, { params }: Params) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  if (!(await callerCanEditKeyResult(supabase, user.id, id))) {
    return NextResponse.json({ error: "You cannot edit this key result" }, { status: 403 });
  }

  const body = await request.json();

  const patch: Record<string, unknown> = {};
  for (const key of EDITABLE) {
    if (key in body) patch[key] = body[key];
  }
  if (typeof patch.description === "string") patch.description = patch.description.trim();
  if (patch.description === "") {
    return NextResponse.json({ error: "description cannot be empty" }, { status: 400 });
  }

  // current_status and current_value are absent from EDITABLE on purpose: they
  // are derived from the check-in log by a trigger, and letting a PATCH set
  // them would put the row out of step with its own history.
  if ("metric_start" in body || "metric_target" in body || "metric_unit" in body) {
    const metric = normaliseMetric(body);
    if ("error" in metric) {
      return NextResponse.json({ error: metric.error }, { status: 400 });
    }
    Object.assign(patch, metric);
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { data, error } = await updateKeyResult(supabase, id, patch);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, keyResult: data });
}

export async function DELETE(_request: Request, { params }: Params) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  if (!(await callerCanEditKeyResult(supabase, user.id, id))) {
    return NextResponse.json({ error: "You cannot delete this key result" }, { status: 403 });
  }

  const { error } = await deleteKeyResult(supabase, id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
