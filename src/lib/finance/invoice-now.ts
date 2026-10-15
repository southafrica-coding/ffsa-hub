// ────────────────────────────────────────────────────────────
// FFSA Hub — invoicing a student's charges now, by hand
// ────────────────────────────────────────────────────────────
// Finance can send any not-yet-invoiced charge straight away — a late joiner,
// or a student ready to pay ahead — instead of waiting for its date. This
// only re-dates WHEN the invoice is created (today) and, for "together", ties
// the chosen charges into one invoice. Due dates are never touched. The
// normal invoice run then does the rest, so a charge invoiced early goes
// through exactly the same path as one invoiced on schedule.
//
// Pure, so the rules are tested directly.
// ────────────────────────────────────────────────────────────

export interface InvoiceNowCharge {
  id: string;
  status: string;
  plan_id: string;
}

export interface InvoiceNowUpdate {
  id: string;
  status: "scheduled";
  scheduled_generation_date: string;
  combined_group_key: string;
}

/** Only charges with no invoice yet can be invoiced now. */
export const INVOICEABLE = new Set(["scheduled", "needs_decision"]);

export function planInvoiceNow(
  charges: InvoiceNowCharge[],
  opts: { together: boolean; today: string; key: string }
): { updates: InvoiceNowUpdate[]; skipped: string[]; error: string | null } {
  const ok = charges.filter((c) => INVOICEABLE.has(c.status));
  const skipped = charges.filter((c) => !INVOICEABLE.has(c.status)).map((c) => c.id);
  if (ok.length === 0) {
    return { updates: [], skipped, error: "None of those charges can be invoiced now — they're already invoiced, paid or cancelled." };
  }
  // One invoice can only belong to one billing plan (one Xero contact/org).
  if (opts.together && new Set(ok.map((c) => c.plan_id)).size > 1) {
    return {
      updates: [],
      skipped,
      error: "Those charges belong to different billing plans (e.g. two courses) and can't share one invoice. Invoice them separately.",
    };
  }
  return {
    updates: ok.map((c) => ({
      id: c.id,
      status: "scheduled",
      scheduled_generation_date: opts.today,
      // The run groups rows into an invoice by combined_group_key: one key
      // for all = one invoice; a key each = an invoice each.
      combined_group_key: opts.together ? `NOW-${opts.key}` : `NOW-${opts.key}-${c.id}`,
    })),
    skipped,
    error: null,
  };
}
