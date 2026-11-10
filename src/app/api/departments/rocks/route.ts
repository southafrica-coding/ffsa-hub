import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/api-auth";
import { canViewLeadershipRocks } from "@/lib/departments/access";
import { badRequest, notAuthenticated, notAuthorized, serverError } from "@/lib/departments/http";
import { listLeadershipRocks } from "@/lib/departments/repository";
import { parseQuarter } from "@/lib/departments/quarter";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// GET /api/departments/rocks?quarter=2026-Q4
// Every active department's rocks for the quarter.
// Leadership Team members and unscoped admins only. A ministry leader who
// is not on Leadership Team is 403.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return notAuthenticated();
  if (!(await canViewLeadershipRocks(supabase, user.id))) return notAuthorized();

  const quarter = parseQuarter(new URL(request.url).searchParams.get("quarter"));
  if (!quarter.ok) return badRequest(quarter.error);

  const rocks = await listLeadershipRocks(createAdminClient(), quarter.quarter);
  if (rocks.error) return serverError(rocks.error.message);
  return NextResponse.json(rocks.data);
}
