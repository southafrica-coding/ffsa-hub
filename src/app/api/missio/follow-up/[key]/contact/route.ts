import { NextResponse } from "next/server";
import { missioRateLimit } from "@/lib/missio/limit";
import { linkFollowupContact, pastorFollowupAccess } from "@/lib/missio/follow-up";

// POST /api/missio/follow-up/:key/contact
//
// r_ keys only. Links a card to a contact who already has Missio org_people,
// or creates one through the Phase 0 path. A non-Missio FFSA match is
// 409 exists_use_search and is not added. The body takes no contact id.

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

  const result = await linkFollowupContact(access.auth, key, body);
  if (!result.ok) return json({ error: result.error, code: result.code }, result.status);
  return json(result.body);
}
