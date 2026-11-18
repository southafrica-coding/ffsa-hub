import { NextResponse } from "next/server";
import { listImportReview, parseReviewStatus, pastorHouseAccess } from "@/lib/missio/house-churches";

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
  if (!status) return json({ error: "Check the fields and try again.", code: "invalid_input" }, 400);

  const result = await listImportReview(access.auth, access.scope, status);
  if (!result.ok) return json({ error: result.error, code: result.code }, result.status);
  return json(result.body);
}
