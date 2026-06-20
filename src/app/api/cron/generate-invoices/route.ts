import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateDueInvoices } from "@/services/billing-generation";

export const maxDuration = 60;

// Daily cron (Vercel) — generates+sends invoices whose generation date has
// arrived. Protected by CRON_SECRET. Idempotent: only acts on 'scheduled' rows.
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const asOf = new Date().toISOString().split("T")[0];
  const supabase = createAdminClient();

  try {
    const result = await generateDueInvoices(supabase, {
      asOf,
      dryRun: false,
      autoSend: true, // auto-authorise + email (per finance decision)
    });
    const sent = result.invoices.filter((i) => i.status === "sent").length;
    const generated = result.invoices.filter((i) => i.status === "generated").length;
    const failed = result.invoices.filter((i) => i.status === "failed").length;
    console.log(
      `[cron/generate-invoices] ${asOf}: ${sent} sent, ${generated} draft, ${failed} failed`
    );
    return NextResponse.json({ ok: true, asOf, sent, generated, failed });
  } catch (err) {
    console.error("[cron/generate-invoices] failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Generation failed" },
      { status: 500 }
    );
  }
}
