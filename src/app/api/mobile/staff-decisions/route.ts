import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import { isLeadershipTeam } from "@/lib/auth/check-okr-access";
import {
  listLeadershipTrackPrograms,
  loadStaffDecisionRows,
} from "@/lib/schools/staff-decisions";
import { NO_STORE, shapeSchool, sortSchools } from "@/lib/mobile/staff-decisions";

// GET /api/mobile/staff-decisions — the phone app's Staff decisions list.
// Same gate as the web /staff-decisions page: Leadership Team only (role-only,
// admin alone gets 403). Only after that check is the service-role client
// used, exactly as the web page does. Contract: src/lib/mobile/staff-decisions.ts.

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json(
      { error: "unauthenticated", message: "Sign in to use this endpoint." },
      { status: 401, headers: NO_STORE }
    );
  }
  if (!(await isLeadershipTeam(supabase, user.id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403, headers: NO_STORE });
  }

  const admin = createAdminClient();
  const programs = await listLeadershipTrackPrograms(admin);
  const schools = await Promise.all(
    programs.map(async (p) => shapeSchool(p, await loadStaffDecisionRows(admin, p.id)))
  );

  return NextResponse.json({ schools: sortSchools(schools) }, { headers: NO_STORE });
}
