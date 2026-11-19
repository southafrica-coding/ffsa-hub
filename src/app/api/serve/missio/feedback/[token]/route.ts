import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { serveAvailabilityLimit } from "@/lib/missio/availability/limit";
import { FEEDBACK_TOKEN_PATTERN, feedbackAdmin, savePublicFeedback } from "@/lib/missio/feedback";

// POST /api/serve/missio/feedback/:token  { attendance, mood, newNames?, prayer?, notes? }
//
// Public: the leader's weekly feedback link. No login. The token is the
// only key; it is never logged.

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

function json(body: unknown, status = 200) {
  const res = NextResponse.json(body, { status });
  res.headers.set("cache-control", "no-store");
  return res;
}

export async function POST(request: Request, context: Ctx) {
  const { token } = await context.params;
  const tokenHash = FEEDBACK_TOKEN_PATTERN.test(token) ? createHash("sha256").update(token).digest("hex") : undefined;
  const limited = await serveAvailabilityLimit(request, "write", tokenHash);
  if (limited) return limited;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Check the answers and try again.", code: "invalid_input" }, 400);
  }
  try {
    const result = await savePublicFeedback(feedbackAdmin(), token, body);
    if (!result.ok) return json({ error: result.error, code: result.code }, result.status);
    return json({ entry: result.entry });
  } catch (error) {
    console.error("[serve/missio/feedback]", error instanceof Error ? error.message : "save failed");
    return json({ error: "Something went wrong.", code: "server_error" }, 500);
  }
}
