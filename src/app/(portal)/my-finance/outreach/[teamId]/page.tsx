import { createClient } from "@/lib/supabase/server";
import {
  getOutreachTeamById,
  getTeamExpenses,
  getTeamFundReleases,
  getTeamCashBatches,
} from "@/services/outreach-finance";
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
import { Masthead } from "@/components/ffsa";

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
      <div className="space-y-4">
        <p className="text-destructive">
          Team not found or you don&apos;t have access.
        </p>
      </div>
    );
  }

  const [{ data: expenses }, { data: fundReleases }, { data: cashBatches }] =
    await Promise.all([
      getTeamExpenses(supabase, teamId),
      getTeamFundReleases(supabase, teamId),
      getTeamCashBatches(supabase, teamId),
    ]);

  const statusColors: Record<
    string,
    "default" | "secondary" | "destructive"
  > = {
    planning: "secondary",
    active: "default",
    review: "secondary",
    closed: "destructive",
  };

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
      <Masthead context="My finance · Outreach" title={team.team_name} />
      <div className="space-y-6 px-5 py-6 md:px-8">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            {team.programs?.name} · {team.location ?? "TBD"}
            {team.country && `, ${team.country}`}
          </p>
        </div>
        <Badge variant={statusColors[team.status] ?? "secondary"}>
          {team.status}
        </Badge>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Total Budget</p>
            <p className="text-lg font-bold font-mono">
              {formatCurrency(team.total_budget_zar)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Total Released</p>
            <p className="text-lg font-bold font-mono">
              {formatCurrency(totalReleased)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Total Spent</p>
            <p className="text-lg font-bold font-mono">
              {formatCurrency(totalSpent)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Remaining</p>
            <p
              className={`text-lg font-bold font-mono ${
                totalReleased - totalSpent < 0 ? "text-destructive" : ""
              }`}
            >
              {formatCurrency(totalReleased - totalSpent)}
            </p>
          </CardContent>
        </Card>
      </div>

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
