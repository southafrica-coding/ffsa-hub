import { NextResponse } from "next/server";
import { isUuid, pastorHouseAccess, resolveImportReview } from "@/lib/missio/house-churches";
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
    return json({ error: "Check the fields and try again.", code: "invalid_input" }, 400);
  }

  const result = await resolveImportReview(access.auth, access.scope, itemId, body);
  if (!result.ok) return json({ error: result.error, code: result.code }, result.status);
  return json(result.body);
}
