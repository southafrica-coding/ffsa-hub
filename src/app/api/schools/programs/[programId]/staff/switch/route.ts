import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userCanManageProgramStaff } from "@/lib/schools/program-staff-access";
import {
  listProgramStaff,
  switchPersonToProgramStaff,
} from "@/services/program-staff";

// POST /api/schools/programs/[programId]/staff/switch  { userId }
//
// One database function. Leaders may move someone who is only a leader
// and/or an assignable contact. Other program-scoped schools.* grants
// need an admin. See docs/program-staff.md.

export async function POST(
  request: Request,
  context: { params: Promise<{ programId: string }> }
) {
  const { programId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!(await userCanManageProgramStaff(supabase, user.id, programId))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { userId } = (await request.json().catch(() => ({}))) as { userId?: string };
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const { data, error } = await switchPersonToProgramStaff(supabase, programId, userId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  const admin = createAdminClient();

  const { data: staff } = await listProgramStaff(admin, programId);
  return NextResponse.json({ staff: staff ?? [], switch: data });
}
