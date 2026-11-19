import { NextResponse } from "next/server";
import { listHouseFeedback } from "@/lib/missio/feedback";
import { houseReadAccess } from "@/lib/missio/house-churches";

// GET /api/missio/house-churches/feedback?weeks=12
//
// Weekly feedback for every house this user may see (pastors: all; coaches
// and leaders: their own). Missed weeks have no entry.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await houseReadAccess();
  if ("response" in access) return access.response;
  const raw = Number(new URL(request.url).searchParams.get("weeks") ?? "12");
  const weeks = Number.isFinite(raw) ? Math.min(52, Math.max(1, Math.trunc(raw))) : 12;
  const result = await listHouseFeedback(access.auth, access.scope, weeks);
  if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  const res = NextResponse.json({ houses: result.houses, since: result.since });
  res.headers.set("cache-control", "no-store");
  return res;
}
