/**
 * GET /api/finance/budgets/[id]/actuals
 *
 * Planned amounts from the budget, actual amounts from Xero spend in the
 * budget's period. Outreach expenses are not included. Until Hub Data
 * applies the budget tables this returns 503 schema_not_applied.
 */

import { NextResponse } from "next/server";
import { canReadFinanceXero } from "@/lib/finance/orgs";
import { getBudgetActuals } from "@/services/budget-actuals";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!(await canReadFinanceXero(supabase, user.id))) {
    return NextResponse.json({ error: "You don't have permission to see finance data from Xero" }, { status: 403 });
  }

  const { id } = await context.params;
  if (!id) return NextResponse.json({ error: "Missing budget id" }, { status: 400 });

  const result = await getBudgetActuals(supabase, createAdminClient(), id);
  return NextResponse.json(result.body, { status: result.status });
}
