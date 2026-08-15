"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowRight, Download, FileArchive, Users } from "lucide-react";
import { Bar } from "@/components/ffsa";

// ────────────────────────────────────────────────────────────
// TYPES
// ────────────────────────────────────────────────────────────

type Expense = {
  id: string;
  category_id: string;
  expense_date: string;
  zar_amount: number;
  outreach_budget_categories: { id: string; name: string; slug: string } | null;
};

type Budget = {
  id: string;
  category_id: string;
  budget_amount_zar: number;
  outreach_budget_categories: {
    id: string;
    name: string;
    slug: string;
    sort_order: number;
  };
};

type FundRelease = {
  id: string;
  amount_zar: number;
};

type CashBatch = {
  id: string;
  zar_withdrawn: number;
  bank_fee: number;
  local_currency: string | null;
  local_currency_received: number | null;
};

// ────────────────────────────────────────────────────────────
// COMPONENT
// ────────────────────────────────────────────────────────────

export function DashboardTab({
  budgets,
  expenses,
  fundReleases,
  cashBatches,
  peopleCount,
  teamId,
}: {
  budgets: Budget[];
  expenses: Expense[];
  fundReleases: FundRelease[];
  cashBatches: CashBatch[];
  peopleCount: number;
  teamId: string;
}) {
  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("en-ZA", {
      style: "currency",
      currency: "ZAR",
    }).format(amount);

  const totalReleased = fundReleases.reduce(
    (sum, r) => sum + Number(r.amount_zar),
    0
  );
  const totalSpent = expenses.reduce(
    (sum, e) => sum + Number(e.zar_amount),
    0
  );
  const remaining = totalReleased - totalSpent;

  // Spent per category
  const spentByCategory: Record<string, number> = {};
  for (const exp of expenses) {
    spentByCategory[exp.category_id] =
      (spentByCategory[exp.category_id] || 0) + Number(exp.zar_amount);
  }

  // Sort budgets by sort order
  const sortedBudgets = [...budgets].sort(
    (a, b) =>
      (a.outreach_budget_categories?.sort_order ?? 0) -
      (b.outreach_budget_categories?.sort_order ?? 0)
  );

  // Daily spending
  const dailyMap: Record<string, { count: number; total: number }> = {};
  for (const exp of expenses) {
    const d = exp.expense_date;
    if (!dailyMap[d]) dailyMap[d] = { count: 0, total: 0 };
    dailyMap[d].count += 1;
    dailyMap[d].total += Number(exp.zar_amount);
  }
  const dailyEntries = Object.entries(dailyMap).sort(([a], [b]) =>
    a.localeCompare(b)
  );

  // Cash batch summary
  const totalZarWithdrawn = cashBatches.reduce(
    (s, b) => s + Number(b.zar_withdrawn),
    0
  );
  const totalBankFees = cashBatches.reduce(
    (s, b) => s + Number(b.bank_fee),
    0
  );
  const netZar = totalZarWithdrawn - totalBankFees;
  const totalLocalReceived = cashBatches.reduce(
    (s, b) => s + Number(b.local_currency_received ?? 0),
    0
  );
  const effectiveRate =
    netZar > 0 ? totalLocalReceived / netZar : 0;

  return (
    <div className="space-y-6">
      {/* Fund Flow Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-2 items-center">
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-xs text-muted-foreground">Total Released</p>
            <p className="text-xl font-bold font-mono">
              {formatCurrency(totalReleased)}
            </p>
          </CardContent>
        </Card>
        <div className="hidden md:flex justify-center">
          <ArrowRight className="h-5 w-5 text-muted-foreground" />
        </div>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-xs text-muted-foreground">Total Spent</p>
            <p className="text-xl font-bold font-mono">
              {formatCurrency(totalSpent)}
            </p>
          </CardContent>
        </Card>
        <div className="hidden md:flex justify-center">
          <ArrowRight className="h-5 w-5 text-muted-foreground" />
        </div>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-xs text-muted-foreground">Remaining</p>
            <p
              className={`text-xl font-bold font-mono ${
                remaining < 0 ? "text-destructive" : "text-[color:var(--green-text)]"
              }`}
            >
              {formatCurrency(remaining)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Per-Person Cost + Export */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Users className="h-3 w-3" /> Cost per Person
            </p>
            <p className="text-xl font-bold font-mono">
              {formatCurrency(peopleCount > 0 ? totalSpent / peopleCount : 0)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {peopleCount} people
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Total Transactions</p>
            <p className="text-xl font-bold">{expenses.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 space-y-3">
            <p className="text-xs text-muted-foreground">Export</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" asChild>
                <a
                  href={`/api/finance/outreach/reports?teamId=${teamId}`}
                  download
                >
                  <Download className="mr-2 h-4 w-4" />
                  CSV Report
                </a>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a
                  href={`/api/finance/outreach/receipts/export?teamId=${teamId}`}
                  download
                >
                  <FileArchive className="mr-2 h-4 w-4" />
                  Receipts ZIP
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Budget vs Actual */}
      {sortedBudgets.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-medium">Budget vs Actual</h3>
          <div className="overflow-x-auto border border-ink">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Budgeted</TableHead>
                  <TableHead className="text-right">Spent</TableHead>
                  <TableHead className="text-right">Remaining</TableHead>
                  <TableHead className="text-right w-[80px]">% Used</TableHead>
                  <TableHead className="w-[120px]">Progress</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedBudgets.map((b) => {
                  const budgeted = Number(b.budget_amount_zar);
                  const spent = spentByCategory[b.category_id] || 0;
                  const rem = budgeted - spent;
                  const pct = budgeted > 0 ? (spent / budgeted) * 100 : 0;
                  // Black is the ordinary case; amber flags a category worth
                  // watching and red one that has gone over.
                  const barTone =
                    pct > 100
                      ? "hsl(var(--destructive))"
                      : pct >= 80
                        ? "var(--amber-border)"
                        : undefined;

                  return (
                    <TableRow key={b.id}>
                      <TableCell className="font-medium">
                        {b.outreach_budget_categories?.name ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(budgeted)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(spent)}
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono ${
                          rem < 0 ? "text-destructive" : ""
                        }`}
                      >
                        {formatCurrency(rem)}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {pct.toFixed(0)}%
                      </TableCell>
                      <TableCell>
                        <Bar pct={pct} tone={barTone} />
                      </TableCell>
                    </TableRow>
                  );
                })}
                {/* Total row */}
                {(() => {
                  const totBudgeted = sortedBudgets.reduce(
                    (s, b) => s + Number(b.budget_amount_zar),
                    0
                  );
                  const totSpent = Object.values(spentByCategory).reduce(
                    (s, v) => s + v,
                    0
                  );
                  const totRem = totBudgeted - totSpent;
                  const totPct =
                    totBudgeted > 0 ? (totSpent / totBudgeted) * 100 : 0;
                  return (
                    <TableRow className="font-bold border-t-2">
                      <TableCell>Total</TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(totBudgeted)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(totSpent)}
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono ${
                          totRem < 0 ? "text-destructive" : ""
                        }`}
                      >
                        {formatCurrency(totRem)}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {totPct.toFixed(0)}%
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  );
                })()}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Daily Spending Timeline */}
      {dailyEntries.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-medium">Daily Spending</h3>
          <div className="overflow-x-auto border border-ink">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right"># Transactions</TableHead>
                  <TableHead className="text-right">Daily Total</TableHead>
                  <TableHead className="text-right">Running Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(() => {
                  let running = 0;
                  return dailyEntries.map(([date, info]) => {
                    running += info.total;
                    return (
                      <TableRow key={date}>
                        <TableCell>
                          {new Date(date).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          {info.count}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(info.total)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(running)}
                        </TableCell>
                      </TableRow>
                    );
                  });
                })()}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Cash Batch Summary */}
      {cashBatches.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-medium">Cash Batch Summary</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">
                  Total ZAR Withdrawn
                </p>
                <p className="text-lg font-bold font-mono">
                  {formatCurrency(totalZarWithdrawn)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">Total Bank Fees</p>
                <p className="text-lg font-bold font-mono">
                  {formatCurrency(totalBankFees)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">
                  Total Local Received
                </p>
                <p className="text-lg font-bold font-mono">
                  {totalLocalReceived.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">
                  Effective Rate (avg)
                </p>
                <p className="text-lg font-bold font-mono">
                  {effectiveRate.toFixed(4)}
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {expenses.length === 0 && sortedBudgets.length === 0 && (
        <div className="text-center py-12">
          <p className="text-sm text-muted-foreground">
            No data yet. Add budgets and expenses to see dashboard analytics.
          </p>
        </div>
      )}
    </div>
  );
}
