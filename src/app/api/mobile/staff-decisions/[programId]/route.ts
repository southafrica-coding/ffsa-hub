import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import { isLeadershipTeam } from "@/lib/auth/check-okr-access";
import {
  getLeadershipTrackProgram,
  loadStaffDecisionRows,
} from "@/lib/schools/staff-decisions";
import { listActiveMinistries } from "@/services/ministries";
import {
  NO_STORE,
  programIdSchema,
  shapeDepartmentOptions,
  shapeSchool,
} from "@/lib/mobile/staff-decisions";

// GET /api/mobile/staff-decisions/[programId] — one Leadership Track school's
// staff decision rows for the phone app. Same gate and reads as the web
// staff_decision tab: Leadership Team only (admin alone gets 403), then the
// service-role read; a school that isn't Leadership Track is 404. The
// department choices are the active main ministries, read as the caller,
// the way the web tab gets them.

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ programId: string }> }
) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json(
      { error: "unauthenticated", message: "Sign in to use this endpoint." },
      { status: 401, headers: NO_STORE }
    );
  }

  const parsed = programIdSchema.safeParse((await params).programId);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400, headers: NO_STORE });
  }
  const programId = parsed.data;

  if (!(await isLeadershipTeam(supabase, user.id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403, headers: NO_STORE });
  }

  const admin = createAdminClient();
  const program = await getLeadershipTrackProgram(admin, programId);
  if (!program) {
    return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  }

  const [rows, { data: ministries }] = await Promise.all([
    loadStaffDecisionRows(admin, programId),
    listActiveMinistries(supabase),
  ]);

  return NextResponse.json(
    {
      school: shapeSchool(program, rows),
      rows,
      departmentOptions: shapeDepartmentOptions(ministries),
    },
    { headers: NO_STORE }
  );
}
