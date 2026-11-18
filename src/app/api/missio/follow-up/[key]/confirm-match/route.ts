import { NextResponse } from "next/server";
import { missioRateLimit } from "@/lib/missio/limit";
import { confirmPendingMatch, pastorFollowupAccess } from "@/lib/missio/follow-up";

// POST /api/missio/follow-up/:key/confirm-match
//
// r_ keys only. Empty body. Confirms a phone-only card through
// link_missio_connect_match after the pastor guard. The column and
// argument names are not filled in yet, so this does not call the RPC
// until PENDING_MATCH is set. The response body is not final.

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ key: string }> };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(request: Request, context: Ctx) {
  const access = await pastorFollowupAccess();
  if ("response" in access) return access.response;

  const limited = await missioRateLimit(access.auth.user.id, "follow-up-write");
  if (limited) return limited;

  const { key } = await context.params;
  let body: unknown = {};
  const text = await request.text();
  if (text.trim()) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      return json({ error: "Check the fields and try again.", code: "invalid_input" }, 400);
    }
  }

  const result = await confirmPendingMatch(access.auth, key, body);
  if (!result.ok) return json({ error: result.error, code: result.code }, result.status);
  return json(result.body);
}
