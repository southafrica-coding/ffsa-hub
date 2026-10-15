import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageFinance } from "@/lib/api-auth";
import { createAuditLog } from "@/services/audit";
import { setUpMissingPlans, checkProgramAgainstXero, linkMatches, switchStudentTier } from "@/services/xero-match";
import type { Tier } from "@/services/school-billing";

// POST { programId, action, ... } — Match to Xero (src/services/xero-match.ts).
//   action "setup": a billing plan for every student without one (no invoices)
//   action "check": read-only — each student's Xero invoices matched to charges
//   action "link":  { pairs: [{ chargeId, invoiceId }] } — record chosen matches
//   action "tier":  { enrollmentId, tier } — rebuild a plan at another tier
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

  const b = await request.json().catch(() => ({}));
  const programId = typeof b.programId === "string" ? b.programId : "";
  if (!programId) return NextResponse.json({ error: "programId required" }, { status: 400 });
  const admin = createAdminClient();

  try {
    switch (b.action) {
      case "check":
        return NextResponse.json(await checkProgramAgainstXero(admin, programId));

      case "setup": {
        const res = await setUpMissingPlans(admin, programId, user.id);
        await createAuditLog(supabase, {
          action: "billing.match_xero_setup",
          resource_type: "program",
          resource_id: programId,
          changes: { created: res.created.length, failed: res.failed.length },
        });
        return NextResponse.json(res);
      }

      case "link": {
        const pairs = (Array.isArray(b.pairs) ? b.pairs : []).filter(
          (p: unknown): p is { chargeId: string; invoiceId: string } =>
            !!p && typeof (p as { chargeId: unknown }).chargeId === "string" && typeof (p as { invoiceId: unknown }).invoiceId === "string"
        );
        if (pairs.length === 0) return NextResponse.json({ error: "Pick at least one match" }, { status: 400 });
        const res = await linkMatches(admin, programId, pairs);
        await createAuditLog(supabase, {
          action: "billing.match_xero_link",
          resource_type: "program",
          resource_id: programId,
          changes: { pairs, linked: res.linked, skipped: res.skipped },
        });
        return NextResponse.json(res);
      }

      case "tier": {
        const tier = b.tier as Tier;
        if (typeof b.enrollmentId !== "string" || !["A", "B", "C"].includes(tier)) {
          return NextResponse.json({ error: "enrollmentId and tier A/B/C required" }, { status: 400 });
        }
        const res = await switchStudentTier(admin, programId, b.enrollmentId, tier, user.id);
        if (!res.ok) return NextResponse.json({ error: res.error }, { status: 409 });
        await createAuditLog(supabase, {
          action: "billing.match_xero_tier",
          resource_type: "enrollment",
          resource_id: b.enrollmentId,
          changes: { tier },
        });
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
