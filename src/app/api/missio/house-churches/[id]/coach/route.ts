import { NextResponse } from "next/server";
import { invalidInput } from "@/lib/missio/db-errors";
import { isUuid, pastorHouseAccess, publicError, setHouseCoach } from "@/lib/missio/house-churches";
import { missioRateLimit } from "@/lib/missio/limit";

// PUT /api/missio/house-churches/:id/coach  { contactId: string | null }
//
// Pastors only. Sets or clears the house's coach. The old coach row is
// ended, not deleted, so the history stays.

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export async function PUT(request: Request, context: Ctx) {
  const access = await pastorHouseAccess();
  if ("response" in access) return access.response;

  const limited = await missioRateLimit(access.auth.user.id, "house-church-write");
  if (limited) return limited;

  const { id } = await context.params;
  if (!isUuid(id)) return json({ error: "House not found.", code: "not_found" }, 404);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const input = invalidInput();
    return json({ error: input.error, code: input.code, fieldErrors: input.fieldErrors }, input.status);
  }

  const result = await setHouseCoach(access.auth, access.scope, id, body);
  if (!result.ok) return json(publicError(result), result.status);
  return json(result.body);
}
