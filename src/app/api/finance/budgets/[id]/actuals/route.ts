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

  const { id } = await context.params;
  if (!id) return NextResponse.json({ error: "Missing budget id" }, { status: 400 });

  // The user's own row-level access is enough for a budget they can already
  // read. A 404 from that read can mean the row is hidden, not missing.
  // canReadFinanceXero may then load the same budget with the service role.
  // Anyone else is refused and the admin client is not used for the row.
  const admin = createAdminClient();
  const result = await getBudgetActuals(supabase, admin, id);
  if (result.status === 404 && (await canReadFinanceXero(supabase, user.id))) {
    const asFinance = await getBudgetActuals(admin, admin, id);
    return NextResponse.json(asFinance.body, { status: asFinance.status });
  }
  if (result.status !== 404) {
    return NextResponse.json(result.body, { status: result.status });
  }
  return NextResponse.json({ error: "You don't have permission to see this budget" }, { status: 403 });
}
