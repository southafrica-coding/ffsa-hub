/**
 * GET /api/finance/budgets/[id]
 * PUT /api/finance/budgets/[id]
 * PATCH /api/finance/budgets/[id]
 *
 * Load or save one sheet-shaped workbook. Saving calls apply_budget_workbook
 * as the signed-in user. Send updatedAt from the last load. Owner,
 * organisation, currency and period stay as they were. Coding is not accepted.
 * Until the workbook tables exist this returns 503 schema_not_applied.
 */

import { NextResponse } from "next/server";
import { previewBudgetWriteBlocked } from "@/lib/finance/preview-service-write";
import { getBudgetWorkbook, saveBudgetWorkbook } from "@/services/budget-workbook";
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

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const supabase = await caller();
  if (!supabase) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await context.params;
  const result = await getBudgetWorkbook(supabase, id);
  return NextResponse.json(result.body, { status: result.status });
}

async function save(request: Request, context: { params: Promise<{ id: string }> }) {
  const preview = previewBudgetWriteBlocked();
  if (preview) return NextResponse.json(preview, { status: 403 });
  const supabase = await caller();
  if (!supabase) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const result = await saveBudgetWorkbook(supabase, id, body);
  return NextResponse.json(result.body, { status: result.status });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  return save(request, context);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return save(request, context);
}
