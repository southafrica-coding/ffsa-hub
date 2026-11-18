import { NextResponse } from "next/server";
import { listFollowups, pastorFollowupAccess, readFollowupQuery } from "@/lib/missio/follow-up";

// GET /api/missio/follow-up?stage=&leader=<contactId>|unassigned
//
// Pastors only. is_admin is not a pass. Rows come from missio_not_in_house,
// with effective_stage and the assigned leader filled in.

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: Request) {
  const access = await pastorFollowupAccess();
  if ("response" in access) return access.response;

  const query = readFollowupQuery(new URL(request.url));
  if (!query.ok) return json({ error: query.error, code: query.code }, query.status);

  const result = await listFollowups(access.auth, query);
  if (!result.ok) return json({ error: result.error, code: result.code }, result.status);
  return json(result.body);
}
