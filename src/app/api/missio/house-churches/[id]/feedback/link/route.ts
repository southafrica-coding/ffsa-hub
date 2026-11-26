import { NextResponse } from "next/server";
import { feedbackAdmin, houseFeedbackLink } from "@/lib/missio/feedback";
import { houseInScope, houseReadAccess, isUuid } from "@/lib/missio/house-churches";
import { missioRateLimit } from "@/lib/missio/limit";

// POST /api/missio/house-churches/:id/feedback/link  { rotate?: boolean }
//
// The house's weekly feedback link, made on first use, so a pastor, coach
// or leader can send it on. Only pastors can rotate it (which kills the
// old link).

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

  let rotate = false;
  try {
    const body = (await request.json()) as { rotate?: unknown };
    rotate = body?.rotate === true;
  } catch {
    rotate = false;
  }
  if (rotate && !access.abilities.place) return json({ error: "Not authorized", code: "forbidden" }, 403);

  // The house must be one this user can read (RLS), not just an id in scope.
  const house = await access.auth.supabase.from("house_churches").select("id").eq("id", id).eq("org_id", access.auth.orgId).maybeSingle();
  if (house.error) return json({ error: "Something went wrong.", code: "server_error" }, 500);
  if (!house.data) return json({ error: "House not found.", code: "not_found" }, 404);

  const result = await houseFeedbackLink(feedbackAdmin(), id, access.auth.user.id, rotate);
  if (!result.ok) return json({ error: result.error, code: result.code }, result.status);
  return json({ path: result.path });
}
