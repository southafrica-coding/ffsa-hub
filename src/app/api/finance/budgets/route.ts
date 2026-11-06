/**
 * GET  /api/finance/budgets
 * POST /api/finance/budgets
 *
 * List and create sheet-shaped budget workbooks. Creates call
 * create_budget_from_template as the signed-in user. The organisation comes
 * from the fiscal period, and that period belongs to South Africa (ZAR).
 * Until those tables exist this returns 503 schema_not_applied.
 */

import { NextResponse } from "next/server";
import { FINANCE_ORG_COLUMNS, createBudgetWorkbook, listBudgetWorkbooks, type OrgReader } from "@/services/budget-workbook";
import { guardServiceRoleClient } from "@/lib/finance/preview-service-write";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function caller() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return supabase;
}

function orgReader(): OrgReader {
  return {
    async readFinanceOrg(key) {
      try {
        const admin = guardServiceRoleClient(createAdminClient());
        const result = await admin.from("finance_orgs").select(FINANCE_ORG_COLUMNS).eq("key", key).maybeSingle();
        return result;
      } catch {
        return { data: null, error: { message: "South Africa organisation couldn't be read." } };
      }
    },
  };
}

export async function GET(request: Request) {
  const supabase = await caller();
  if (!supabase) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const url = new URL(request.url);
  const result = await listBudgetWorkbooks(supabase, {
    ownerKind: url.searchParams.get("ownerKind"),
    ownerId: url.searchParams.get("ownerId"),
  });
  return NextResponse.json(result.body, { status: result.status });
}

export async function POST(request: Request) {
  const supabase = await caller();
  if (!supabase) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const result = await createBudgetWorkbook(supabase, body, orgReader());
  return NextResponse.json(result.body, { status: result.status });
}
