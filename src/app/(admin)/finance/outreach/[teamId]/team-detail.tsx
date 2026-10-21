"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CalendarDays, Plus, Trash2, Users, Wallet, Receipt, Banknote, BarChart3, CheckCircle2 } from "lucide-react";
import { Masthead, KpiStrip, NeedsYou, StatusPill } from "@/components/ffsa";
import { MoneyKpi, barTone } from "../../money-kpi";
import { CashInHand } from "../cash-in-hand";
import { ExpensesTab } from "./expenses-tab";
import { PayoutsTab } from "./payouts-tab";
import { DashboardTab } from "./dashboard-tab";
import { CloseoutTab } from "./closeout-tab";
import { SlackSettings } from "./slack-settings";
import { MoneyAlertSettings } from "./money-alert-settings";
import { BudgetLines, type BudgetLine } from "./budget-lines";
import { Planner } from "./planner";
import { OUTREACH_LEADER_ROLES, OUTREACH_ROLE_LABELS } from "@/lib/finance/outreach-roles";

// ────────────────────────────────────────────────────────────
// TYPES
// ────────────────────────────────────────────────────────────

type Team = {
  id: string;
  team_name: string;
  location: string | null;
  country: string | null;
  start_date: string | null;
  end_date: string | null;
  status: string;
  people_count: number;
  total_budget_zar: number;
  currency: string;
  notes: string | null;
  drive_folder_url: string | null;
  slack_enabled?: boolean;
  slack_channel_id?: string | null;
  cash_alert_low_pct?: number | null;
  cash_alert_critical_pct?: number | null;
  cash_alert_user_id?: string | null;
  programs: { id: string; name: string; code: string } | null;
};

/** Who is looking: their role on this team, and whether they're finance staff who can edit. */
type Viewer = { role: string | null; staffEditor: boolean };

type Member = {
  id: string;
  team_id: string;
  user_id: string;
  role: string;
  users: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    preferred_name: string | null;
    email: string | null;
    slack_user_id?: string | null;
  } | null;
};

type TeamBudget = {
  id: string;
  team_id: string;
  category_id: string;
  people_count: number | null;
  budget_amount_zar: number;
  notes: string | null;
  outreach_budget_categories: {
    id: string;
    name: string;
    slug: string;
    sort_order: number;
  };
};

type Category = {
  id: string;
  name: string;
  slug: string;
  sort_order: number;
};

type UserOption = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  email: string | null;
};

type Expense = {
  id: string;
  team_id: string;
  category_id: string;
  expense_date: string;
  receipt_code: string | null;
  vendor: string | null;
  description: string | null;
  purchaser: string | null;
  payment_method: string;
  country: string | null;
  local_currency: string | null;
  local_amount: number | null;
  zar_amount: number;
  exchange_rate: number | null;
  cash_batch_id: string | null;
  receipt_path: string | null;
  notes: string | null;
  outreach_budget_categories: {
    id: string;
    name: string;
    slug: string;
  } | null;
};

type FundRelease = {
  id: string;
  team_id: string;
  label: string;
  release_date: string | null;
  amount_zar: number;
  currency: string;
  method: string;
  recipient: string | null;
  notes: string | null;
};

type CashBatch = {
  id: string;
  team_id: string;
  batch_date: string;
  zar_withdrawn: number;
  bank_fee: number;
  local_currency: string | null;
  local_currency_received: number | null;
  exchange_rate: number | null;
  notes: string | null;
};

type Closeout = {
  id: string;
  team_id: string;
  total_funds_sent: number;
  total_spent: number;
  cash_remaining: number;
  funds_returned: number;
  variance: number;
  variance_pct: number;
  status: string;
  admin_notes: string | null;
  closed_by: string | null;
  closed_at: string | null;
  users?: {
    id: string;
    first_name: string | null;
    last_name: string | null;
  } | null;
};

// Roles you can give someone. Owner is never picked: it's whoever created
// the outreach, or whoever they hand it over to.
const TEAM_ROLES = [
  { value: "co_leader", label: "Co-leader — runs the budget and finances" },
  { value: "team_member", label: "Team member — on the trip, no money access" },
];

const statusTones: Record<string, "good" | "warn" | "quiet" | "bad"> = {
  planning: "quiet",
  active: "good",
  review: "warn",
  closed: "bad",
};

// ────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ────────────────────────────────────────────────────────────

export function TeamDetail({
  team,
  members,
  budgets,
  budgetLines,
  dayPlans,
  categories,
  allUsers,
  expenses,
  fundReleases,
  cashBatches,
  closeout,
  receiptCounts = {},
  viewer,
  alertRecipient,
}: {
  team: Team;
  members: Member[];
  budgets: TeamBudget[];
  budgetLines: BudgetLine[];
  dayPlans: { category_id: string; plan_date: string; amount_zar: number | string; note: string | null }[];
  categories: Category[];
  allUsers: UserOption[];
  expenses: Expense[];
  fundReleases: FundRelease[];
  cashBatches: CashBatch[];
  closeout: Closeout | null;
  receiptCounts?: Record<string, number>;
  viewer: Viewer;
  alertRecipient: (UserOption & { slack_user_id: string | null }) | null;
}) {
  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(amount);

  const totalBudgeted = budgets.reduce((sum, b) => sum + Number(b.budget_amount_zar), 0);
  const totalSpent = expenses.reduce((sum, e) => sum + Number(e.zar_amount), 0);
  const totalReleased = fundReleases.reduce((sum, r) => sum + Number(r.amount_zar), 0);
  const remainingFunds = totalBudgeted - totalSpent;

  // Closeout lock — prevent edits when finances are closed
  const isFinanceLocked =
    closeout?.status === "auto_closed" || closeout?.status === "admin_override";

  // Build spent-per-category map for budget tab
  const spentByCategory: Record<string, number> = {};
  for (const exp of expenses) {
    spentByCategory[exp.category_id] =
      (spentByCategory[exp.category_id] || 0) + Number(exp.zar_amount);
  }

  const budget = Number(team.total_budget_zar);
  const releasedPct = budget > 0 ? (totalReleased / budget) * 100 : 0;
  const spentPct = budget > 0 ? (totalSpent / budget) * 100 : 0;
  const budgetedPct = budget > 0 ? (totalBudgeted / budget) * 100 : 0;
  // `remainingFunds` is measured against the CATEGORY budgets, not against cash
  // released — the bar has to sit on the same base or it lies.
  const heldPct = totalBudgeted > 0 ? (remainingFunds / totalBudgeted) * 100 : 0;

  return (
    <div className="ffsa-screen">
      <Masthead
        context={["Outreach finance", team.programs?.code, team.location, team.country]
          .filter(Boolean)
          .join(" · ")}
        title={team.team_name}
        actions={
          <StatusPill tone={statusTones[team.status] ?? "quiet"}>
            {team.status}
          </StatusPill>
        }
      />

      {/* The page's ONE yellow band. A closeout only sits at "pending" when its
          variance broke 2% and an admin has to approve or reject it. */}
      {closeout?.status === "pending" && (
        <NeedsYou>This team&apos;s closeout is waiting on your review</NeedsYou>
      )}

      <div className="space-y-6 px-8 py-7">
        <p className="mono-label">
          {team.programs?.name}
          {team.start_date && ` · ${new Date(team.start_date).toLocaleDateString()}`}
          {team.end_date && ` – ${new Date(team.end_date).toLocaleDateString()}`}
          {` · ${team.people_count} people`}
        </p>

        {/* Summary strip */}
        <div className="border-x border-t border-ink">
          <KpiStrip>
            <MoneyKpi
              lead
              label="Total budget"
              value={formatCurrency(budget)}
              pct={budgetedPct}
              tone={barTone(budgetedPct)}
              foot={`${formatCurrency(totalBudgeted)} allocated to categories`}
            />
            <MoneyKpi
              label="Total released"
              value={formatCurrency(totalReleased)}
              pct={releasedPct}
              foot={`${releasedPct.toFixed(0)}% of budget`}
            />
            <MoneyKpi
              label="Total spent"
              value={formatCurrency(totalSpent)}
              pct={spentPct}
              tone={barTone(spentPct)}
              foot={`${spentPct.toFixed(0)}% of budget`}
            />
            <MoneyKpi
              label="Budget left"
              value={formatCurrency(remainingFunds)}
              negative={remainingFunds < 0}
              positive={remainingFunds >= 0}
              pct={Math.max(0, heldPct)}
              foot={
                remainingFunds < 0
                  ? "Overspent against the category budget"
                  : `${Math.max(0, heldPct).toFixed(0)}% of the category budget unspent`
              }
            />
          </KpiStrip>
        </div>

        <CashInHand
          releases={fundReleases}
          expenses={expenses}
          lowPct={team.cash_alert_low_pct}
          criticalPct={team.cash_alert_critical_pct}
        />

        {/* Tabs */}
        <Tabs defaultValue="budget">
        <TabsList className="w-full overflow-x-auto justify-start">
          <TabsTrigger value="budget" className="gap-1">
            <Wallet className="h-3 w-3" /> Budget ({budgetLines.length})
          </TabsTrigger>
          <TabsTrigger value="plan" className="gap-1">
            <CalendarDays className="h-3 w-3" /> Plan
          </TabsTrigger>
          <TabsTrigger value="members" className="gap-1">
            <Users className="h-3 w-3" /> Members ({members.length})
          </TabsTrigger>
          <TabsTrigger value="expenses" className="gap-1">
            <Receipt className="h-3 w-3" /> Expenses ({expenses.length})
          </TabsTrigger>
          <TabsTrigger value="payouts" className="gap-1">
            <Banknote className="h-3 w-3" /> Payouts ({fundReleases.length + cashBatches.length})
          </TabsTrigger>
          <TabsTrigger value="dashboard" className="gap-1">
            <BarChart3 className="h-3 w-3" /> Dashboard
          </TabsTrigger>
          <TabsTrigger value="closeout" className="gap-1">
            <CheckCircle2 className="h-3 w-3" /> Closeout
          </TabsTrigger>
        </TabsList>

        <TabsContent value="budget" className="mt-4">
          <BudgetLines
            teamId={team.id}
            teamSize={team.people_count}
            lines={budgetLines}
            categories={categories}
            spentByCategory={spentByCategory}
            canEdit={!isFinanceLocked}
          />
        </TabsContent>

        <TabsContent value="plan" className="mt-4">
          <Planner
            teamId={team.id}
            tripStart={team.start_date}
            tripEnd={team.end_date}
            teamSize={team.people_count}
            lines={budgetLines}
            expenses={expenses}
            categories={categories}
            dayPlans={dayPlans}
            canEdit={!isFinanceLocked}
          />
        </TabsContent>

        <TabsContent value="members" className="mt-4 space-y-6">
          <MembersTab
            teamId={team.id}
            members={members}
            allUsers={allUsers}
            viewer={viewer}
          />
          <SlackSettings
            teamId={team.id}
            enabled={team.slack_enabled ?? false}
            channelId={team.slack_channel_id ?? null}
          />
          <MoneyAlertSettings
            teamId={team.id}
            lowPct={team.cash_alert_low_pct ?? 30}
            criticalPct={team.cash_alert_critical_pct ?? 15}
            recipientId={team.cash_alert_user_id ?? null}
            recipient={
              alertRecipient
                ? {
                    name:
                      [alertRecipient.first_name, alertRecipient.last_name].filter(Boolean).join(" ") ||
                      alertRecipient.email ||
                      "Unnamed",
                    slackLinked: Boolean(alertRecipient.slack_user_id),
                  }
                : null
            }
            people={allUsers}
          />
        </TabsContent>

        <TabsContent value="expenses" className="mt-4">
          <ExpensesTab
            teamId={team.id}
            expenses={expenses}
            categories={categories}
            cashBatches={cashBatches}
            receiptCounts={receiptCounts}
            readOnly={isFinanceLocked}
          />
        </TabsContent>

        <TabsContent value="payouts" className="mt-4">
          <PayoutsTab
            teamId={team.id}
            fundReleases={fundReleases}
            cashBatches={cashBatches}
            readOnly={isFinanceLocked}
          />
        </TabsContent>

        <TabsContent value="dashboard" className="mt-4">
          <DashboardTab
            budgets={budgets}
            expenses={expenses}
            fundReleases={fundReleases}
            cashBatches={cashBatches}
            peopleCount={team.people_count}
            teamId={team.id}
          />
        </TabsContent>

        <TabsContent value="closeout" className="mt-4">
          <CloseoutTab
            teamId={team.id}
            expenses={expenses}
            fundReleases={fundReleases}
            closeout={closeout}
            canApprove={viewer.staffEditor}
          />
        </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// MEMBERS TAB
// ────────────────────────────────────────────────────────────

function MembersTab({
  teamId,
  members,
  allUsers,
  viewer,
}: {
  teamId: string;
  members: Member[];
  allUsers: UserOption[];
  viewer: Viewer;
}) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedRole, setSelectedRole] = useState("team_member");
  const [addLoading, setAddLoading] = useState(false);

  // Mirrors the RLS in migration 260, which is what actually enforces it:
  // only the owner (or finance staff) adds, changes and removes co-leaders
  // and hands the outreach over; co-leaders add and remove team members.
  const canManageLeaders = viewer.role === "owner" || viewer.staffEditor;
  const canManageMembers =
    canManageLeaders || (viewer.role !== null && OUTREACH_LEADER_ROLES.includes(viewer.role));
  const roleOptions = canManageLeaders
    ? TEAM_ROLES
    : TEAM_ROLES.filter((r) => r.value === "team_member");

  const memberUserIds = new Set(members.map((m) => m.user_id));
  const availableUsers = allUsers.filter((u) => !memberUserIds.has(u.id));

  function userName(u: { first_name: string | null; last_name: string | null; preferred_name: string | null; email: string | null } | null) {
    if (!u) return "Unknown";
    if (u.first_name) {
      return `${u.first_name} ${u.last_name ?? ""}`.trim();
    }
    return u.email ?? "Unknown";
  }

  function canRemove(m: Member) {
    if (m.role === "owner") return false;
    return m.role === "team_member" ? canManageMembers : canManageLeaders;
  }

  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault();
    setAddLoading(true);
    try {
      const res = await fetch("/api/finance/outreach/team-members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          team_id: teamId,
          user_id: selectedUserId,
          role: selectedRole,
        }),
      });
      if (res.ok) {
        setAddOpen(false);
        setSelectedUserId("");
        setSelectedRole("team_member");
        router.refresh();
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to add member");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setAddLoading(false);
    }
  }

  async function handleRoleChange(memberId: string, newRole: string) {
    try {
      const res = await fetch("/api/finance/outreach/team-members", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: memberId, role: newRole }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed to update role");
      }
      router.refresh();
    } catch {
      toast.error("Failed to update role");
    }
  }

  async function handleMakeOwner(m: Member) {
    if (
      !confirm(
        `Make ${userName(m.users)} the owner of this outreach? ` +
          "They'll be the one who adds co-leaders, and the current owner becomes a co-leader."
      )
    )
      return;
    try {
      const res = await fetch("/api/finance/outreach/team-members", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: m.id, team_id: teamId, make_owner: true }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed to hand over the outreach");
      }
      router.refresh();
    } catch {
      toast.error("Failed to hand over the outreach");
    }
  }

  async function handleRemoveMember(memberId: string) {
    if (!confirm("Remove this member from the team?")) return;
    try {
      const res = await fetch(`/api/finance/outreach/team-members?id=${memberId}`, {
        method: "DELETE",
      });
      if (res.ok) router.refresh();
      else {
        const data = await res.json();
        toast.error(data.error || "Failed to remove member");
      }
    } catch {
      toast.error("Failed to remove member");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-medium">Team Members</h3>
          <p className="text-xs text-muted-foreground">
            The owner and co-leaders run the budget. Team members are on the trip but can&apos;t see the money.
          </p>
        </div>
        {canManageMembers && (
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="mr-2 h-4 w-4" />
              Add Member
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Team Member</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleAddMember} className="space-y-4">
              <div>
                <Label>Person</Label>
                <SearchableSelect
                  value={selectedUserId}
                  onChange={setSelectedUserId}
                  placeholder={`Choose from ${availableUsers.length} people…`}
                  options={[...availableUsers]
                    .sort((a, b) => userName(a).localeCompare(userName(b)))
                    .map((u) => ({
                      value: u.id,
                      label: u.email ? `${userName(u)} — ${u.email}` : userName(u),
                    }))}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Click the list and start typing a name to jump to it.
                </p>
              </div>
              <div>
                <Label>Role</Label>
                <Select value={selectedRole} onValueChange={setSelectedRole}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {roleOptions.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!canManageLeaders && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Only the outreach&apos;s owner can add co-leaders.
                  </p>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={addLoading || !selectedUserId}>
                  {addLoading ? "Adding..." : "Add Member"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
        )}
      </div>

      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">
          No team members yet. Add members to get started.
        </p>
      ) : (
        <div className="overflow-x-auto border border-ink">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="w-[150px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...members]
                .sort((a, b) => roleRank(a.role) - roleRank(b.role))
                .map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">
                    {userName(m.users)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {m.users?.email ?? "—"}
                  </TableCell>
                  <TableCell>
                    {m.role !== "owner" && canManageLeaders ? (
                      <Select
                        value={m.role}
                        onValueChange={(val) => handleRoleChange(m.id, val)}
                      >
                        <SelectTrigger className="w-[160px]">
                          <SelectValue>{OUTREACH_ROLE_LABELS[m.role] ?? m.role}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {TEAM_ROLES.map((r) => (
                            <SelectItem key={r.value} value={r.value}>
                              {r.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <StatusPill tone={m.role === "team_member" ? "quiet" : "good"}>
                        {OUTREACH_ROLE_LABELS[m.role] ?? m.role}
                      </StatusPill>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      {m.role !== "owner" && canManageLeaders && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-xs"
                          onClick={() => handleMakeOwner(m)}
                        >
                          Make owner
                        </Button>
                      )}
                      {canRemove(m) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => handleRemoveMember(m.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function roleRank(role: string) {
  return role === "owner" ? 0 : role === "co_leader" ? 1 : 2;
}
