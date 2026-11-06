/**
 * Actuals for one budget, read from Xero. The signed-in client loads the
 * budget (RLS). The service-role client reads the Xero mirror and calls
 * Xero. Outreach expenses are not summed.
 */

import {
  attributeActuals,
  isMissingRelation,
  regionForBudgetCurrency,
  xeroDateOnly,
  type ActualLineInput,
  type XeroActualSpend,
} from "@/lib/finance/budget-actuals";
import { listXeroSpendTransactions, type XeroBankTransactionPage, type XeroRegion } from "@/services/xero";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type BudgetActualsBody = {
  budgetId: string;
  name: string;
  currency: string;
  source: "xero";
  period: { start: string; end: string };
  region: XeroRegion;
  lines: {
    lineId: string;
    name: string;
    plannedCents: number;
    actualCents: number | null;
    differenceCents: number | null;
  }[];
  unmatched: { count: number; cents: number };
  xero: { ok: true; partial: boolean } | { ok: false; reason: string };
};

type LineRow = {
  id: string;
  name: string;
  line_total_cents: number | string | null;
  archived_at: string | null;
  budget_line_coding?: {
    org_region: string;
    account_id: string | null;
    tracking_option_1_id: string | null;
    tracking_option_2_id: string | null;
  }[];
};

function spendsFrom(transactions: XeroBankTransactionPage[]): XeroActualSpend[] {
  const out: XeroActualSpend[] = [];
  for (const txn of transactions) {
    if (!txn.BankTransactionID) continue;
    for (const line of txn.LineItems ?? []) {
      const major =
        line.LineAmount != null
          ? Number(line.LineAmount)
          : Number(line.UnitAmount ?? 0) * Number(line.Quantity ?? 1);
      if (!Number.isFinite(major) || major === 0) continue;
      out.push({
        bankTransactionId: txn.BankTransactionID,
        accountCode: line.AccountCode ?? null,
        amountCents: Math.round(Math.abs(major) * 100),
        tracking: (line.Tracking ?? [])
          .filter((t) => t.Name && t.Option)
          .map((t) => ({ name: t.Name as string, option: t.Option as string })),
      });
    }
  }
  return out;
}

export async function getBudgetActuals(
  supabase: Client,
  admin: Client,
  budgetId: string
): Promise<{ status: number; body: BudgetActualsBody | { error: string; code?: string } }> {
  const { data, error } = await supabase
    .from("budgets")
    .select(
      `id, name, currency, archived_at,
       fiscal_periods!budgets_period_id_fkey(start_date, end_date),
       budget_lines!budget_lines_budget_id_fkey(
         id, name, line_total_cents, archived_at,
         budget_line_coding(org_region, account_id, tracking_option_1_id, tracking_option_2_id)
       )`
    )
    .eq("id", budgetId)
    .maybeSingle();

  if (error) {
    if (isMissingRelation(error)) {
      return {
        status: 503,
        body: {
          error: "Budget tables are not in the database yet. Hub Data applies them; actuals stay unread until then.",
          code: "schema_not_applied",
        },
      };
    }
    return { status: 500, body: { error: error.message ?? "Couldn't read that budget" } };
  }
  if (!data || data.archived_at) return { status: 404, body: { error: "Budget not found" } };

  const period = data.fiscal_periods as { start_date?: string; end_date?: string } | null;
  const start = period?.start_date ?? null;
  const end = period?.end_date ?? null;
  if (!start || !end) {
    return { status: 400, body: { error: "This budget has no period dates, so Xero actuals can't be bounded." } };
  }

  const region = regionForBudgetCurrency(data.currency);
  const lineRows = ((data.budget_lines ?? []) as LineRow[]).filter((line) => !line.archived_at);
  const codingFor = (line: LineRow) => (line.budget_line_coding ?? []).find((c) => c.org_region === region) ?? null;

  const accountIds = [...new Set(lineRows.map((line) => codingFor(line)?.account_id).filter((id): id is string => !!id))];
  const optionIds = [
    ...new Set(
      lineRows.flatMap((line) => {
        const coding = codingFor(line);
        return [coding?.tracking_option_1_id, coding?.tracking_option_2_id].filter((id): id is string => !!id);
      })
    ),
  ];

  const [{ data: accounts }, { data: options }] = await Promise.all([
    accountIds.length
      ? admin.from("xero_accounts").select("id, code, status").in("id", accountIds)
      : Promise.resolve({ data: [] as { id: string; code: string | null; status: string }[] }),
    optionIds.length
      ? admin.from("xero_tracking_options").select("id, name, category_id").in("id", optionIds)
      : Promise.resolve({ data: [] as { id: string; name: string; category_id: string }[] }),
  ]);
  const catIds = [...new Set((options ?? []).map((o: { category_id: string }) => o.category_id))];
  const { data: cats } = catIds.length
    ? await admin.from("xero_tracking_categories").select("id, name").in("id", catIds)
    : { data: [] as { id: string; name: string }[] };

  const accountRows = (accounts ?? []) as { id: string; code: string | null; status: string }[];
  const optionRows = (options ?? []) as { id: string; name: string; category_id: string }[];
  const catRows = (cats ?? []) as { id: string; name: string }[];
  const accountCode = new Map<string, string>();
  for (const account of accountRows) {
    if (account.status === "ACTIVE" && account.code) accountCode.set(account.id, account.code);
  }
  const catName = new Map(catRows.map((c) => [c.id, c.name]));
  const optionById = new Map<string, { name: string; option: string }>();
  for (const option of optionRows) {
    const name = catName.get(option.category_id) ?? "";
    if (name && option.name) optionById.set(option.id, { name, option: option.name });
  }

  const lines: ActualLineInput[] = lineRows.map((line) => {
    const coding = codingFor(line);
    const tracking: { name: string; option: string }[] = [];
    for (const id of [coding?.tracking_option_1_id, coding?.tracking_option_2_id]) {
      if (!id) continue;
      const hit = optionById.get(id);
      if (hit) tracking.push(hit);
    }
    return {
      lineId: line.id,
      name: line.name,
      plannedCents: Math.round(Number(line.line_total_cents ?? 0)),
      accountCode: coding?.account_id ? accountCode.get(coding.account_id) ?? null : null,
      tracking,
    };
  });

  const xero = await listXeroSpendTransactions(admin, region, { start, end });
  if (!xero.ok) {
    const unknown = attributeActuals(
      lines.map((line) => ({ ...line, accountCode: null })),
      []
    );
    return {
      status: 200,
      body: {
        budgetId: data.id,
        name: data.name,
        currency: data.currency,
        source: "xero",
        period: { start, end },
        region,
        lines: unknown.lines,
        unmatched: { count: 0, cents: 0 },
        xero: { ok: false, reason: xero.reason },
      },
    };
  }

  // Drop transactions whose date we can't read, so a bad row can't land in the wrong period.
  const inPeriod = xero.transactions.filter((txn) => {
    const date = xeroDateOnly(txn.Date);
    return date != null && date >= start && date <= end;
  });
  const attributed = attributeActuals(lines, spendsFrom(inPeriod));
  return {
    status: 200,
    body: {
      budgetId: data.id,
      name: data.name,
      currency: data.currency,
      source: "xero",
      period: { start, end },
      region,
      lines: attributed.lines,
      unmatched: attributed.unmatched,
      xero: { ok: true, partial: xero.partial },
    },
  };
}
