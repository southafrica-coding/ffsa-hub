// Read-only outreach data, straight from Supabase as the signed-in person.
// Row-level security decides what comes back, exactly as on the website:
// plain team members can't read a team's money at all (migration 260), and
// leaders, group managers and finance staff see what migrations 273/274
// allow. Nothing here writes; writes go through ./api.ts.
//
// The generated Database types predate my_outreach_teams() and a few
// columns, so the client is loosely typed here and every row is parsed with
// the zod schemas in ./types.ts instead.

import { z } from "zod";

import { sumBy } from "./money";
import {
  cashPullSchema,
  categorySchema,
  expenseSchema,
  myTeamRowSchema,
  overviewSchema,
  teamBudgetSchema,
  teamRowSchema,
  type CashPull,
  type Category,
  type Expense,
  type MyTeamRow,
  type TeamBudget,
  type TeamOverview,
  type TeamRow,
} from "./types";

export type ReadClient = { from: (table: string) => any; rpc: (fn: string, args?: Record<string, unknown>) => any };

type PgResult = { data: unknown; error: { message: string; code?: string } | null };

export class DataError extends Error {
  name = "DataError";
  constructor(
    message: string,
    readonly offline: boolean,
  ) {
    super(message);
  }
}

const NETWORK_RE = /network request failed|failed to fetch|network error|timed? ?out|load failed/i;

function check<T>(res: PgResult, schema: z.ZodType<T>): T {
  if (res.error) {
    const offline = NETWORK_RE.test(res.error.message);
    throw new DataError(
      offline
        ? "Couldn't reach FFSA Hub. Check your connection and try again."
        : "FFSA Hub couldn't load this right now. Try again in a moment.",
      offline,
    );
  }
  const parsed = schema.safeParse(res.data ?? null);
  if (!parsed.success) throw new DataError("FFSA Hub sent something the app couldn't read.", false);
  return parsed.data;
}

async function run(q: PromiseLike<PgResult>): Promise<PgResult> {
  try {
    return await q;
  } catch (err) {
    return { data: null, error: { message: err instanceof Error ? err.message : "network error" } };
  }
}

// ── My Finance home ─────────────────────────────────────────────────────────

export type TeamMoney = { currency: string; budget: number; spent: number };
export type HomeTeam = MyTeamRow & { money: TeamMoney | null };
export type HomeData = { teams: HomeTeam[] };

/**
 * The teams you're on (my_outreach_teams, no money), then the money for the
 * ones RLS lets you read. A team that comes back from outreach_teams is one
 * whose budget you may see; the rest show no figures.
 */
export async function loadHome(db: ReadClient): Promise<HomeData> {
  const rows = check(await run(db.rpc("my_outreach_teams")), z.array(myTeamRowSchema).nullable()) ?? [];
  const ids = [...new Set(rows.map((r) => r.team_id))];
  if (ids.length === 0) return { teams: [] };

  const visible = check(
    await run(db.from("outreach_teams").select("id, team_name, location, country, status, currency, start_date, end_date").in("id", ids)),
    z.array(teamRowSchema).nullable(),
  ) ?? [];
  const moneyIds = visible.map((t) => t.id);

  let budgets: TeamBudget[] = [];
  let spend: { team_id: string; zar_amount: number }[] = [];
  if (moneyIds.length > 0) {
    const [b, e] = await Promise.all([
      run(db.from("outreach_team_budgets").select("team_id, category_id, budget_amount_zar").in("team_id", moneyIds)),
      run(db.from("outreach_expenses").select("team_id, category_id, zar_amount").in("team_id", moneyIds).range(0, 9999)),
    ]);
    budgets = check(b, z.array(teamBudgetSchema).nullable()) ?? [];
    spend = check(e, z.array(expenseSchema.pick({ team_id: true, zar_amount: true })).nullable()) ?? [];
  }

  const byId = new Map(visible.map((t) => [t.id, t]));
  return {
    teams: rows.map((r) => {
      const team = byId.get(r.team_id);
      return {
        ...r,
        money: team
          ? {
              currency: team.currency,
              budget: sumBy(budgets.filter((b) => b.team_id === r.team_id), (b) => b.budget_amount_zar),
              spent: sumBy(spend.filter((s) => s.team_id === r.team_id), (s) => s.zar_amount),
            }
          : null,
      };
    }),
  };
}

// ── One team ────────────────────────────────────────────────────────────────

export type TeamMoneyView = {
  kind: "money";
  team: TeamRow;
  /** can_edit_outreach_team(): a hint for showing edit buttons. The server still decides. */
  canEdit: boolean;
  categories: Category[];
  budgets: TeamBudget[];
  expenses: Expense[];
  pulls: CashPull[];
  receiptCounts: Record<string, number>;
};
export type TeamMemberView = { kind: "member"; overview: TeamOverview };
export type TeamData = TeamMoneyView | TeamMemberView | { kind: "none" };

export async function loadTeam(db: ReadClient, teamId: string): Promise<TeamData> {
  const team = check(
    await run(
      db.from("outreach_teams").select("id, team_name, location, country, status, currency, start_date, end_date").eq("id", teamId).maybeSingle(),
    ),
    teamRowSchema.nullable(),
  );

  if (!team) {
    // Plain members can't read the team row; they get the money-free overview.
    const overview = check(await run(db.rpc("outreach_team_overview", { p_team: teamId })), overviewSchema.nullable());
    return overview ? { kind: "member", overview } : { kind: "none" };
  }

  const [cats, budgets, expenses, pulls, receipts, canEdit] = await Promise.all([
    run(db.from("outreach_budget_categories").select("id, name, sort_order").order("sort_order", { ascending: true })),
    run(db.from("outreach_team_budgets").select("team_id, category_id, budget_amount_zar").eq("team_id", teamId)),
    run(
      db
        .from("outreach_expenses")
        .select("*")
        .eq("team_id", teamId)
        .order("expense_date", { ascending: false })
        .order("created_at", { ascending: false })
        .range(0, 4999),
    ),
    run(db.from("outreach_cash_batches").select("batch_date, local_currency, exchange_rate").eq("team_id", teamId)),
    // Receipt counts by expense, filtered through the expense's team.
    run(
      db
        .from("outreach_receipts")
        .select("expense_id, outreach_expenses!inner(team_id)")
        .eq("outreach_expenses.team_id", teamId)
        .range(0, 9999),
    ),
    run(db.rpc("can_edit_outreach_team", { check_team_id: teamId })),
  ]);

  const receiptCounts: Record<string, number> = {};
  for (const r of check(receipts, z.array(z.object({ expense_id: z.string() })).nullable()) ?? []) {
    receiptCounts[r.expense_id] = (receiptCounts[r.expense_id] ?? 0) + 1;
  }

  return {
    kind: "money",
    team,
    // A failed hint read grants nothing: buttons stay hidden, RLS is unaffected.
    canEdit: !canEdit.error && canEdit.data === true,
    categories: check(cats, z.array(categorySchema).nullable()) ?? [],
    budgets: check(budgets, z.array(teamBudgetSchema).nullable()) ?? [],
    expenses: check(expenses, z.array(expenseSchema).nullable()) ?? [],
    // Cash pulls only refine the rand estimate; without them the person types it.
    pulls: pulls.error ? [] : (z.array(cashPullSchema).safeParse(pulls.data).data ?? []),
    receiptCounts,
  };
}

/** Receipts on an expense, counting a legacy single receipt_path as one. */
export function receiptCount(e: Pick<Expense, "id" | "receipt_path">, counts: Record<string, number>): number {
  return counts[e.id] || (e.receipt_path ? 1 : 0);
}
