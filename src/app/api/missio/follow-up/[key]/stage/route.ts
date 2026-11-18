import { NextResponse } from "next/server";
import { missioRateLimit } from "@/lib/missio/limit";
import { pastorFollowupAccess, setFollowupStage } from "@/lib/missio/follow-up";

// PATCH /api/missio/follow-up/:key/stage  { stage, note? }
//
// Upserts the follow-up on the pastor's session client. The stage trigger
// writes the stage_change row. A note, when present, is a separate insert
// with kind note.

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

  const result = await setFollowupStage(access.auth, key, body);
  if (!result.ok) return json({ error: result.error, code: result.code }, result.status);
  return json(result.body);
}
