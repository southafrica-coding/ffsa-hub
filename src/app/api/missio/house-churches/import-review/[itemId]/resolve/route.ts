import { NextResponse } from "next/server";
import { invalidInput } from "@/lib/missio/db-errors";
import { isUuid, pastorHouseAccess, publicError, resolveImportReview } from "@/lib/missio/house-churches";
import { missioRateLimit } from "@/lib/missio/limit";

// POST /api/missio/house-churches/import-review/:itemId/resolve
//
// { action: "link", contactId } | { action: "create", firstName, lastName?, email?, phone? } | { action: "skip", notes? }

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ itemId: string }> };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(request: Request, context: Ctx) {
  const access = await pastorHouseAccess();
  if ("response" in access) return access.response;

  const limited = await missioRateLimit(access.auth.user.id, "house-church-write");
  if (limited) return limited;

  const { itemId } = await context.params;
  if (!isUuid(itemId)) return json({ error: "Review item not found.", code: "not_found" }, 404);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const input = invalidInput();
    return json({ error: input.error, code: input.code, fieldErrors: input.fieldErrors }, input.status);
  }

  const result = await resolveImportReview(access.auth, access.scope, itemId, body);
  if (!result.ok) return json(publicError(result), result.status);
  return json(result.body);
}
