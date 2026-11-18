import { NextResponse } from "next/server";
import { getHouse, isUuid, pastorHouseAccess } from "@/lib/missio/house-churches";

// GET /api/missio/house-churches/:id

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(_request: Request, context: Ctx) {
  const access = await pastorHouseAccess();
  if ("response" in access) return access.response;

  const { id } = await context.params;
  if (!isUuid(id)) return json({ error: "House not found.", code: "not_found" }, 404);

  const result = await getHouse(access.auth, access.scope, id);
  if (!result.ok) return json({ error: result.error, code: result.code }, result.status);
  return json(result.body);
}
