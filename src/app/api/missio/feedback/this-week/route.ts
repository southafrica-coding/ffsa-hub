import { NextResponse } from "next/server";
import { feedbackThisWeek, type ThisWeekScope } from "@/lib/missio/feedback-this-week";
import { houseReadAccess } from "@/lib/missio/house-churches";

// GET /api/missio/feedback/this-week
//
// The Missio Home card: which houses haven't sent this week's feedback.
// Pastors: every house. Coaches: the houses they coach (the same scope as
// /missio-feedback). Leaders and everyone else: 403. Reads on the
// viewer's own client, so RLS still decides which rows come back.

export const dynamic = "force-dynamic";

const FORBIDDEN = { error: "Weekly feedback status is for pastors and coaches.", code: "forbidden" };

export async function GET() {
  const access = await houseReadAccess();
  if ("response" in access) return access.response;
  const pastor = access.auth.roles.includes("pastor");
  // Coaches: only the houses they coach (editScope), never ones they only lead.
  const scope: ThisWeekScope = pastor ? { mode: "all" } : access.editScope;
  if (scope.mode === "houses" && scope.ids.length === 0) return NextResponse.json(FORBIDDEN, { status: 403 });

  const result = await feedbackThisWeek(access.auth.supabase, access.auth.orgId, scope);
  if (!result.ok) return NextResponse.json({ error: "Something went wrong.", code: "server_error" }, { status: 500 });
  const res = NextResponse.json(result.data);
  res.headers.set("cache-control", "no-store");
  return res;
}
