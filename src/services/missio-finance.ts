// ────────────────────────────────────────────────────────────
// Missio Finance — data access (migration 394)
// ────────────────────────────────────────────────────────────
// Cash and FundraiseUp amounts entered by Missio pastors. Pass the signed-in
// user's client: RLS keeps every read and write to Missio pastors. Returns
// Supabase's raw { data, error }.

type Client = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export const MISSIO_FINANCE_ENTRY_COLUMNS =
  "id, source, month, cash_cents, usd_cents, usd_zar_rate, rate_note, zar_cents, note, updated_at";

export type MissioFinanceEntryRow = {
  id: string;
  source: "cash" | "fundraiseup";
  /** YYYY-MM-01 */
  month: string;
  cash_cents: number | null;
  usd_cents: number | null;
  usd_zar_rate: string | number | null;
  rate_note: string | null;
  zar_cents: number | null;
  note: string | null;
  updated_at: string;
};

// ────────────────────────────────────────────────────────────
// READ
// ────────────────────────────────────────────────────────────

export async function listMissioFinanceEntries(
  supabase: Client,
  options: { orgId: string; fromMonth: string; toMonth: string }
) {
  return supabase
    .from("missio_finance_entries")
    .select(MISSIO_FINANCE_ENTRY_COLUMNS)
    .eq("org_id", options.orgId)
    .gte("month", `${options.fromMonth}-01`)
    .lte("month", `${options.toMonth}-01`)
    .order("month");
}

// ────────────────────────────────────────────────────────────
// WRITE — one row per org, source and month; a second save edits it
// ────────────────────────────────────────────────────────────

export async function saveMissioFinanceEntry(
  supabase: Client,
  entry:
    | { orgId: string; source: "cash"; month: string; cashCents: number; note: string | null }
    | {
        orgId: string;
        source: "fundraiseup";
        month: string;
        usdCents: number;
        /** Rand per dollar as a decimal string, e.g. "18.25" (numeric(12,6)). */
        rate: string;
        rateNote: string | null;
        note: string | null;
      }
) {
  const row =
    entry.source === "cash"
      ? { cash_cents: entry.cashCents, usd_cents: null, usd_zar_rate: null, rate_note: null }
      : { cash_cents: null, usd_cents: entry.usdCents, usd_zar_rate: entry.rate, rate_note: entry.rateNote };
  return supabase
    .from("missio_finance_entries")
    .upsert(
      { org_id: entry.orgId, source: entry.source, month: `${entry.month}-01`, note: entry.note, ...row },
      { onConflict: "org_id,source,month" }
    )
    .select(MISSIO_FINANCE_ENTRY_COLUMNS)
    .single();
}

export async function deleteMissioFinanceEntry(
  supabase: Client,
  options: { orgId: string; source: "cash" | "fundraiseup"; month: string }
) {
  return supabase
    .from("missio_finance_entries")
    .delete()
    .eq("org_id", options.orgId)
    .eq("source", options.source)
    .eq("month", `${options.month}-01`)
    .select("id");
}
