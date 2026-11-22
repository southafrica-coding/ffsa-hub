import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { serveAvailabilityLimit } from "@/lib/missio/availability/limit";
import { FEEDBACK_TOKEN_PATTERN, feedbackAdmin, resolveFeedbackLink } from "@/lib/missio/feedback";
import { loadWeeklyHouse, saveWeeklyFeedback } from "@/lib/missio/weekly-feedback";

// POST /api/serve/missio/feedback/:token  { answers }
//
// Public: the house's weekly feedback link. No login. The token is the
// only key; it is never logged. The house comes from the token and is
// passed to the form's route runner (F4). Sending again the same week
// updates the same row.

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
  let body: { answers?: unknown };
  try {
    body = (await request.json()) as { answers?: unknown };
  } catch {
    return json({ error: "Check the answers and try again.", code: "invalid_input" }, 400);
  }
  try {
    const db = feedbackAdmin();
    const link = await resolveFeedbackLink(db, token);
    if (!link.ok) return json({ error: link.error, code: link.code }, link.status);
    const house = await loadWeeklyHouse(db, link.houseId);
    if (!house) return json({ error: "This link isn’t right.", code: "invalid_token" }, 404);
    const result = await saveWeeklyFeedback(db, {
      house,
      linkId: link.linkId,
      answers: body?.answers,
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: request.headers.get("user-agent"),
    });
    if (!result.ok) return json({ error: result.error, code: result.code, fieldErrors: result.fieldErrors }, result.status);
    return json({ ok: true, meetingDate: result.meetingDate });
  } catch (error) {
    console.error("[serve/missio/feedback]", error instanceof Error ? error.message : "save failed");
    return json({ error: "Something went wrong.", code: "server_error" }, 500);
  }
}
