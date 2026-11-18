import { NextResponse } from "next/server";
import { listHouses, pastorHouseAccess, publicError } from "@/lib/missio/house-churches";

// GET /api/missio/house-churches
//
// Pastors only. resolveHouseScope (inside pastorHouseAccess) filters the
// list. v1 is every house. Names are a service-role read after that check.

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(_request: Request) {
  const access = await pastorHouseAccess();
  if ("response" in access) return access.response;

  const result = await listHouses(access.auth, access.scope);
  if (!result.ok) return json(publicError(result), result.status);
  return json(result.body);
}
