import { NextResponse } from "next/server";
import { listLeaders, pastorFollowupAccess } from "@/lib/missio/follow-up";

// GET /api/missio/follow-up/leaders
//
// Current leader and co-leader members of any Missio house, plus Missio
// pastors who have a contact. Every name is a Missio org_people row.

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET() {
  const access = await pastorFollowupAccess();
  if ("response" in access) return access.response;

  const result = await listLeaders(access.auth);
  if (!result.ok) return json({ error: result.error, code: result.code }, result.status);
  return json({ leaders: result.leaders });
}
