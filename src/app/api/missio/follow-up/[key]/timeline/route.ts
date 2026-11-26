import { NextResponse } from "next/server";
import { missioRateLimit } from "@/lib/missio/limit";
import { addFollowupNote, listTimeline, pastorFollowupAccess } from "@/lib/missio/follow-up";

// GET  /api/missio/follow-up/:key/timeline
// POST /api/missio/follow-up/:key/timeline  { body }
//
// submitted is synthesised from connect_responses.submitted_at.
// stage_change rows are read, never written here. POST inserts kind note.

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ key: string }> };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(_request: Request, context: Ctx) {
  const access = await pastorFollowupAccess();
  if ("response" in access) return access.response;

  const { key } = await context.params;
  const result = await listTimeline(access.auth, key);
  if (!result.ok) return json({ error: result.error, code: result.code }, result.status);
  return json({ entries: result.entries });
}

export async function POST(request: Request, context: Ctx) {
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

  const result = await addFollowupNote(access.auth, key, body);
  if (!result.ok) return json({ error: result.error, code: result.code }, result.status);
  return json({ entry: result.entry }, 201);
}
