export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isFinanceStaff } from "@/lib/slack/assistant/outreach";
import {
  getOutreachTeamById,
  getTeamMembers,
  getTeamBudgets,
  getTeamBudgetLines,
  getTeamDayPlans,
  getBudgetCategories,
  getTeamExpenses,
  getTeamFundReleases,
  getTeamCashBatches,
  getTeamCloseout,
  getTeamCashAllocations,
  OUTREACH_LEADER_ROLES,
  getOutreachTeamDeleteBlockers,
} from "@/services/outreach-finance";
import { describeDeleteBlockers } from "@/lib/finance/outreach-team-admin";
import { NO_ACCESS, accessLabel, resolveTeamAccess } from "@/lib/finance/outreach-access";
import { loadOutreachViewer } from "@/lib/finance/outreach-viewer";
import { TeamDetail } from "./team-detail";

export default async function OutreachTeamDetailPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Your role on this team. Plain members can't read the team row (it
  // carries the budget), so they go to the money-free view instead.
  const { data: membership } = user
    ? await supabase
        .from("outreach_team_members")
        .select("role")
        .eq("team_id", teamId)
        .eq("user_id", user.id)
        .maybeSingle()
    : { data: null };
  const myRole: string | null = membership?.role ?? null;

  const { data: team, error: teamError } = await getOutreachTeamById(
    supabase,
    teamId
  );

  if ((teamError || !team) && myRole === "team_member") {
    redirect(`/my-finance/outreach/${teamId}`);
  }

  if (teamError || !team) {
    return (
      <div className="ffsa-screen">
        <p className="px-5 py-8 text-sm text-destructive md:px-8">Team not found.</p>
      </div>
    );
  }

  // What this viewer may do here (migration 273): edit as staff, leader or
  // group manager; read only as finance viewer or a leader of a team in the
  // same group. Decided on the server from fresh reads, every request.
  const outreachViewer = user ? await loadOutreachViewer(supabase, user.id) : null;
  const access = outreachViewer ? resolveTeamAccess(outreachViewer, teamId) : NO_ACCESS;
  // Flagged "limited to own teams" (migration 274): only teams their own
  // roles and groups give them, whatever the team read above returned.
  if (outreachViewer?.limitedToOwnTeams && access.level !== "edit" && access.level !== "view") {
    if (access.level === "member") redirect(`/my-finance/outreach/${teamId}`);
    return (
      <div className="ffsa-screen">
        <p className="px-5 py-8 text-sm text-destructive md:px-8">Team not found.</p>
      </div>
    );
  }
  const canEdit = access.level === "edit";
  const staffEditor = outreachViewer?.staffEditor === true;

  // People's names. The users table only lets admins read everyone, so a
  // leader inviting people saw nobody to add (and blank names for existing
  // members). Finance staff, the team's leaders and anyone else who can see
  // its money get names + emails via the service role — nothing else about
  // anyone. Only people who can edit get the full list to add from.
  const admin = createAdminClient();
  const staff = user ? await isFinanceStaff(admin, user.id) : false;
  const leader = myRole !== null && OUTREACH_LEADER_ROLES.includes(myRole);
  const people = staff || leader || access.level === "edit" || access.level === "view" ? admin : supabase;
  // Outreach administrators get Archive / Delete; Delete needs to know what
  // it would destroy (migration 272).
  const { data: deleteBlockers } =
    staffEditor
      ? await getOutreachTeamDeleteBlockers(supabase, teamId)
      : { data: null };

  const [
    { data: members },
    { data: budgets },
    { data: budgetLines },
    { data: dayPlans },
    { data: categories },
    { data: expenses },
    { data: fundReleases },
    { data: cashBatches },
    { data: closeout },
    { data: cashAllocations },
  ] = await Promise.all([
    getTeamMembers(people, teamId),
    getTeamBudgets(supabase, teamId),
    getTeamBudgetLines(supabase, teamId),
    getTeamDayPlans(supabase, teamId),
    getBudgetCategories(supabase),
    getTeamExpenses(supabase, teamId),
    getTeamFundReleases(supabase, teamId),
    getTeamCashBatches(supabase, teamId),
    getTeamCloseout(supabase, teamId),
    getTeamCashAllocations(supabase, teamId),
  ]);

  // Get all users for member assignment + receipt counts per expense, and
  // the school leader named for money alerts (migration 261).
  const [{ data: allUsers }, { data: receiptRows }, { data: alertRecipient }] = await Promise.all([
    canEdit
      ? people
          .from("users")
          .select("id, first_name, last_name, preferred_name, email")
          .eq("is_active", true)
          .order("last_name", { ascending: true })
      : Promise.resolve({ data: [] }),
    supabase
      .from("outreach_receipts")
      .select("expense_id")
      .in(
        "expense_id",
        (expenses ?? []).map((e: { id: string }) => e.id)
      ),
    team.cash_alert_user_id
      ? people
          .from("users")
          .select("id, first_name, last_name, preferred_name, email, slack_user_id")
          .eq("id", team.cash_alert_user_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
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
      dayPlans={dayPlans ?? []}
      categories={categories ?? []}
      allUsers={allUsers ?? []}
      expenses={expenses ?? []}
      fundReleases={fundReleases ?? []}
      cashBatches={cashBatches ?? []}
      closeout={closeout ?? null}
      receiptCounts={receiptCounts}
      cashAllocations={cashAllocations ?? []}
      viewer={{ role: myRole, staffEditor, canEdit, accessLabel: accessLabel(access) }}
      deleteBlockers={deleteBlockers ? describeDeleteBlockers(deleteBlockers) : ["linked records"]}
      // Generated types predate users.slack_user_id.
      alertRecipient={(alertRecipient ?? null) as Parameters<typeof TeamDetail>[0]["alertRecipient"]}
    />
  );
}
