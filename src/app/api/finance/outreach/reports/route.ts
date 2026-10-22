import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getOutreachTeamById,
  getTeamBudgets,
  getTeamExpenses,
  getTeamFundReleases,
  getTeamCashBatches,
} from "@/services/outreach-finance";

function escapeCsv(val: string | number | null | undefined): string {
  if (val == null) return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const teamId = searchParams.get("teamId");

  if (!teamId) {
    return NextResponse.json({ error: "teamId is required" }, { status: 400 });
  }

  const [
    { data: team },
    { data: budgets },
    { data: expenses },
    { data: releases },
    { data: batches },
  ] = await Promise.all([
    getOutreachTeamById(supabase, teamId),
    getTeamBudgets(supabase, teamId),
    getTeamExpenses(supabase, teamId),
    getTeamFundReleases(supabase, teamId),
    getTeamCashBatches(supabase, teamId),
  ]);

  if (!team) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  // Build spent-per-category map
  const spentByCategory: Record<string, number> = {};
  for (const exp of expenses ?? []) {
    spentByCategory[exp.category_id] =
      (spentByCategory[exp.category_id] || 0) + Number(exp.zar_amount);
  }

  const lines: string[] = [];

  // Section 1: Team Info
  lines.push("TEAM INFORMATION");
  lines.push("Team Name,Program,Location,Country,People,Total Budget (ZAR),Status");
  lines.push(
    [
      escapeCsv(team.team_name),
      escapeCsv(team.programs?.name),
      escapeCsv(team.location),
      escapeCsv(team.country),
      team.people_count,
      team.total_budget_zar,
      escapeCsv(team.status),
    ].join(",")
  );
  lines.push("");

  // Section 2: Budget vs Actual
  lines.push("BUDGET VS ACTUAL");
  lines.push("Category,Budgeted (ZAR),Spent (ZAR),Remaining (ZAR),% Used");
  for (const b of budgets ?? []) {
    const budgeted = Number(b.budget_amount_zar);
    const spent = spentByCategory[b.category_id] || 0;
    const remaining = budgeted - spent;
    const pct = budgeted > 0 ? ((spent / budgeted) * 100).toFixed(1) : "0.0";
    lines.push(
      [
        escapeCsv(b.outreach_budget_categories?.name),
        budgeted.toFixed(2),
        spent.toFixed(2),
        remaining.toFixed(2),
        pct + "%",
      ].join(",")
    );
  }
  lines.push("");

  // Section 3: Expenses
  lines.push("EXPENSES");
  lines.push(
    "Date,Receipt Code,Category,Vendor,Description,Purchaser,Payment Method,Local Currency,Local Amount,ZAR Amount,Exchange Rate"
  );
  for (const e of expenses ?? []) {
    lines.push(
      [
        escapeCsv(e.expense_date),
        escapeCsv(e.receipt_code),
        escapeCsv(e.outreach_budget_categories?.name),
        escapeCsv(e.vendor),
        escapeCsv(e.description),
        escapeCsv(e.purchaser),
        escapeCsv(e.payment_method),
        escapeCsv(e.local_currency),
        e.local_amount != null ? Number(e.local_amount).toFixed(2) : "",
        Number(e.zar_amount).toFixed(2),
        e.exchange_rate != null ? Number(e.exchange_rate).toFixed(6) : "",
      ].join(",")
    );
  }
  lines.push("");

  // Section 4: Fund Releases
  lines.push("FUND RELEASES");
  lines.push("Label,Date,Amount (ZAR),Currency,Method,Recipient");
  for (const r of releases ?? []) {
    lines.push(
      [
        escapeCsv(r.label),
        escapeCsv(r.release_date),
        Number(r.amount_zar).toFixed(2),
        escapeCsv(r.currency),
        escapeCsv(r.method),
        escapeCsv(r.recipient),
      ].join(",")
    );
  }
  lines.push("");

  // Section 5: Cash Batches
  lines.push("CASH BATCHES");
  lines.push(
    "Date,ZAR Withdrawn,Bank Fee,Local Currency,Local Received,Exchange Rate"
  );
  for (const b of batches ?? []) {
    lines.push(
      [
        escapeCsv(b.batch_date),
        Number(b.zar_withdrawn).toFixed(2),
        Number(b.bank_fee).toFixed(2),
        escapeCsv(b.local_currency),
        b.local_currency_received != null
          ? Number(b.local_currency_received).toFixed(2)
          : "",
        b.exchange_rate != null ? Number(b.exchange_rate).toFixed(10) : "",
      ].join(",")
    );
  }

  const csv = lines.join("\n");
  const filename = `${team.team_name.replace(/[^a-zA-Z0-9]/g, "_")}_report.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
