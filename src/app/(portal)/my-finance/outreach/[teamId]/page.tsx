import { createClient } from "@/lib/supabase/server";
import {
  getOutreachTeamById,
  getTeamExpenses,
  getTeamFundReleases,
  getTeamCashBatches,
  getTeamBudgetLines,
  getBudgetCategories,
  getTeamCloseout,
} from "@/services/outreach-finance";
import { BudgetLines } from "@/app/(admin)/finance/outreach/[teamId]/budget-lines";
import { PlanView } from "@/app/(admin)/finance/outreach/[teamId]/plan-view";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Masthead, KpiStrip, Kpi, StatusPill, type Tone } from "@/components/ffsa";

const TEAM_TONE: Record<string, Tone> = {
  active: "good",
  planning: "warn",
  review: "warn",
  closed: "quiet",
};

export default async function MyOutreachTeamPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <p>Not authenticated.</p>;
  }

  const { data: team } = await getOutreachTeamById(supabase, teamId);

  if (!team) {
    return (
      <div className="ffsa-screen">
        <p className="px-5 py-8 text-sm text-destructive md:px-8">
          Team not found or you don&apos;t have access.
        </p>
      </div>
    );
  }

  const [
    { data: expenses },
    { data: fundReleases },
    { data: cashBatches },
    { data: budgetLines },
    { data: categories },
    { data: closeout },
    { data: membership },
  ] = await Promise.all([
    getTeamExpenses(supabase, teamId),
    getTeamFundReleases(supabase, teamId),
    getTeamCashBatches(supabase, teamId),
    getTeamBudgetLines(supabase, teamId),
    getBudgetCategories(supabase),
    getTeamCloseout(supabase, teamId),
    supabase
      .from("outreach_team_members")
      .select("role")
      .eq("team_id", teamId)
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  // The team's leaders and finance students run the budget themselves;
  // everyone else on the team sees it read-only. Mirrors
  // can_edit_outreach_budget (migration 236), which is what actually
  // enforces it.
  const BUDGET_EDITORS = ["finance_admin", "school_leader", "outreach_leader", "finance_student"];
  const financeClosed =
    closeout?.status === "auto_closed" || closeout?.status === "admin_override";
  const canEditBudget = BUDGET_EDITORS.includes(membership?.role ?? "") && !financeClosed;

  const spentByCategory: Record<string, number> = {};
  for (const e of expenses ?? []) {
    spentByCategory[e.category_id] = (spentByCategory[e.category_id] || 0) + Number(e.zar_amount);
  }


  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("en-ZA", {
      style: "currency",
      currency: "ZAR",
    }).format(amount);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const totalSpent = (expenses ?? []).reduce(
    (sum: number, e: any) => sum + Number(e.zar_amount),
    0
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const totalReleased = (fundReleases ?? []).reduce(
    (sum: number, r: any) => sum + Number(r.amount_zar),
    0
  );

  return (
    <div className="ffsa-screen">
      <Masthead
        context={[team.programs?.name, team.location ?? "Location TBC", team.country]
          .filter(Boolean)
          .join(" · ")}
        title={team.team_name}
        actions={
          <StatusPill tone={TEAM_TONE[team.status] ?? "quiet"}>
            {team.status}
          </StatusPill>
        }
      />

      {/* Money, so the numerals drop to 26px — a formatted rand figure will
          not fit at the strip's default 54. */}
      <KpiStrip>
        <Kpi label="Total budget" value={formatCurrency(team.total_budget_zar)} size={26} lead />
        <Kpi label="Total released" value={formatCurrency(totalReleased)} size={26} />
        <Kpi label="Total spent" value={formatCurrency(totalSpent)} size={26} />
        <Kpi
          label="Remaining"
          value={formatCurrency(totalReleased - totalSpent)}
          size={26}
          valueColor={totalReleased - totalSpent < 0 ? "hsl(var(--destructive))" : undefined}
        />
      </KpiStrip>

      <div className="space-y-6 px-5 py-6 md:px-8 md:py-7">
      <BudgetLines
        teamId={teamId}
        teamSize={team.people_count}
        lines={budgetLines ?? []}
        categories={categories ?? []}
        spentByCategory={spentByCategory}
        canEdit={canEditBudget}
      />

      <section className="space-y-3">
        <h2 className="font-medium">Day-by-day plan</h2>
        <PlanView
          lines={budgetLines ?? []}
          teamSize={team.people_count}
          tripStart={team.start_date}
          tripEnd={team.end_date}
          expenses={expenses ?? []}
          categories={categories ?? []}
        />
      </section>

      {/* Recent Expenses */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Recent Expenses ({(expenses ?? []).length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(expenses ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No expenses recorded yet.
            </p>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">ZAR</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(expenses ?? []).slice(0, 20).map(
                    (exp: {
                      id: string;
                      expense_date: string;
                      receipt_code: string | null;
                      vendor: string | null;
                      description: string | null;
                      zar_amount: number;
                      outreach_budget_categories: {
                        name: string;
                      } | null;
                    }) => (
                      <TableRow key={exp.id}>
                        <TableCell className="whitespace-nowrap">
                          {new Date(exp.expense_date).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {exp.receipt_code ?? "—"}
                        </TableCell>
                        <TableCell>
                          {exp.outreach_budget_categories?.name ?? "—"}
                        </TableCell>
                        <TableCell>{exp.vendor ?? "—"}</TableCell>
                        <TableCell className="max-w-[200px] truncate">
                          {exp.description ?? "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono font-medium">
                          {formatCurrency(Number(exp.zar_amount))}
                        </TableCell>
                      </TableRow>
                    )
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Fund Releases */}
      {(fundReleases ?? []).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Fund Releases ({(fundReleases ?? []).length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Label</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Method</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(fundReleases ?? []).map(
                    (r: {
                      id: string;
                      label: string;
                      release_date: string | null;
                      amount_zar: number;
                      method: string;
                    }) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">
                          {r.label}
                        </TableCell>
                        <TableCell>
                          {r.release_date
                            ? new Date(r.release_date).toLocaleDateString()
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono font-medium">
                          {formatCurrency(Number(r.amount_zar))}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-xs">
                            {r.method.replace(/_/g, " ")}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    )
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Cash Batches */}
      {(cashBatches ?? []).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Cash Batches ({(cashBatches ?? []).length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">
                      ZAR Withdrawn
                    </TableHead>
                    <TableHead>Local Currency</TableHead>
                    <TableHead className="text-right">
                      Local Received
                    </TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(cashBatches ?? []).map(
                    (b: {
                      id: string;
                      batch_date: string;
                      zar_withdrawn: number;
                      local_currency: string | null;
                      local_currency_received: number | null;
                      exchange_rate: number | null;
                    }) => (
                      <TableRow key={b.id}>
                        <TableCell>
                          {new Date(b.batch_date).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(Number(b.zar_withdrawn))}
                        </TableCell>
                        <TableCell>{b.local_currency ?? "—"}</TableCell>
                        <TableCell className="text-right font-mono">
                          {b.local_currency_received != null
                            ? Number(
                                b.local_currency_received
                              ).toLocaleString()
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {b.exchange_rate
                            ? Number(b.exchange_rate).toFixed(4)
                            : "—"}
                        </TableCell>
                      </TableRow>
                    )
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
      </div>
    </div>
  );
}
