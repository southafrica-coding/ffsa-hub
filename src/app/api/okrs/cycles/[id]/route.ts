import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import { callerCanManageCycles } from "@/lib/auth/check-okr-access";
import { setCurrentCycle, updateCycle } from "@/services/okrs";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!(await callerCanManageCycles(supabase, user.id))) {
    return NextResponse.json({ error: "Only leadership can change a cycle" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();

  // Promotion goes through the SQL function: one_current_okr_cycle rejects a
  // second current row, and demote-then-promote as two PostgREST calls has no
  // transaction to hold it together.
  if (body.is_current === true) {
    const { error } = await setCurrentCycle(supabase, id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const patch: Record<string, unknown> = {};
  for (const key of ["name", "starts_on", "ends_on"] as const) {
    if (key in body) patch[key] = body[key];
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ success: true });
  }

  if (patch.starts_on && patch.ends_on && (patch.ends_on as string) < (patch.starts_on as string)) {
    return NextResponse.json({ error: "The cycle cannot end before it starts" }, { status: 400 });
  }

  const { data, error } = await updateCycle(supabase, id, patch);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, cycle: data });
}
