import { NextResponse } from "next/server";
import { houseReadAccess } from "@/lib/missio/house-churches";
import { missioRateLimit } from "@/lib/missio/limit";
import { moveNextLeader } from "@/lib/missio/next-leaders";

// PATCH /api/missio/next-leaders/:id   { stage?, note?, trainerContactId?, remove? }
// :id is a row id, or "co:<houseId>:<contactId>" for a co-leader not yet on the list.

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
  const limited = await missioRateLimit(access.auth.user.id, "house-church-write");
  if (limited) return limited;
  const { id } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Check the fields and try again.", code: "invalid_input" }, 400);
  }
  const result = await moveNextLeader(access.auth, access.scope, decodeURIComponent(id), body);
  if (!result.ok) return json({ error: result.error, code: result.code }, result.status);
  return json({ id: result.id });
}
