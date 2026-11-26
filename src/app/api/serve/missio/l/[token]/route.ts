import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { serveAvailabilityLimit } from "@/lib/missio/availability/limit";
import { leaderStep, placementAdmin, TOKEN_PATTERN } from "@/lib/missio/placements";

// POST /api/serve/missio/l/:token  { step }  The leader: said hi, they came, they've joined.
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
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Check the fields and try again.", code: "invalid_input" }, 400);
  }
  try {
    const result = await leaderStep(placementAdmin(), token, body);
    if (!result.ok) return json({ error: result.error, code: result.code }, result.status);
    return json({ placement: result.view });
  } catch (error) {
    console.error("[serve/missio/l]", error instanceof Error ? error.message : "failed");
    return json({ error: "Something went wrong.", code: "server_error" }, 500);
  }
}
