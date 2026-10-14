// ────────────────────────────────────────────────────────────
// FFSA Hub — per-school rules for an invoice run
// ────────────────────────────────────────────────────────────
// Every school carries three billing settings (migration 172):
//
//   billing_mode            external → the Hub never invoices it
//   schedule_start_date     charges due before it are history, never invoiced
//   billing_emails_enabled  off → invoices land in Xero as DRAFTS, nobody is
//                           emailed, nothing is approved
//
// The run used to ignore all three and email everything. This is the one place
// that decides, so the daily cron, the manual button and deposit-on-acceptance
// cannot drift apart. Pure — no database, no Xero — so it is tested directly.
// ────────────────────────────────────────────────────────────

export interface SchoolBillingSettings {
  billing_mode: "external" | "hub_scheduled" | string | null;
  billing_emails_enabled: boolean | null;
  schedule_start_date: string | null; // YYYY-MM-DD
}

export interface RunRow {
  id: string;
  due_date: string; // YYYY-MM-DD
}

export type SkipReason = "outside_hub" | "before_start_date";

export const SKIP_REASON_TEXT: Record<SkipReason, string> = {
  outside_hub: "School is billed outside the Hub",
  before_start_date: "Due before the school's billing start date",
};

export interface GroupDecision<R extends RunRow> {
  /** Rows to put on the invoice. Empty means no invoice at all. */
  invoice: R[];
  /** Rows left untouched (still 'scheduled'), with why. */
  skipped: Array<{ row: R; reason: SkipReason }>;
  /** Authorise + email the invoice, or leave it as a Xero draft. */
  send: boolean;
}

/**
 * Decide what one invoice group (rows sharing a plan + due date / prepay key)
 * becomes for its school.
 *
 * `allowSend` is the caller's ceiling — a run that never sends stays that way
 * whatever the school says. A school with no settings row (unknown or deleted)
 * is treated as external: a run must never assume permission to bill.
 */
export function decideInvoiceGroup<R extends RunRow>(
  rows: R[],
  school: SchoolBillingSettings | null | undefined,
  allowSend: boolean
): GroupDecision<R> {
  if (!school || school.billing_mode !== "hub_scheduled") {
    return {
      invoice: [],
      skipped: rows.map((row) => ({ row, reason: "outside_hub" as const })),
      send: false,
    };
  }

  const startsAt = school.schedule_start_date;
  const invoice: R[] = [];
  const skipped: GroupDecision<R>["skipped"] = [];
  for (const row of rows) {
    // String compare is safe: both are YYYY-MM-DD.
    if (startsAt && row.due_date < startsAt) {
      skipped.push({ row, reason: "before_start_date" });
    } else {
      invoice.push(row);
    }
  }

  return {
    invoice,
    skipped,
    send: allowSend && school.billing_emails_enabled === true,
  };
}
