import { NextResponse } from "next/server";
import { houseReadAccess, isUuid } from "@/lib/missio/house-churches";
import { missioRateLimit } from "@/lib/missio/limit";
import { stepPlacement } from "@/lib/missio/placements";

// PATCH /api/missio/placements/:id  { step: "said_hi" | "first_visit" | "joined" | "cancel" }
// Pastors anywhere; coaches in houses they coach. "joined" adds the membership.

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function json(body: unknown, status = 200) {
  const res = NextResponse.json(body, { status });
  res.headers.set("cache-control", "no-store");
  return res;
}

export async function PATCH(request: Request, context: Ctx) {
  const access = await houseReadAccess();
  if ("response" in access) return access.response;
  if (!access.abilities.editMembers) return json({ error: "Not authorized", code: "forbidden" }, 403);
  const limited = await missioRateLimit(access.auth.user.id, "house-church-write");
  if (limited) return limited;
  const { id } = await context.params;
  if (!isUuid(id)) return json({ error: "Placement not found.", code: "not_found" }, 404);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Check the fields and try again.", code: "invalid_input" }, 400);
  }
  const result = await stepPlacement(access.auth, access.editScope, id, body);
  if (!result.ok) return json({ error: result.error, code: result.code }, result.status);
  return json({ placement: result.placement });
}
