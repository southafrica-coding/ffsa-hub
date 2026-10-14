export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase/server";
import {
  getOutreachTeamById,
  getTeamMembers,
  getTeamBudgets,
  getTeamBudgetLines,
  getBudgetCategories,
  getTeamExpenses,
  getTeamFundReleases,
  getTeamCashBatches,
  getTeamCloseout,
} from "@/services/outreach-finance";
import { TeamDetail } from "./team-detail";

export default async function OutreachTeamDetailPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  const supabase = await createClient();

  const { data: team, error: teamError } = await getOutreachTeamById(
    supabase,
    teamId
  );

  if (teamError || !team) {
    return (
      <div className="ffsa-screen">
        <p className="px-5 py-8 text-sm text-destructive md:px-8">Team not found.</p>
      </div>
    );
  }

  const [
    { data: members },
    { data: budgets },
    { data: budgetLines },
    { data: categories },
    { data: expenses },
    { data: fundReleases },
    { data: cashBatches },
    { data: closeout },
  ] = await Promise.all([
    getTeamMembers(supabase, teamId),
    getTeamBudgets(supabase, teamId),
    getTeamBudgetLines(supabase, teamId),
    getBudgetCategories(supabase),
    getTeamExpenses(supabase, teamId),
    getTeamFundReleases(supabase, teamId),
    getTeamCashBatches(supabase, teamId),
    getTeamCloseout(supabase, teamId),
  ]);

  // Get all users for member assignment + receipt counts per expense
  const [{ data: allUsers }, { data: receiptRows }] = await Promise.all([
    supabase
      .from("users")
      .select("id, first_name, last_name, preferred_name, email")
      .eq("is_active", true)
      .order("last_name", { ascending: true }),
    supabase
      .from("outreach_receipts")
      .select("expense_id")
      .in(
        "expense_id",
        (expenses ?? []).map((e: { id: string }) => e.id)
      ),
  ]);

  // Build receipt count map
  const receiptCounts: Record<string, number> = {};
  for (const row of receiptRows ?? []) {
    receiptCounts[row.expense_id] =
      (receiptCounts[row.expense_id] || 0) + 1;
  }

  // No wrapper: TeamDetail's root is this screen's root.
  return (
    <TeamDetail
      team={team}
      members={members ?? []}
      budgets={budgets ?? []}
      budgetLines={budgetLines ?? []}
      categories={categories ?? []}
      allUsers={allUsers ?? []}
      expenses={expenses ?? []}
      fundReleases={fundReleases ?? []}
      cashBatches={cashBatches ?? []}
      closeout={closeout ?? null}
      receiptCounts={receiptCounts}
    />
  );
}
