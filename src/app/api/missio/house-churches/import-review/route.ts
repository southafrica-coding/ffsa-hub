import { NextResponse } from "next/server";
import { fieldError, invalidInput } from "@/lib/missio/db-errors";
import { listImportReview, parseReviewStatus, pastorHouseAccess, publicError } from "@/lib/missio/house-churches";

// GET /api/missio/house-churches/import-review?status=pending
//
// status defaults to pending. status=all returns every status.

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: Request) {
  const access = await pastorHouseAccess();
  if ("response" in access) return access.response;

  const status = parseReviewStatus(new URL(request.url).searchParams.get("status"));
  if (!status) {
    const input = invalidInput(fieldError("status"));
    return json({ error: input.error, code: input.code, fieldErrors: input.fieldErrors }, input.status);
  }

  const result = await listImportReview(access.auth, access.scope, status);
  if (!result.ok) return json(publicError(result), result.status);
  return json(result.body);
}
