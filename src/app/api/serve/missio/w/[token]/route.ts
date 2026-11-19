import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { serveAvailabilityLimit } from "@/lib/missio/availability/limit";
import { personCantMakeIt, placementAdmin, TOKEN_PATTERN } from "@/lib/missio/placements";

// POST /api/serve/missio/w/:token  The person: "I can't make it this week".
// Public, no login. The token is the only key and is never logged.

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

function json(body: unknown, status = 200) {
  const res = NextResponse.json(body, { status });
  res.headers.set("cache-control", "no-store");
  return res;
}

export async function POST(request: Request, context: Ctx) {
  const { token } = await context.params;
  const tokenHash = TOKEN_PATTERN.test(token) ? createHash("sha256").update(token).digest("hex") : undefined;
  const limited = await serveAvailabilityLimit(request, "write", tokenHash);
  if (limited) return limited;

  try {
    const result = await personCantMakeIt(placementAdmin(), token);
    if (!result.ok) return json({ error: result.error, code: result.code }, result.status);
    return json({ ok: true });
  } catch (error) {
    console.error("[serve/missio/w]", error instanceof Error ? error.message : "failed");
    return json({ error: "Something went wrong.", code: "server_error" }, 500);
  }
}
