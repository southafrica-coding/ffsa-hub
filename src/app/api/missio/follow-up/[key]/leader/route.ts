import { NextResponse } from "next/server";
import { missioRateLimit } from "@/lib/missio/limit";
import { pastorFollowupAccess, setFollowupLeader } from "@/lib/missio/follow-up";

// PATCH /api/missio/follow-up/:key/leader  { leaderContactId: uuid | null }
//
// leaderContactId must be on the leaders list. null clears the assignee.
// assigned_user_id is set only when that contact's hub user has a Missio
// org_staff_roles row. The check is on the session client before the write.
// A 23503 missio_user_not_in_org from the guard is 400 not_missio_person.

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ key: string }> };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export async function PATCH(request: Request, context: Ctx) {
  const access = await pastorFollowupAccess();
  if ("response" in access) return access.response;

  const limited = await missioRateLimit(access.auth.user.id, "follow-up-write");
  if (limited) return limited;

  const { key } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Check the fields and try again.", code: "invalid_input" }, 400);
  }

  const result = await setFollowupLeader(access.auth, key, body);
  if (!result.ok) return json({ error: result.error, code: result.code }, result.status);
  return json(result.body);
}
