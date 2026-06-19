import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { setCourseBilling } from "@/services/school-billing";

// Updates a course's (= programs row) billing settings:
// program group assignment + arrival / start anchor dates.
export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const { program_id } = body;
  if (!program_id) {
    return NextResponse.json(
      { error: "program_id is required" },
      { status: 400 }
    );
  }

  const update: Record<string, unknown> = {};
  if ("program_group_id" in body) update.program_group_id = body.program_group_id;
  if ("billing_arrival_date" in body)
    update.billing_arrival_date = body.billing_arrival_date || null;
  if ("billing_start_date" in body)
    update.billing_start_date = body.billing_start_date || null;

  const { data, error } = await setCourseBilling(supabase, program_id, update);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, data });
}
