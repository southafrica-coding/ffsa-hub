/**
 * GET /api/finance/budgets/periods?ownerKind=&ownerId=
 *
 * Periods a signed-in user may choose before creating their first budget
 * for that owner. The database applies the existing create check and
 * returns only active NPC / ZAR periods. It does not read finance_orgs
 * as the user and does not create a period.
 */

import { NextResponse } from "next/server";
import { listWorkbookPeriods } from "@/services/budget-workbook";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const url = new URL(request.url);
  const result = await listWorkbookPeriods(supabase, url.searchParams.get("ownerKind"), url.searchParams.get("ownerId"));
  return NextResponse.json(result.body, { status: result.status });
}
