import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageFinance } from "@/lib/api-auth";
import { generateDueInvoices } from "@/services/billing-generation";

// Manual trigger for finance — same engine as the cron, but gated.
// POST { dryRun?: boolean, asOf?: 'YYYY-MM-DD' }
// dryRun=true previews what WOULD generate (no Xero writes) — use this to
// sanity-check against real Xero before trusting the unattended cron.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!(await canManageFinance(supabase, user.id))) {
    return NextResponse.json(
      { error: "You don't have permission to generate invoices" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const dryRun = body.dryRun !== false; // default to dry-run for safety
  const asOf = body.asOf || new Date().toISOString().split("T")[0];

  const admin = createAdminClient();
  try {
    const result = await generateDueInvoices(admin, {
      asOf,
      dryRun,
      autoSend: true,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Generation failed" },
      { status: 500 }
    );
  }
}
