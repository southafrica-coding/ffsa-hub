"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Users,
  DollarSign,
  Wallet,
  ArrowUpRight,
  TrendingDown,
  Layers,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { CreateTeamForm } from "./create-team-form";

// ────────────────────────────────────────────────────────────
// TYPES
// ────────────────────────────────────────────────────────────

type Team = {
  id: string;
  team_name: string;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  status: string;
  people_count: number;
  total_budget_zar: number;
  programs: { id: string; name: string; code: string };
};

type Program = {
  id: string;
  name: string;
  code: string;
};

type BudgetDetail = {
  category_id: string;
  name: string;
  sort_order: number;
  budget_amount_zar: number;
};

type Aggregates = {
  expensesByTeam: Record<string, number>;
  releasesByTeam: Record<string, number>;
  budgetsByTeam: Record<string, number>;
  closeoutsByTeam: Record<string, string>;
  budgetDetailsByTeam: Record<string, BudgetDetail[]>;
  expenseDetailsByTeam: Record<string, Record<string, number>>;
};

// ────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
  }).format(amount);

const statusColors: Record<string, "default" | "secondary" | "destructive"> = {
  planning: "secondary",
  active: "default",
  review: "secondary",
  closed: "destructive",
};

const statusOptions = ["planning", "active", "review", "closed"];

// ────────────────────────────────────────────────────────────
// COMPONENT
// ────────────────────────────────────────────────────────────

export function OutreachDashboardClient({
  teams,
  programs,
  aggregates,
}: {
  teams: Team[];
  programs: Program[];
  aggregates: Aggregates;
}) {
  const router = useRouter();
  const [schoolFilter, setSchoolFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set());

  // Filter teams
  const filteredTeams = useMemo(() => {
    let result = teams;
    if (schoolFilter !== "all") {
      result = result.filter((t) => t.programs?.id === schoolFilter);
    }
    if (statusFilter !== "all") {
      result = result.filter((t) => t.status === statusFilter);
    }
    return result;
  }, [teams, schoolFilter, statusFilter]);

  // Compute aggregates from filtered teams
  const filteredAggregates = useMemo(() => {
    const teamIds = new Set(filteredTeams.map((t) => t.id));
    const totalPeople = filteredTeams.reduce(
      (s, t) => s + (t.people_count || 0),
      0
    );
    const totalBudget = filteredTeams.reduce(
      (s, t) => s + Number(t.total_budget_zar),
      0
    );
    let totalReleased = 0;
    let totalSpent = 0;
    for (const id of teamIds) {
      totalReleased += aggregates.releasesByTeam[id] || 0;
      totalSpent += aggregates.expensesByTeam[id] || 0;
    }
    return {
      teamCount: filteredTeams.length,
      totalPeople,
      totalBudget,
      totalReleased,
      totalSpent,
      availableCash: totalReleased - totalSpent,
    };
  }, [filteredTeams, aggregates]);

  const toggleExpand = (teamId: string) => {
    setExpandedTeams((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  };

  const handleStatusChange = async (teamId: string, newStatus: string) => {
    const res = await fetch("/api/finance/outreach/teams", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: teamId, status: newStatus }),
    });
    if (res.ok) {
      router.refresh();
    }
  };

  // Unique programs from teams for the school filter
  const uniquePrograms = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; code: string }>();
    for (const t of teams) {
      if (t.programs && !seen.has(t.programs.id)) {
        seen.set(t.programs.id, t.programs);
      }
    }
    return Array.from(seen.values());
  }, [teams]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <p className="page-eyebrow">OUTREACH FINANCE</p>
          <h1 className="page-title">Organisation Dashboard</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={schoolFilter} onValueChange={setSchoolFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="All Programs" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Programs</SelectItem>
              {uniquePrograms.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="All Teams" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Teams</SelectItem>
              {statusOptions.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <CreateTeamForm programs={programs ?? []} />
        </div>
      </div>

      {/* Aggregate Summary Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <SummaryCard
          icon={<Layers className="h-4 w-4" />}
          label="Teams"
          value={String(filteredAggregates.teamCount)}
          mono={false}
        />
        <SummaryCard
          icon={<Users className="h-4 w-4" />}
          label="People"
          value={String(filteredAggregates.totalPeople)}
          mono={false}
        />
        <SummaryCard
          icon={<DollarSign className="h-4 w-4" />}
          label="Total Budget"
          value={formatCurrency(filteredAggregates.totalBudget)}
        />
        <SummaryCard
          icon={<ArrowUpRight className="h-4 w-4" />}
          label="Funds Sent"
          value={formatCurrency(filteredAggregates.totalReleased)}
        />
        <SummaryCard
          icon={<TrendingDown className="h-4 w-4" />}
          label="Total Spent"
          value={formatCurrency(filteredAggregates.totalSpent)}
        />
        <SummaryCard
          icon={<Wallet className="h-4 w-4" />}
          label="Available Cash"
          value={formatCurrency(filteredAggregates.availableCash)}
          highlight={filteredAggregates.availableCash < 0}
        />
      </div>

      {/* Team Cards Grid */}
      {filteredTeams.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          No outreach teams match your filters. Create your first team to get
          started.
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredTeams.map((team) => {
            const released = aggregates.releasesByTeam[team.id] || 0;
            const spent = aggregates.expensesByTeam[team.id] || 0;
            const available = released - spent;
            const budget = Number(team.total_budget_zar);
            const pctUsed = budget > 0 ? (spent / budget) * 100 : 0;
            const barColor =
              pctUsed > 100
                ? "bg-red-500"
                : pctUsed >= 80
                  ? "bg-yellow-500"
                  : "bg-green-500";
            const costPerPerson =
              team.people_count > 0 ? spent / team.people_count : 0;
            const isExpanded = expandedTeams.has(team.id);
            const categoryBudgets =
              aggregates.budgetDetailsByTeam[team.id] || [];
            const categoryExpenses =
              aggregates.expenseDetailsByTeam[team.id] || {};

            return (
              <Card key={team.id} className="overflow-hidden">
                <CardContent className="pt-4 space-y-3">
                  {/* Header: Name + Status */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link
                        href={`/finance/outreach/${team.id}`}
                        className="font-semibold text-primary hover:underline truncate block"
                      >
                        {team.team_name}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {team.programs?.name ?? ""}{" "}
                        {team.programs?.code ? `${team.programs.code}` : ""}
                        {team.location ? ` · ${team.location}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Badge variant={statusColors[team.status] ?? "secondary"}>
                        {team.status}
                      </Badge>
                      <Select
                        value={team.status}
                        onValueChange={(val) =>
                          handleStatusChange(team.id, val)
                        }
                      >
                        <SelectTrigger className="h-6 w-6 p-0 border-0 bg-transparent [&>svg]:h-3 [&>svg]:w-3">
                          <ChevronDown className="h-3 w-3 text-muted-foreground" />
                        </SelectTrigger>
                        <SelectContent>
                          {statusOptions.map((s) => (
                            <SelectItem key={s} value={s}>
                              {s.charAt(0).toUpperCase() + s.slice(1)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Metrics Grid */}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    <div>
                      <span className="text-muted-foreground">People:</span>{" "}
                      <span className="font-medium">{team.people_count}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">
                        Cost/Person:
                      </span>{" "}
                      <span className="font-medium font-mono">
                        {formatCurrency(costPerPerson)}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Budget:</span>{" "}
                      <span className="font-medium font-mono">
                        {formatCurrency(budget)}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">
                        Funds Sent:
                      </span>{" "}
                      <span className="font-medium font-mono">
                        {formatCurrency(released)}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Spent:</span>{" "}
                      <span className="font-medium font-mono">
                        {formatCurrency(spent)}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Available:</span>{" "}
                      <span
                        className={`font-medium font-mono ${
                          available < 0 ? "text-destructive" : ""
                        }`}
                      >
                        {formatCurrency(available)}
                      </span>
                    </div>
                  </div>

                  {/* Budget Used Progress Bar */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Budget Used</span>
                      <span>{pctUsed.toFixed(0)}%</span>
                    </div>
                    <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${barColor}`}
                        style={{ width: `${Math.min(pctUsed, 100)}%` }}
                      />
                    </div>
                  </div>

                  {/* Expandable Category Breakdown */}
                  {categoryBudgets.length > 0 && (
                    <div>
                      <button
                        onClick={() => toggleExpand(team.id)}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-3 w-3" />
                        ) : (
                          <ChevronRight className="h-3 w-3" />
                        )}
                        View category breakdown
                      </button>
                      {isExpanded && (
                        <div className="mt-2 space-y-1">
                          {[...categoryBudgets]
                            .sort((a, b) => a.sort_order - b.sort_order)
                            .map((cat) => {
                              const catSpent =
                                categoryExpenses[cat.category_id] || 0;
                              const catRemaining =
                                cat.budget_amount_zar - catSpent;
                              return (
                                <div
                                  key={cat.category_id}
                                  className="flex items-center justify-between text-xs py-1 border-b border-muted last:border-0"
                                >
                                  <span className="text-muted-foreground truncate mr-2">
                                    {cat.name}
                                  </span>
                                  <div className="flex gap-3 shrink-0 font-mono">
                                    <span>
                                      {formatCurrency(cat.budget_amount_zar)}
                                    </span>
                                    <span
                                      className={
                                        catRemaining < 0
                                          ? "text-destructive"
                                          : "text-green-600"
                                      }
                                    >
                                      {formatCurrency(catRemaining)}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// SUMMARY CARD
// ────────────────────────────────────────────────────────────

function SummaryCard({
  icon,
  label,
  value,
  mono = true,
  highlight = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
}) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          {icon} {label}
        </p>
        <p
          className={`text-lg font-bold ${mono ? "font-mono" : ""} ${
            highlight ? "text-destructive" : ""
          }`}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
