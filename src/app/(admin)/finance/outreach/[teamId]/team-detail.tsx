"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Trash2, Edit2, Users, Wallet, Receipt, Banknote, BarChart3, CheckCircle2, TrendingDown, ArrowUpRight } from "lucide-react";
import { ExpensesTab } from "./expenses-tab";
import { PayoutsTab } from "./payouts-tab";
import { DashboardTab } from "./dashboard-tab";
import { CloseoutTab } from "./closeout-tab";
import { BudgetImport } from "./budget-import";

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
  programs: { id: string; name: string; code: string };
};

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
  };
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

const TEAM_ROLES = [
  { value: "outreach_leader", label: "Outreach Leader" },
  { value: "finance_student", label: "Finance Student" },
  { value: "school_leader", label: "School Leader" },
  { value: "finance_admin", label: "Finance Admin" },
  { value: "team_member", label: "Team Member" },
];

const statusColors: Record<string, "default" | "secondary" | "destructive"> = {
  planning: "secondary",
  active: "default",
  review: "secondary",
  closed: "destructive",
};

// ────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ────────────────────────────────────────────────────────────

export function TeamDetail({
  team,
  members,
  budgets,
  categories,
  allUsers,
  expenses,
  fundReleases,
  cashBatches,
  closeout,
  receiptCounts = {},
}: {
  team: Team;
  members: Member[];
  budgets: TeamBudget[];
  categories: Category[];
  allUsers: UserOption[];
  expenses: Expense[];
  fundReleases: FundRelease[];
  cashBatches: CashBatch[];
  closeout: Closeout | null;
  receiptCounts?: Record<string, number>;
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="page-eyebrow">OUTREACH FINANCE</p>
          <h1 className="page-title">{team.team_name}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {team.programs?.name} ({team.programs?.code})
            {team.location && ` · ${team.location}`}
            {team.country && `, ${team.country}`}
          </p>
          <p className="text-sm text-muted-foreground">
            {team.start_date && new Date(team.start_date).toLocaleDateString()}
            {team.end_date && ` – ${new Date(team.end_date).toLocaleDateString()}`}
            {` · ${team.people_count} people · Budget: ${formatCurrency(team.total_budget_zar)}`}
          </p>
        </div>
        <Badge variant={statusColors[team.status] ?? "secondary"} className="text-sm">
          {team.status}
        </Badge>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Total Budget</p>
            <p className="text-lg font-bold font-mono">{formatCurrency(team.total_budget_zar)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Budgeted by Category</p>
            <p className="text-lg font-bold font-mono">{formatCurrency(totalBudgeted)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <ArrowUpRight className="h-3 w-3" /> Total Released
            </p>
            <p className="text-lg font-bold font-mono">{formatCurrency(totalReleased)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <TrendingDown className="h-3 w-3" /> Total Spent
            </p>
            <p className="text-lg font-bold font-mono">{formatCurrency(totalSpent)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Remaining Funds</p>
            <p className={`text-lg font-bold font-mono ${remainingFunds < 0 ? "text-destructive" : ""}`}>
              {formatCurrency(remainingFunds)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">People</p>
            <p className="text-lg font-bold">{team.people_count}</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="budget">
        <TabsList className="w-full overflow-x-auto justify-start">
          <TabsTrigger value="budget" className="gap-1">
            <Wallet className="h-3 w-3" /> Budget ({budgets.length})
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
          <BudgetTab
            teamId={team.id}
            budgets={budgets}
            categories={categories}
            teamPeopleCount={team.people_count}
            spentByCategory={spentByCategory}
          />
        </TabsContent>

        <TabsContent value="members" className="mt-4">
          <MembersTab
            teamId={team.id}
            members={members}
            allUsers={allUsers}
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
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// BUDGET TAB
// ────────────────────────────────────────────────────────────

function BudgetTab({
  teamId,
  budgets,
  categories,
  teamPeopleCount,
  spentByCategory,
}: {
  teamId: string;
  budgets: TeamBudget[];
  categories: Category[];
  teamPeopleCount: number;
  spentByCategory: Record<string, number>;
}) {
  const router = useRouter();
  const [showAdd, setShowAdd] = useState(false);
  const [addCategoryId, setAddCategoryId] = useState("");
  const [addAmount, setAddAmount] = useState("");
  const [addPeople, setAddPeople] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editPeople, setEditPeople] = useState("");

  // Categories not yet budgeted
  const budgetedCatIds = new Set(budgets.map((b) => b.category_id));
  const availableCategories = categories.filter((c) => !budgetedCatIds.has(c.id));

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(amount);

  const totalBudgeted = budgets.reduce((sum, b) => sum + Number(b.budget_amount_zar), 0);

  async function handleAddBudget(e: React.FormEvent) {
    e.preventDefault();
    setAddLoading(true);
    try {
      const res = await fetch("/api/finance/outreach/budgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          team_id: teamId,
          category_id: addCategoryId,
          budget_amount_zar: Number(addAmount),
          people_count: addPeople ? Number(addPeople) : null,
        }),
      });
      if (res.ok) {
        setShowAdd(false);
        setAddCategoryId("");
        setAddAmount("");
        setAddPeople("");
        router.refresh();
      }
    } catch {
      toast.error("Failed to add budget");
    } finally {
      setAddLoading(false);
    }
  }

  async function handleSaveEdit(budgetId: string, categoryId: string) {
    try {
      const res = await fetch("/api/finance/outreach/budgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          team_id: teamId,
          category_id: categoryId,
          budget_amount_zar: Number(editAmount),
          people_count: editPeople ? Number(editPeople) : null,
        }),
      });
      if (res.ok) {
        setEditingId(null);
        router.refresh();
      }
    } catch {
      toast.error("Failed to update budget");
    }
  }

  async function handleDeleteBudget(id: string) {
    if (!confirm("Remove this budget line?")) return;
    try {
      const res = await fetch(`/api/finance/outreach/budgets?id=${id}`, {
        method: "DELETE",
      });
      if (res.ok) router.refresh();
    } catch {
      toast.error("Failed to delete");
    }
  }

  // Sort budgets by category sort_order
  const sortedBudgets = [...budgets].sort(
    (a, b) =>
      (a.outreach_budget_categories?.sort_order ?? 0) -
      (b.outreach_budget_categories?.sort_order ?? 0)
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Category Budgets</h3>
        <div className="flex gap-2">
          <BudgetImport teamId={teamId} categories={categories} />
          <Button size="sm" onClick={() => setShowAdd(true)} disabled={availableCategories.length === 0}>
            <Plus className="mr-2 h-4 w-4" />
            Add Category
          </Button>
        </div>
      </div>

      {showAdd && (
        <div className="rounded-lg border p-4">
          <form onSubmit={handleAddBudget} className="grid grid-cols-4 gap-3 items-end">
            <div>
              <Label>Category</Label>
              <Select value={addCategoryId} onValueChange={setAddCategoryId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  {availableCategories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Budget (ZAR)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                required
                value={addAmount}
                onChange={(e) => setAddAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div>
              <Label>People Count</Label>
              <Input
                type="number"
                min="0"
                value={addPeople}
                onChange={(e) => setAddPeople(e.target.value)}
                placeholder={String(teamPeopleCount)}
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={addLoading || !addCategoryId}>
                {addLoading ? "Adding..." : "Add"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowAdd(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}

      <div className="rounded-lg border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">People</TableHead>
              <TableHead className="text-right">Budget (ZAR)</TableHead>
              <TableHead className="text-right">Spent (ZAR)</TableHead>
              <TableHead className="text-right">Remaining</TableHead>
              <TableHead className="w-[80px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedBudgets.map((b) => {
              const isEditing = editingId === b.id;
              const spent = spentByCategory[b.category_id] || 0;
              const remaining = Number(b.budget_amount_zar) - spent;

              return (
                <TableRow key={b.id}>
                  <TableCell className="font-medium">
                    {b.outreach_budget_categories?.name ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {isEditing ? (
                      <Input
                        type="number"
                        min="0"
                        className="w-20 ml-auto text-right"
                        value={editPeople}
                        onChange={(e) => setEditPeople(e.target.value)}
                      />
                    ) : (
                      b.people_count ?? teamPeopleCount
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {isEditing ? (
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        className="w-28 ml-auto text-right"
                        value={editAmount}
                        onChange={(e) => setEditAmount(e.target.value)}
                      />
                    ) : (
                      formatCurrency(Number(b.budget_amount_zar))
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatCurrency(spent)}
                  </TableCell>
                  <TableCell className={`text-right font-mono ${remaining < 0 ? "text-destructive" : ""}`}>
                    {formatCurrency(remaining)}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {isEditing ? (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleSaveEdit(b.id, b.category_id)}
                          >
                            Save
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditingId(null)}
                          >
                            ✕
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => {
                              setEditingId(b.id);
                              setEditAmount(String(b.budget_amount_zar));
                              setEditPeople(b.people_count != null ? String(b.people_count) : "");
                            }}
                          >
                            <Edit2 className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => handleDeleteBudget(b.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {/* Total row */}
            {sortedBudgets.length > 0 && (() => {
              const totalSpentAll = Object.values(spentByCategory).reduce((s, v) => s + v, 0);
              const totalRemaining = totalBudgeted - totalSpentAll;
              return (
                <TableRow className="font-bold border-t-2">
                  <TableCell>Total</TableCell>
                  <TableCell />
                  <TableCell className="text-right font-mono">
                    {formatCurrency(totalBudgeted)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatCurrency(totalSpentAll)}
                  </TableCell>
                  <TableCell className={`text-right font-mono ${totalRemaining < 0 ? "text-destructive" : ""}`}>
                    {formatCurrency(totalRemaining)}
                  </TableCell>
                  <TableCell />
                </TableRow>
              );
            })()}
          </TableBody>
        </Table>
      </div>

      {sortedBudgets.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-6">
          No budget categories added yet. Click &quot;Add Category&quot; to start building the budget.
        </p>
      )}
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
}: {
  teamId: string;
  members: Member[];
  allUsers: UserOption[];
}) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedRole, setSelectedRole] = useState("team_member");
  const [addLoading, setAddLoading] = useState(false);

  const memberUserIds = new Set(members.map((m) => m.user_id));
  const availableUsers = allUsers.filter((u) => !memberUserIds.has(u.id));

  function userName(u: { first_name: string | null; last_name: string | null; preferred_name: string | null; email: string | null }) {
    if (u.first_name) {
      return `${u.preferred_name ?? u.first_name} ${u.last_name ?? ""}`.trim();
    }
    return u.email ?? "Unknown";
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
      await fetch("/api/finance/outreach/team-members", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: memberId, role: newRole }),
      });
      router.refresh();
    } catch {
      toast.error("Failed to update role");
    }
  }

  async function handleRemoveMember(memberId: string) {
    if (!confirm("Remove this member from the team?")) return;
    try {
      const res = await fetch(`/api/finance/outreach/team-members?id=${memberId}`, {
        method: "DELETE",
      });
      if (res.ok) router.refresh();
    } catch {
      toast.error("Failed to remove member");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Team Members</h3>
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
                <Label>User</Label>
                <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a user..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableUsers.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {userName(u)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Role</Label>
                <Select value={selectedRole} onValueChange={setSelectedRole}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TEAM_ROLES.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
      </div>

      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">
          No team members yet. Add members to get started.
        </p>
      ) : (
        <div className="rounded-lg border bg-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="w-[60px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">
                    {userName(m.users)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {m.users.email ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={m.role}
                      onValueChange={(val) => handleRoleChange(m.id, val)}
                    >
                      <SelectTrigger className="w-[160px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TEAM_ROLES.map((r) => (
                          <SelectItem key={r.value} value={r.value}>
                            {r.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => handleRemoveMember(m.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
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
