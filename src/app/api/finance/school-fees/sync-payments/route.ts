import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageFinance } from "@/lib/api-auth";
import { syncInvoicePayments } from "@/services/billing-payments";

// POST { programId? } — pull the latest school-fee payments from Xero now,
// instead of waiting for the webhook or the daily catch-up. Finance-gated.
export const maxDuration = 60;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await canManageFinance(supabase, user.id))) {
    return NextResponse.json({ error: "Finance access required" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const programId = typeof body.programId === "string" && body.programId ? body.programId : undefined;
  const result = await syncInvoicePayments(createAdminClient(), { programId });
  return NextResponse.json({ success: result.errors.length === 0, ...result });
}
