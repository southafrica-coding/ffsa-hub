import { TEAM_CASH_METHODS } from "@/lib/finance/outreach-cash";
import {
  getRecentStudentPayments,
  getUnreferencedBankPayments,
} from "./school-fees";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

// ────────────────────────────────────────────────────────────
// OUTREACH TEAMS
// ────────────────────────────────────────────────────────────

export async function getOutreachTeams(
  supabase: Client,
  options?: { programId?: string; status?: string; search?: string }
) {
  let query = supabase
    .from("outreach_teams")
    .select("*, programs(id, name, code)")
    .order("created_at", { ascending: false });

  if (options?.programId) {
    query = query.eq("program_id", options.programId);
  }
  if (options?.status) {
    query = query.eq("status", options.status);
  }
  if (options?.search) {
    query = query.or(
      `team_name.ilike.%${options.search}%,location.ilike.%${options.search}%`
    );
  }

  return query;
}

export async function getOutreachTeamById(supabase: Client, teamId: string) {
  return supabase
    .from("outreach_teams")
    .select("*, programs(id, name, code)")
    .eq("id", teamId)
    .single();
}

export async function createOutreachTeam(
  supabase: Client,
  data: {
    program_id: string;
    team_name: string;
    location?: string | null;
    country?: string | null;
    start_date?: string | null;
    end_date?: string | null;
    people_count?: number;
    total_budget_zar?: number;
    currency?: string;
    notes?: string | null;
    drive_folder_url?: string | null;
    created_by: string;
  }
) {
  return supabase.from("outreach_teams").insert(data).select().single();
}

export async function updateOutreachTeam(
  supabase: Client,
  teamId: string,
  data: Record<string, unknown>
) {
  return supabase
    .from("outreach_teams")
    .update(data)
    .eq("id", teamId)
    .select()
    .single();
}

// ────────────────────────────────────────────────────────────
// TEAM MEMBERS
// ────────────────────────────────────────────────────────────

export async function getTeamMembers(supabase: Client, teamId: string) {
  return supabase
    .from("outreach_team_members")
    .select(
      "*, users!outreach_team_members_user_id_fkey(id, first_name, last_name, preferred_name, email, slack_user_id)"
    )
    .eq("team_id", teamId)
    .order("role", { ascending: true });
}

export async function addTeamMember(
  supabase: Client,
  data: { team_id: string; user_id: string; role: string }
) {
  return supabase
    .from("outreach_team_members")
    .insert(data)
    .select()
    .single();
}

export async function updateTeamMemberRole(
  supabase: Client,
  id: string,
  role: string
) {
  return supabase
    .from("outreach_team_members")
    .update({ role })
    .eq("id", id)
    .select()
    .single();
}

export async function removeTeamMember(supabase: Client, id: string) {
  return supabase.from("outreach_team_members").delete().eq("id", id);
}

// ────────────────────────────────────────────────────────────
// BUDGET CATEGORIES
// ────────────────────────────────────────────────────────────

export async function getBudgetCategories(supabase: Client) {
  return supabase
    .from("outreach_budget_categories")
    .select("*")
    .order("sort_order", { ascending: true });
}

// ────────────────────────────────────────────────────────────
// TEAM BUDGETS
// ────────────────────────────────────────────────────────────

export async function getTeamBudgets(supabase: Client, teamId: string) {
  return supabase
    .from("outreach_team_budgets")
    .select("*, outreach_budget_categories(id, name, slug, sort_order)")
    .eq("team_id", teamId)
    .order("created_at", { ascending: true });
}

/**
 * Budget lines (migration 236). `outreach_team_budgets` above is derived
 * from these by a trigger — read it for per-category totals, but write
 * lines, never it.
 */
export async function getTeamBudgetLines(supabase: Client, teamId: string) {
  return supabase
    .from("outreach_budget_lines")
    .select(
      "id, team_id, category_id, description, amount_zar, frequency, uses_team_size, fixed_people, total_zar, sheet_total_zar, sort_order, source"
    )
    .eq("team_id", teamId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
}

// ────────────────────────────────────────────────────────────
// EXPENSES
// ────────────────────────────────────────────────────────────

export async function getTeamExpenses(supabase: Client, teamId: string) {
  return supabase
    .from("outreach_expenses")
    .select("*, outreach_budget_categories(id, name, slug)")
    .eq("team_id", teamId)
    .order("expense_date", { ascending: false });
}

export async function createExpense(
  supabase: Client,
  data: {
    team_id: string;
    category_id: string;
    expense_date: string;
    receipt_code?: string | null;
    vendor?: string | null;
    description?: string | null;
    purchaser?: string | null;
    payment_method?: string;
    country?: string | null;
    local_currency?: string | null;
    local_amount?: number | null;
    zar_amount: number;
    exchange_rate?: number | null;
    cash_batch_id?: string | null;
    receipt_path?: string | null;
    notes?: string | null;
    created_by: string;
  }
) {
  return supabase.from("outreach_expenses").insert(data).select().single();
}

export async function updateExpense(
  supabase: Client,
  id: string,
  data: Record<string, unknown>
) {
  return supabase
    .from("outreach_expenses")
    .update(data)
    .eq("id", id)
    .select()
    .single();
}

export async function deleteExpense(supabase: Client, id: string) {
  return supabase.from("outreach_expenses").delete().eq("id", id);
}

// ────────────────────────────────────────────────────────────
// FUND RELEASES
// ────────────────────────────────────────────────────────────

export async function getTeamFundReleases(supabase: Client, teamId: string) {
  return supabase
    .from("outreach_fund_releases")
    .select("*")
    .eq("team_id", teamId)
    .order("release_date", { ascending: false });
}

export async function createFundRelease(
  supabase: Client,
  data: {
    team_id: string;
    label: string;
    release_date?: string | null;
    amount_zar: number;
    currency?: string;
    method?: string;
    recipient?: string | null;
    notes?: string | null;
    created_by: string;
  }
) {
  return supabase.from("outreach_fund_releases").insert(data).select().single();
}

export async function updateFundRelease(
  supabase: Client,
  id: string,
  data: Record<string, unknown>
) {
  return supabase
    .from("outreach_fund_releases")
    .update(data)
    .eq("id", id)
    .select()
    .single();
}

export async function deleteFundRelease(supabase: Client, id: string) {
  return supabase.from("outreach_fund_releases").delete().eq("id", id);
}

// ────────────────────────────────────────────────────────────
// CASH BATCHES
// ────────────────────────────────────────────────────────────

export async function getTeamCashBatches(supabase: Client, teamId: string) {
  return supabase
    .from("outreach_cash_batches")
    .select("*")
    .eq("team_id", teamId)
    .order("batch_date", { ascending: false });
}

export async function createCashBatch(
  supabase: Client,
  data: {
    team_id: string;
    batch_date: string;
    zar_withdrawn: number;
    bank_fee?: number;
    local_currency?: string | null;
    local_currency_received?: number | null;
    exchange_rate?: number | null;
    notes?: string | null;
    created_by: string;
  }
) {
  return supabase.from("outreach_cash_batches").insert(data).select().single();
}

export async function updateCashBatch(
  supabase: Client,
  id: string,
  data: Record<string, unknown>
) {
  return supabase
    .from("outreach_cash_batches")
    .update(data)
    .eq("id", id)
    .select()
    .single();
}

export async function deleteCashBatch(supabase: Client, id: string) {
  return supabase.from("outreach_cash_batches").delete().eq("id", id);
}

// ────────────────────────────────────────────────────────────
// RECEIPTS
// ────────────────────────────────────────────────────────────

export async function getExpenseReceipts(supabase: Client, expenseId: string) {
  return supabase
    .from("outreach_receipts")
    .select("*")
    .eq("expense_id", expenseId)
    .order("uploaded_at", { ascending: false });
}

export async function createReceipt(
  supabase: Client,
  data: {
    expense_id: string;
    file_path: string;
    file_name: string;
    file_size: number;
    mime_type: string;
    uploaded_by: string;
  }
) {
  return supabase.from("outreach_receipts").insert(data).select().single();
}

export async function deleteReceipt(supabase: Client, id: string) {
  return supabase.from("outreach_receipts").delete().eq("id", id);
}

// ────────────────────────────────────────────────────────────
// CLOSEOUTS
// ────────────────────────────────────────────────────────────

export async function getTeamCloseout(supabase: Client, teamId: string) {
  return supabase
    .from("outreach_closeouts")
    .select("*, users!outreach_closeouts_closed_by_fkey(id, first_name, last_name)")
    .eq("team_id", teamId)
    .maybeSingle();
}

export async function upsertCloseout(
  supabase: Client,
  data: {
    team_id: string;
    total_funds_sent: number;
    total_spent: number;
    cash_remaining: number;
    funds_returned: number;
    variance: number;
    variance_pct: number;
    status: string;
    admin_notes?: string | null;
    closed_by?: string | null;
    closed_at?: string | null;
  }
) {
  return supabase
    .from("outreach_closeouts")
    .upsert(data, { onConflict: "team_id" })
    .select()
    .single();
}

export async function updateCloseoutStatus(
  supabase: Client,
  teamId: string,
  data: {
    status: string;
    admin_notes?: string | null;
    closed_by?: string | null;
    closed_at?: string | null;
  }
) {
  return supabase
    .from("outreach_closeouts")
    .update(data)
    .eq("team_id", teamId)
    .select()
    .single();
}

// ────────────────────────────────────────────────────────────
// AGGREGATE FINANCIALS (for all-teams dashboard)
// ────────────────────────────────────────────────────────────

/**
 * Every row of a query, page by page. PostgREST silently stops at 1000
 * rows, which would quietly under-count org-wide totals once enough
 * expenses exist.
 */
async function allRows<T>(
  build: () => { range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }> }
): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error || !data) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

export async function getAggregateFinancials(supabase: Client) {
  const [
    expenseRows,
    releases,
    { data: budgets },
    { data: closeouts },
    { data: budgetDetails },
    { data: teamAlerts },
  ] = await Promise.all([
    allRows<{ team_id: string; category_id: string; zar_amount: number; payment_method: string | null }>(() =>
      supabase.from("outreach_expenses").select("team_id, category_id, zar_amount, payment_method").order("id")
    ),
    allRows<{ team_id: string; amount_zar: number }>(() =>
      supabase.from("outreach_fund_releases").select("team_id, amount_zar").order("id")
    ),
    supabase.from("outreach_team_budgets").select("team_id, budget_amount_zar"),
    supabase.from("outreach_closeouts").select("team_id, status"),
    supabase
      .from("outreach_team_budgets")
      .select(
        "team_id, category_id, budget_amount_zar, outreach_budget_categories(id, name, slug, sort_order)"
      ),
    supabase.from("outreach_teams").select("id, cash_alert_low_pct, cash_alert_critical_pct"),
  ]);
  const expenses = expenseRows;
  const expenseDetails = expenseRows;
  // Spending that came out of the money sent to the team (see outreach-cash.ts).
  const teamCashSpent = expenseRows.filter((e) => TEAM_CASH_METHODS.has(e.payment_method ?? "cash"));

  const sumByTeam = (
    rows: { team_id: string; [key: string]: unknown }[] | null,
    field: string
  ): Record<string, number> => {
    const map: Record<string, number> = {};
    if (!rows) return map;
    for (const row of rows) {
      const tid = row.team_id;
      map[tid] = (map[tid] || 0) + Number(row[field] || 0);
    }
    return map;
  };

  // Group budget details by team
  const budgetDetailsByTeam: Record<
    string,
    Array<{
      category_id: string;
      name: string;
      sort_order: number;
      budget_amount_zar: number;
    }>
  > = {};
  for (const row of budgetDetails ?? []) {
    const tid = row.team_id;
    if (!budgetDetailsByTeam[tid]) budgetDetailsByTeam[tid] = [];
    const cat = row.outreach_budget_categories as {
      id: string;
      name: string;
      slug: string;
      sort_order: number;
    } | null;
    budgetDetailsByTeam[tid].push({
      category_id: row.category_id,
      name: cat?.name ?? "Unknown",
      sort_order: cat?.sort_order ?? 0,
      budget_amount_zar: Number(row.budget_amount_zar),
    });
  }

  // Group expense details by team → category
  const expenseDetailsByTeam: Record<string, Record<string, number>> = {};
  for (const row of expenseDetails ?? []) {
    const tid = row.team_id;
    if (!expenseDetailsByTeam[tid]) expenseDetailsByTeam[tid] = {};
    expenseDetailsByTeam[tid][row.category_id] =
      (expenseDetailsByTeam[tid][row.category_id] || 0) +
      Number(row.zar_amount);
  }

  return {
    expensesByTeam: sumByTeam(expenses, "zar_amount"),
    teamCashSpentByTeam: sumByTeam(teamCashSpent, "zar_amount"),
    cashThresholdsByTeam: Object.fromEntries(
      ((teamAlerts ?? []) as { id: string; cash_alert_low_pct: number | null; cash_alert_critical_pct: number | null }[]).map(
        (t) => [t.id, { low: t.cash_alert_low_pct, critical: t.cash_alert_critical_pct }]
      )
    ) as Record<string, { low: number | null; critical: number | null }>,
    releasesByTeam: sumByTeam(releases, "amount_zar"),
    budgetsByTeam: sumByTeam(budgets, "budget_amount_zar"),
    closeoutsByTeam: (closeouts ?? []).reduce(
      (acc: Record<string, string>, row: { team_id: string; status: string }) => {
        acc[row.team_id] = row.status;
        return acc;
      },
      {} as Record<string, string>
    ),
    budgetDetailsByTeam,
    expenseDetailsByTeam,
  };
}

// ────────────────────────────────────────────────────────────
// RECENT MOVEMENTS LEDGER
// ────────────────────────────────────────────────────────────
// A read-only view over rows that already exist in three tables. Nothing here
// adds, nets or derives a figure — each movement carries the amount as stored.

/** One stored money movement, normalised across its three source tables. */
export type MoneyMovement = {
  id: string;
  /** The source table's own date column — a date, no time. */
  date: string;
  label: string;
  amount: number;
  direction: "in" | "out";
  /** Which table the row came from, so the ledger can caption itself. */
  source: "fee_payment" | "fund_release" | "team_expense";
  href?: string;
};

/** A fee payment with no bank reference against it. */
export type UnmatchedPayment = {
  id: string;
  date: string;
  label: string;
  amount: number;
  method: string;
  href?: string;
};

type EmbeddedUser = {
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
} | null;

type EmbeddedFee = {
  program_id: string | null;
  users: EmbeddedUser;
} | null;

type PaymentRow = {
  id: string;
  payment_date: string;
  amount_zar: number | string;
  payment_method: string;
  student_fees: EmbeddedFee;
};

/**
 * Settle one source read on its own.
 *
 * The three tables do NOT share an access rule: migration 017 widened the
 * outreach tables to has_permission('finance.view'), while student_payments
 * (009) still stops at is_admin()/has_role('finance_admin'). A finance viewer
 * can legitimately hold one and not the other, and a blocked read must shorten
 * the ledger, never take the dashboard down — so a failure returns no rows
 * rather than throwing.
 */
async function safeRead<T>(
  read: () => PromiseLike<{ data: T[] | null; error: unknown; count?: number | null }>
): Promise<{ rows: T[]; count: number }> {
  try {
    const { data, error, count } = await read();
    if (error) return { rows: [], count: 0 };
    const rows = data ?? [];
    return { rows, count: count ?? rows.length };
  } catch {
    return { rows: [], count: 0 };
  }
}

function personName(user: EmbeddedUser): string | null {
  if (!user) return null;
  const first = user.first_name || "";
  const name = `${first} ${user.last_name ?? ""}`.trim();
  return name || null;
}

/**
 * The most recent money movements across fee income, fund releases and team
 * spend, newest first.
 *
 * Each source is ordered and LIMITed in SQL — the three small result sets are
 * merged here and cut to `limit`, so the page never pulls a whole table down to
 * sort it in memory. Taking `limit` from every source is what makes the merge
 * correct: the newest `limit` overall cannot contain more than `limit` rows
 * from any one of them.
 */
export async function getRecentMoneyMovements(
  supabase: Client,
  limit = 12
): Promise<MoneyMovement[]> {
  const [payments, releases, expenses] = await Promise.all([
    safeRead<PaymentRow>(() => getRecentStudentPayments(supabase, limit)),
    safeRead<{
      id: string;
      team_id: string;
      release_date: string;
      amount_zar: number | string;
      label: string;
      recipient: string | null;
      outreach_teams: { team_name: string } | null;
    }>(() =>
      supabase
        .from("outreach_fund_releases")
        .select(
          "id, team_id, release_date, amount_zar, label, recipient, outreach_teams(team_name)"
        )
        .order("release_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(limit)
    ),
    safeRead<{
      id: string;
      team_id: string;
      expense_date: string;
      zar_amount: number | string;
      description: string;
      vendor: string | null;
      outreach_teams: { team_name: string } | null;
    }>(() =>
      supabase
        .from("outreach_expenses")
        .select(
          "id, team_id, expense_date, zar_amount, description, vendor, outreach_teams(team_name)"
        )
        .order("expense_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(limit)
    ),
  ]);

  const movements: MoneyMovement[] = [
    // Fees received — student_payments.amount_zar, already ZAR.
    ...payments.rows.map((p) => ({
      id: `payment-${p.id}`,
      date: p.payment_date,
      label: personName(p.student_fees?.users ?? null) ?? "School fee payment",
      amount: Number(p.amount_zar),
      direction: "in" as const,
      source: "fee_payment" as const,
      href: p.student_fees?.program_id
        ? `/finance/school-fees/${p.student_fees.program_id}`
        : undefined,
    })),
    // Money released to a team — outreach_fund_releases.amount_zar.
    ...releases.rows.map((r) => ({
      id: `release-${r.id}`,
      date: r.release_date,
      label: [r.label, r.recipient ?? r.outreach_teams?.team_name]
        .filter(Boolean)
        .join(" · "),
      amount: Number(r.amount_zar),
      direction: "out" as const,
      source: "fund_release" as const,
      href: `/finance/outreach/${r.team_id}`,
    })),
    // Team spend — outreach_expenses.zar_amount is the ZAR-normalised column
    // (local_amount is in the team's local currency and is never mixed in here).
    ...expenses.rows.map((e) => ({
      id: `expense-${e.id}`,
      date: e.expense_date,
      label: [e.description, e.vendor ?? e.outreach_teams?.team_name]
        .filter(Boolean)
        .join(" · "),
      amount: Number(e.zar_amount),
      direction: "out" as const,
      source: "team_expense" as const,
      href: `/finance/outreach/${e.team_id}`,
    })),
  ];

  // Date columns are plain dates, so a string compare sorts them correctly.
  movements.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return movements.slice(0, limit);
}

/**
 * Fee payments received by EFT or card with no bank reference recorded —
 * money in that nobody has matched to a bank line yet.
 *
 * Degrades like the ledger sources: a viewer without read access to
 * student_payments gets a zero count, and the caller renders nothing.
 */
export async function getUnmatchedFeePayments(
  supabase: Client,
  limit = 4
): Promise<{ count: number; rows: UnmatchedPayment[] }> {
  const { rows, count } = await safeRead<PaymentRow>(() =>
    getUnreferencedBankPayments(supabase, limit)
  );

  return {
    count,
    rows: rows.map((p) => ({
      id: p.id,
      date: p.payment_date,
      label: personName(p.student_fees?.users ?? null) ?? "School fee payment",
      amount: Number(p.amount_zar),
      method: p.payment_method,
      href: p.student_fees?.program_id
        ? `/finance/school-fees/${p.student_fees.program_id}`
        : undefined,
    })),
  };
}

// ────────────────────────────────────────────────────────────
// PORTAL — MY TEAMS
// ────────────────────────────────────────────────────────────

export async function getMyOutreachTeams(supabase: Client, userId: string) {
  return supabase
    .from("outreach_team_members")
    .select(
      "*, outreach_teams(*, programs(id, name, code))"
    )
    .eq("user_id", userId)
    .order("joined_at", { ascending: false });
}
