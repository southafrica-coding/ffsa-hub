/**
 * Words for POST /api/finance/outreach/receipts/xero { draftId }.
 *
 * The route retries a receipt that is already confirmed. It does not
 * confirm a draft, and a second call does not create a second spend.
 */

export type ConfirmedReceiptDraft = {
  id: string;
  expenseId: string | null;
  label: string;
  fileName: string;
};

export function confirmedReceiptDraft(row: {
  id?: unknown;
  expense_id?: unknown;
  file_name?: unknown;
  proposal?: unknown;
  kind?: unknown;
}): ConfirmedReceiptDraft | null {
  if (row.kind === "cash_pull") return null;
  const id = typeof row.id === "string" ? row.id : "";
  if (!id) return null;
  const fileName = typeof row.file_name === "string" && row.file_name.trim() ? row.file_name.trim() : "Receipt";
  const proposal = row.proposal && typeof row.proposal === "object" ? (row.proposal as Record<string, unknown>) : {};
  const label =
    text(proposal.budget_line_label) || text(proposal.description) || text(proposal.vendor) || fileName;
  return {
    id,
    expenseId: typeof row.expense_id === "string" ? row.expense_id : null,
    label,
    fileName,
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * What to tell the person after the retry. "already_written" and "written"
 * both mean the same spend, not a new one.
 */
export function retryXeroMessage(status: number, body: unknown): string {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const error = typeof record.error === "string" ? record.error : "";
  const result = typeof record.status === "string" ? record.status : "";

  if (status === 409) return "This receipt isn't confirmed, so it wasn't sent to Xero.";
  if (status === 403) return "You don't have permission to send a receipt to Xero.";
  if (status === 404) {
    return error.toLowerCase().includes("not found")
      ? "That receipt wasn't found. Nothing was sent."
      : "Sending a receipt to Xero isn't available yet. Nothing was sent.";
  }
  if (status === 401) return "You're not signed in. Nothing was sent.";
  if (!status || status >= 400) return error || "Xero didn't take it. Nothing new was created.";

  switch (result) {
    case "written":
      return "Sent to Xero. This is the same receipt, not a second spend.";
    case "already_written":
      return "Already in Xero. Nothing new was created.";
    case "rand_not_confirmed":
      return "Not sent to Xero yet — it waits until the bank confirms the rand.";
    case "no_account":
      return "Not sent to Xero — this budget line has no account yet.";
    case "no_bank_account":
      return "Not sent to Xero — the spend bank account isn't set.";
    case "repayment":
    case "no_receipt":
      return "Not sent to Xero. No receipt, so the purchaser repays this.";
    case "not_confirmed":
      return "Not sent to Xero — it hasn't been confirmed.";
    case "failed":
      return "Saved here. Xero did not take it. Nothing new was created.";
    default:
      return "Xero answered. Nothing new was created.";
  }
}
