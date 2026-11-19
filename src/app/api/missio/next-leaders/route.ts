import { NextResponse } from "next/server";
import { houseReadAccess } from "@/lib/missio/house-churches";
import { missioRateLimit } from "@/lib/missio/limit";
import { listNextLeaders, nominate } from "@/lib/missio/next-leaders";

// GET  /api/missio/next-leaders   The pipeline for the caller's houses (pastors: all).
// POST /api/missio/next-leaders   { contactId, houseId, trainerContactId?, note? } Nominate someone.
//
// Pastors anywhere, coaches across their houses, leaders in their own house.

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  const res = NextResponse.json(body, { status });
  res.headers.set("cache-control", "no-store");
  return res;
}

export async function GET() {
  const access = await houseReadAccess();
  if ("response" in access) return access.response;
  const result = await listNextLeaders(access.auth, access.scope);
  if (!result.ok) return json({ error: result.error, code: result.code }, result.status);
  return json({ leaders: result.leaders, houses: result.houses });
}

export async function POST(request: Request) {
  const access = await houseReadAccess();
  if ("response" in access) return access.response;
  const limited = await missioRateLimit(access.auth.user.id, "house-church-write");
  if (limited) return limited;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Check the fields and try again.", code: "invalid_input" }, 400);
  }
  const result = await nominate(access.auth, access.scope, body);
  if (!result.ok) return json({ error: result.error, code: result.code }, result.status);
  return json({ id: result.id }, 201);
}
