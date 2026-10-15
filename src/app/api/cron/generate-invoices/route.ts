import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateDueInvoices } from "@/services/billing-generation";
import { syncInvoicePayments } from "@/services/billing-payments";
import { syncTicketInvoicePayments } from "@/lib/ticketing/pay-later";

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
    // Daily catch-up for school-fee payments (the Xero webhook is the fast
    // path; this covers anything it missed). Runs first so today's run sees
    // current balances. Never blocks invoicing if Xero can't be read.
    const payments = await syncInvoicePayments(supabase).catch((err) => ({
      invoicesChecked: 0,
      chargesUpdated: 0,
      voided: [],
      missing: [],
      errors: [err instanceof Error ? err.message : "payment sync failed"],
    }));
    console.log(
      `[cron/generate-invoices] payments: ${payments.invoicesChecked} invoices checked, ${payments.chargesUpdated} charges updated` +
        (payments.voided.length ? `, ${payments.voided.length} voided in Xero` : "") +
        (payments.errors.length ? `, errors: ${payments.errors.join("; ")}` : "")
    );

    // Same catch-up for pay-later ticket invoices (tickets issue on full payment).
    const tickets = await syncTicketInvoicePayments(supabase).catch((err) => ({
      checked: 0, partPaid: 0, settled: 0, cancelled: 0,
      errors: [err instanceof Error ? err.message : "ticket invoice sync failed"],
    }));
    console.log(`[cron/generate-invoices] ticket invoices: ${JSON.stringify(tickets)}`);

    const result = await generateDueInvoices(supabase, {
      asOf,
      dryRun: false,
      // Ceiling only — each school's own settings decide whether its invoices
      // are emailed, held as Xero drafts, or skipped (invoice-run-policy.ts).
      autoSend: true,
    });
    const sent = result.invoices.filter((i) => i.status === "sent").length;
    const generated = result.invoices.filter((i) => i.status === "generated").length;
    const failed = result.invoices.filter((i) => i.status === "failed").length;
    const skipped = result.invoices.filter((i) => i.status === "skipped").length;
    console.log(
      `[cron/generate-invoices] ${asOf}: ${sent} sent, ${generated} draft, ${failed} failed, ${skipped} skipped`
    );
    return NextResponse.json({
      ok: true,
      asOf,
      sent,
      generated,
      failed,
      skipped,
      payments: { checked: payments.invoicesChecked, updated: payments.chargesUpdated, voided: payments.voided.length },
    });
  } catch (err) {
    console.error("[cron/generate-invoices] failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Generation failed" },
      { status: 500 }
    );
  }
}
