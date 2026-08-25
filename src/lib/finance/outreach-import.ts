/**
 * Identity for one imported outreach expense row.
 *
 * Lives apart from the route because it is the part worth testing: the
 * importer's whole guarantee — run the same sheet twice, get the same
 * expenses once — rests on this function being stable and on it drawing
 * the line between "the same row again" and "a row that changed".
 */
import { createHash } from "node:crypto";

export type ImportRow = {
  category_id: string;
  expense_date: string;
  zar_amount: number;
  receipt_code?: string | null;
  vendor?: string | null;
  description?: string | null;
  purchaser?: string | null;
  local_currency?: string | null;
  local_amount?: number | null;
  exchange_rate?: number | null;
  notes?: string | null;
};

/**
 * Computed on the server from normalised content, so a client cannot widen
 * or narrow what counts as "the same row". Amounts are fixed to 2dp because
 * a sheet may hand us 15.1 where the last import gave 15.10. Fields are
 * joined with a delimiter so content cannot slide between columns.
 */
export function rowKey(teamId: string, r: ImportRow): string {
  const norm = (v: string | null | undefined) =>
    (v ?? "").toString().trim().toLowerCase().split(/[ \t\n]+/).join(" ");
  const parts = [
    teamId,
    r.category_id,
    norm(r.expense_date),
    norm(r.receipt_code),
    norm(r.vendor),
    norm(r.description),
    Number(r.zar_amount).toFixed(2),
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}
