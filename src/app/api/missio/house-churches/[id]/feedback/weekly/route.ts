import { NextResponse } from "next/server";
import { feedbackAdmin } from "@/lib/missio/feedback";
import { houseInScope, houseReadAccess, isUuid } from "@/lib/missio/house-churches";
import { missioRateLimit } from "@/lib/missio/limit";
import { loadWeeklyHouse, saveWeeklyFeedback } from "@/lib/missio/weekly-feedback";

// POST /api/missio/house-churches/:id/feedback/weekly  { answers }
//
// The weekly form for a signed-in leader, coach or pastor of this house
// (F4). Same save as the house link: the house is passed to the form's
// route runner, and sending again the same week updates the same row.

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function json(body: unknown, status = 200) {
  const res = NextResponse.json(body, { status });
  res.headers.set("cache-control", "no-store");
  return res;
}

export async function POST(request: Request, context: Ctx) {
  const access = await houseReadAccess();
  if ("response" in access) return access.response;
  const limited = await missioRateLimit(access.auth.user.id, "house-church-write");
  if (limited) return limited;
  const { id } = await context.params;
  if (!isUuid(id) || !houseInScope(access.scope, id)) return json({ error: "House not found.", code: "not_found" }, 404);

  let body: { answers?: unknown };
  try {
    body = (await request.json()) as { answers?: unknown };
  } catch {
    return json({ error: "Check the answers and try again.", code: "invalid_input" }, 400);
  }

  // The house must be one this user can read (RLS), not just an id in scope.
  const visible = await loadWeeklyHouse(access.auth.supabase, id);
  if (!visible || visible.org_id !== access.auth.orgId) return json({ error: "House not found.", code: "not_found" }, 404);

  try {
    const result = await saveWeeklyFeedback(feedbackAdmin(), {
      house: visible,
      linkId: null,
      answers: body?.answers,
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: request.headers.get("user-agent"),
    });
    if (!result.ok) return json({ error: result.error, code: result.code, fieldErrors: result.fieldErrors }, result.status);
    return json({ ok: true, meetingDate: result.meetingDate });
  } catch (error) {
    console.error("[missio/weekly]", error instanceof Error ? error.message : "save failed");
    return json({ error: "Something went wrong.", code: "server_error" }, 500);
  }
}
