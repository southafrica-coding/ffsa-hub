import { NextResponse } from "next/server";
import { pastorHouseAccess, publicError, searchReviewContacts } from "@/lib/missio/house-churches";
import { missioRateLimit } from "@/lib/missio/limit";

// GET /api/missio/house-churches/import-review/contacts?q=<name>
//
// Name search across every contact, for the import review queue only.
// Pastors only. At most eight matches, each a name with a masked email and
// phone. Rate limited and audited.

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: Request) {
  const access = await pastorHouseAccess();
  if ("response" in access) return access.response;

  const limited = await missioRateLimit(access.auth.user.id, "contact-search");
  if (limited) return limited;

  const q = new URL(request.url).searchParams.get("q") ?? "";
  const result = await searchReviewContacts(access.auth, q.slice(0, 200));
  if (!result.ok) return json(publicError(result), result.status);
  return json(result.body);
}
