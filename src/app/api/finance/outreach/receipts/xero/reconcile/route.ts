/**
 * POST /api/finance/outreach/receipts/xero/reconcile  { draftId }
 *
 * Finance editor only. Reads Xero. Does not POST a spend and does not
 * accept a bank transaction id from the caller.
 */

import { NextResponse } from "next/server";
import { reconcileStalledSpend } from "@/lib/finance/record-xero-spend";
import { xeroPreviewWriteBlock } from "@/lib/finance/xero-preview-guard";
import { canEditFinanceProjects } from "@/lib/finance/orgs";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await canEditFinanceProjects(supabase, user.id))) {
    return NextResponse.json({ error: "You don't have permission to reconcile a receipt." }, { status: 403 });
  }

  let body: { draftId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const draftId = typeof body.draftId === "string" ? body.draftId : "";
  if (!draftId) return NextResponse.json({ error: "draftId is required" }, { status: 400 });

  const blocked = xeroPreviewWriteBlock();
  if (blocked) return NextResponse.json(blocked, { status: 403 });

  const result = await reconcileStalledSpend(supabase, createAdminClient(), draftId);
  return NextResponse.json(result.body, { status: result.httpStatus });
}
