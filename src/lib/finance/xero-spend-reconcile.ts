/**
 * Match one Xero bank transaction to a stalled receipt claim.
 *
 * GET /BankTransactions accepts a References query (Xero Accounting OpenAPI,
 * operation getBankTransactions). BankTransaction.Reference is documented for
 * SPEND and RECEIVE. Idempotency-Key is only a write header ("safely retry",
 * 128 characters). The spec does not say the key can be read back or how long
 * it is kept, so a key and a local row are not a match.
 */

export type RemoteSpend = {
  bankTransactionId?: string | null;
  reference?: string | null;
  type?: string | null;
  status?: string | null;
  date?: string | null;
  currencyCode?: string | null;
  total?: number | null;
};

export type SpendExpectation = {
  reference: string;
  spentOn: string;
  amountCents: number;
  currency: "ZAR";
};

export type ReconcileMatch =
  | { ok: true; bankTransactionId: string }
  | { ok: false; reason: "not_found" | "ambiguous" | "mismatch" | "unproven" };

export function matchStalledSpend(remote: RemoteSpend[] | null | undefined, expected: SpendExpectation): ReconcileMatch {
  if (!remote) return { ok: false, reason: "unproven" };
  const sameReference = remote.filter((row) => row.reference === expected.reference);
  if (sameReference.length === 0) return { ok: false, reason: "not_found" };
  if (sameReference.length > 1) return { ok: false, reason: "ambiguous" };
  const row = sameReference[0];
  const id = (row.bankTransactionId ?? "").trim();
  if (!id) return { ok: false, reason: "unproven" };
  if (row.type !== "SPEND" || row.status !== "AUTHORISED") return { ok: false, reason: "mismatch" };
  if (row.date !== expected.spentOn) return { ok: false, reason: "mismatch" };
  if (row.currencyCode !== expected.currency) return { ok: false, reason: "mismatch" };
  if (row.total == null || !Number.isFinite(row.total)) return { ok: false, reason: "mismatch" };
  if (Math.round(row.total * 100) !== expected.amountCents) return { ok: false, reason: "mismatch" };
  return { ok: true, bankTransactionId: id };
}
