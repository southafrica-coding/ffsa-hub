// ────────────────────────────────────────────────────────────
// FFSA Hub — spreading a Xero invoice's payments over its charges
// ────────────────────────────────────────────────────────────
// Xero is the record of payments (docs/redesign/07-finance-billing.md §9);
// the Hub reads them back. Xero tracks what's paid per INVOICE, while the
// Hub tracks per CHARGE, and one invoice can carry several charges (a
// deposit + outreach due the same day, a prepaid quarter). So an invoice's
// AmountPaid is spread over its charges oldest-due first: the earliest charge
// fills before the next starts.
//
// Pure, so the money is tested without Xero or a database.
// ────────────────────────────────────────────────────────────

export interface ChargeOnInvoice {
  id: string;
  amount_zar: number;
  due_date: string; // YYYY-MM-DD
  sequence?: number | null;
  status: string;
  amount_paid_zar: number;
  sent_at: string | null;
  paid_at: string | null;
}

export interface XeroInvoicePayments {
  /** Xero Status: DRAFT | SUBMITTED | AUTHORISED | PAID | VOIDED | DELETED */
  status: string;
  amountPaid: number;
  /** Xero's FullyPaidOnDate, YYYY-MM-DD, when fully paid. */
  fullyPaidOn: string | null;
}

export interface ChargeUpdate {
  id: string;
  amount_paid_zar: number;
  status: string;
  paid_at: string | null;
}

const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * What each charge on one invoice should now read. Returns only the charges
 * that change, so re-running a sync is a no-op.
 *
 * - Paid amounts are recomputed from Xero every time, so a payment removed
 *   in Xero comes back off the Hub too.
 * - A charge is 'paid' only when fully covered; part-paid keeps its invoice
 *   status ('sent', or 'generated' if it was never emailed) with the partial
 *   amount recorded.
 * - VOIDED / DELETED invoices are left alone: that's a decision about the
 *   charge (cancel it? re-invoice it?), not a payment fact. The caller reports
 *   them instead.
 * - 'cancelled' charges are never touched.
 */
export function allocateInvoicePayments(
  charges: ChargeOnInvoice[],
  invoice: XeroInvoicePayments,
  nowIso: string
): ChargeUpdate[] {
  if (invoice.status === "VOIDED" || invoice.status === "DELETED") return [];

  const live = charges
    .filter((c) => c.status !== "cancelled")
    .sort(
      (a, b) =>
        a.due_date.localeCompare(b.due_date) ||
        (a.sequence ?? 0) - (b.sequence ?? 0) ||
        a.id.localeCompare(b.id)
    );

  const invoiceTotal = cents(live.reduce((s, c) => s + Number(c.amount_zar), 0));
  // Xero says PAID → every charge is settled, whatever rounding says.
  let remaining = invoice.status === "PAID" ? invoiceTotal : cents(Math.max(0, invoice.amountPaid));
  const paidAt = invoice.fullyPaidOn ? `${invoice.fullyPaidOn}T00:00:00Z` : nowIso;

  const updates: ChargeUpdate[] = [];
  for (const c of live) {
    const amount = cents(Number(c.amount_zar));
    const paid = cents(Math.min(amount, remaining));
    remaining = cents(remaining - paid);

    const full = amount > 0 ? paid >= amount : invoice.status === "PAID";
    const status = full ? "paid" : c.sent_at ? "sent" : "generated";
    const next: ChargeUpdate = {
      id: c.id,
      amount_paid_zar: paid,
      status,
      // Keep the first paid date we saw; clear it if the payment went away.
      paid_at: full ? (c.paid_at ?? paidAt) : null,
    };
    if (
      cents(Number(c.amount_paid_zar)) !== next.amount_paid_zar ||
      c.status !== next.status ||
      (c.paid_at ?? null) !== next.paid_at
    ) {
      updates.push(next);
    }
  }
  return updates;
}
