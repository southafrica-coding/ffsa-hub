// ────────────────────────────────────────────────────────────
// FFSA Hub — reading school-fee payments back from Xero
// ────────────────────────────────────────────────────────────
// Xero is the record of payments; the Hub is the record of schedules. Until
// this existed nothing told the Hub a charge had been paid, so every invoiced
// charge read "due" forever.
//
// syncInvoicePayments() looks up the current payment state of Hub-made
// invoices in Xero and writes it onto their charges (amount_paid_zar,
// status 'paid', paid_at), spreading each invoice's payments over its charges
// with allocateInvoicePayments(). Matching is by Xero invoice id only — never
// by name or amount.
//
// Callers: the Xero webhook (just the invoices Xero says changed), the daily
// invoice cron (every open invoice, as a catch-up), and a manual refresh.
// ────────────────────────────────────────────────────────────

import { getXeroInvoicePaymentStates, type XeroRegion } from "@/services/xero";
import { allocateInvoicePayments, type ChargeOnInvoice } from "@/lib/finance/payment-allocation";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export interface PaymentSyncResult {
  invoicesChecked: number;
  chargesUpdated: number;
  /** Invoices voided/deleted in Xero while the Hub still expects money. */
  voided: Array<{ invoiceNumber: string | null; region: XeroRegion }>;
  /** Hub invoices Xero didn't return (deleted outright, or wrong organisation). */
  missing: Array<{ invoiceId: string; region: XeroRegion }>;
  errors: string[];
}

type Row = ChargeOnInvoice & {
  xero_invoice_id: string;
  student_billing_plans: { xero_region: XeroRegion; program_id: string } | null;
};

/**
 * Sync payments for Hub invoices.
 *
 * - `invoiceIds`: only these (from a webhook). Otherwise every invoice the Hub
 *   still considers open — 'generated' or 'sent' — plus 'paid' ones touched in
 *   the last 30 days, so a payment reversed in Xero comes back off.
 * - `programId`: limit to one school (the manual refresh button).
 */
export async function syncInvoicePayments(
  supabase: Client,
  opts: { invoiceIds?: string[]; programId?: string; region?: XeroRegion } = {}
): Promise<PaymentSyncResult> {
  const result: PaymentSyncResult = { invoicesChecked: 0, chargesUpdated: 0, voided: [], missing: [], errors: [] };
  const nowIso = new Date().toISOString();

  const select =
    "id, amount_zar, due_date, sequence, status, amount_paid_zar, sent_at, paid_at, xero_invoice_id, student_billing_plans!inner(xero_region, program_id)";

  // Every charge on the invoices in question — an invoice's payments are
  // spread over ALL its charges, so a partial set would mis-allocate.
  let invoiceIds = opts.invoiceIds ? [...new Set(opts.invoiceIds)] : null;
  if (!invoiceIds) {
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    let q = supabase
      .from("student_billing_schedule")
      .select("xero_invoice_id, student_billing_plans!inner(program_id, xero_region)")
      .not("xero_invoice_id", "is", null)
      .or(`status.in.(generated,sent),and(status.eq.paid,updated_at.gte.${since})`);
    if (opts.programId) q = q.eq("student_billing_plans.program_id", opts.programId);
    if (opts.region) q = q.eq("student_billing_plans.xero_region", opts.region);
    // Paged: PostgREST silently caps a read at 1000 rows.
    const ids = new Set<string>();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await q.range(from, from + 999);
      if (error) {
        result.errors.push(`Could not read open invoices: ${error.message}`);
        return result;
      }
      for (const r of data ?? []) ids.add(r.xero_invoice_id);
      if (!data || data.length < 1000) break;
    }
    invoiceIds = [...ids];
  }
  if (invoiceIds.length === 0) return result;

  const rows: Row[] = [];
  for (let i = 0; i < invoiceIds.length; i += 200) {
    const { data, error } = await supabase
      .from("student_billing_schedule")
      .select(select)
      .in("xero_invoice_id", invoiceIds.slice(i, i + 200));
    if (error) {
      result.errors.push(`Could not read charges: ${error.message}`);
      return result;
    }
    rows.push(...((data ?? []) as Row[]));
  }

  // Group charges by invoice, invoices by organisation.
  const byInvoice = new Map<string, Row[]>();
  for (const r of rows) {
    if (!byInvoice.has(r.xero_invoice_id)) byInvoice.set(r.xero_invoice_id, []);
    byInvoice.get(r.xero_invoice_id)!.push(r);
  }
  const byRegion = new Map<XeroRegion, string[]>();
  for (const [id, charges] of byInvoice) {
    const region = charges[0].student_billing_plans?.xero_region ?? "za";
    if (!byRegion.has(region)) byRegion.set(region, []);
    byRegion.get(region)!.push(id);
  }

  for (const [region, ids] of byRegion) {
    const { data: states, error } = await getXeroInvoicePaymentStates(supabase, region, ids);
    if (error) result.errors.push(`${region.toUpperCase()}: ${error}`);

    for (const id of ids) {
      const state = states.get(id);
      if (!state) {
        if (!error) result.missing.push({ invoiceId: id, region });
        continue;
      }
      result.invoicesChecked++;
      if (state.status === "VOIDED" || state.status === "DELETED") {
        const charges = byInvoice.get(id)!;
        if (charges.some((c) => c.status !== "cancelled" && c.status !== "paid")) {
          result.voided.push({ invoiceNumber: state.invoiceNumber, region });
        }
        continue;
      }

      const updates = allocateInvoicePayments(byInvoice.get(id)!, state, nowIso);
      for (const u of updates) {
        const { error: upErr } = await supabase
          .from("student_billing_schedule")
          .update({ amount_paid_zar: u.amount_paid_zar, status: u.status, paid_at: u.paid_at })
          .eq("id", u.id);
        if (upErr) result.errors.push(`Charge ${u.id}: ${upErr.message}`);
        else result.chargesUpdated++;
      }
    }
  }

  return result;
}
