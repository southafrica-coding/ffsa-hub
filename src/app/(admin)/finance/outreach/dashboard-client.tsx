"use client";

import { Fragment, useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  Masthead,
  MastheadAction,
  NeedsYou,
  SectionBar,
  StatusPill,
  KpiStrip,
  Bar,
} from "@/components/ffsa";
import { cashInHand } from "@/lib/finance/outreach-cash";
import { LEVEL_COLOUR } from "./cash-in-hand";
import { MoneyKpi, barTone } from "../money-kpi";
import { CreateTeamForm } from "./create-team-form";
import { MovementsPanel } from "./movements-panel";
import { TeamAdminActions } from "./team-admin-actions";
import type {
  MoneyMovement,
  UnmatchedPayment,
} from "@/services/outreach-finance";

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

type ArchivedTeam = {
  id: string;
  team_name: string;
  archived_at: string;
  program_code: string | null;
  /** What a delete would destroy ("12 expenses"); empty = safe to delete. */
  deleteBlockers: string[];
};

type Program = {
  id: string;
  name: string;
  code: string;
};

type OutreachGroup = {
  id: string;
  name: string;
  category: string | null;
};

// Radix Select can't hold an empty value; this stands for "no group".
const NO_GROUP = "__none__";

type BudgetDetail = {
  category_id: string;
  name: string;
  sort_order: number;
  budget_amount_zar: number;
};

type Aggregates = {
  expensesByTeam: Record<string, number>;
  teamCashSpentByTeam: Record<string, number>;
  cashThresholdsByTeam: Record<string, { low: number | null; critical: number | null }>;
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

const statusTones: Record<string, "good" | "warn" | "quiet" | "bad"> = {
  planning: "quiet",
  active: "good",
  review: "warn",
  closed: "bad",
};

const statusOptions = ["planning", "active", "review", "closed"];

// Funding state is DERIVED from how much of the budget has actually been
// released to the team — there is no such column in the database.
function fundingState(pct: number): { label: string; tone: "good" | "warn" | "quiet" } {
  if (pct >= 100) return { label: "Fully funded", tone: "good" };
  if (pct >= 50) return { label: "On track", tone: "quiet" };
  if (pct > 0) return { label: "Behind", tone: "warn" };
  return { label: "Not started", tone: "quiet" };
}

const TABLE_COLUMNS = 8;

// ────────────────────────────────────────────────────────────
// COMPONENT
// ────────────────────────────────────────────────────────────

export function OutreachDashboardClient({
  teams,
  programs,
  aggregates,
  movements,
  unmatched,
  isStaff,
  canManage,
  archivedTeams,
  groups,
  teamGroups,
  teamAccess,
  showGroupsLink,
}: {
  teams: Team[];
  programs: Program[];
  aggregates: Aggregates;
  // Read-only ledger feeds. They are NOT filtered by the school/status filters
  // above: they are org-wide movements, and silently hiding a payment because a
  // team filter is set would misread as "this money did not happen".
  movements: MoneyMovement[];
  unmatched: { count: number; rows: UnmatchedPayment[] };
  /** Finance staff see every team; everyone else only the outreaches they lead. */
  isStaff: boolean;
  /** Outreach administrators: archive, unarchive and delete teams. */
  canManage: boolean;
  /** Only loaded for outreach administrators. */
  archivedTeams: ArchivedTeam[];
  /** Outreach groups this viewer can see (migration 273). */
  groups: OutreachGroup[];
  /** team id → the ids of the visible groups it is in. */
  teamGroups: Record<string, string[]>;
  /** team id → whether this viewer may change it, and why ("Group manager", "View only"). */
  teamAccess: Record<string, { canEdit: boolean; label: string | null }>;
  /** Staff and group managers get the Groups screen. */
  showGroupsLink: boolean;
}) {
  const router = useRouter();
  const [groupFilter, setGroupFilter] = useState("all");
  const [schoolFilter, setSchoolFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set());
  const [showArchived, setShowArchived] = useState(false);

  // Filter teams
  const teamCash = (teamId: string) =>
    cashInHand({
      sent: aggregates.releasesByTeam[teamId] || 0,
      spent: aggregates.teamCashSpentByTeam?.[teamId] || 0,
      lowPct: aggregates.cashThresholdsByTeam?.[teamId]?.low,
      criticalPct: aggregates.cashThresholdsByTeam?.[teamId]?.critical,
    });

  const filteredTeams = useMemo(() => {
    let result = teams;
    if (groupFilter === NO_GROUP) {
      result = result.filter((t) => !(teamGroups[t.id] ?? []).length);
    } else if (groupFilter !== "all") {
      result = result.filter((t) => (teamGroups[t.id] ?? []).includes(groupFilter));
    }
    if (schoolFilter !== "all") {
      result = result.filter((t) => t.programs?.id === schoolFilter);
    }
    if (statusFilter !== "all") {
      result = result.filter((t) => t.status === statusFilter);
    }
    // Teams running out of the money sent to them come first, so school
    // leaders see who needs money before anything else.
    const urgency = (t: Team) => {
      const c = teamCash(t.id);
      const rank = { critical: 0, low: 1, ok: 2, none: 3 }[c.level];
      return [rank, c.pctLeft ?? 1000] as const;
    };
    return [...result].sort((a, b) => {
      const [ra, pa] = urgency(a);
      const [rb, pb] = urgency(b);
      return ra - rb || pa - pb;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teams, groupFilter, schoolFilter, statusFilter, aggregates, teamGroups]);

  const groupName = useMemo(
    () => Object.fromEntries(groups.map((g) => [g.id, g.name])) as Record<string, string>,
    [groups]
  );
  const sectionTitle =
    groupFilter === "all"
      ? "Outreach teams"
      : groupFilter === NO_GROUP
        ? "Not in a group"
        : groupName[groupFilter] ?? "Outreach teams";

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

  // The page's single yellow band. `closeoutsByTeam` is already fetched for the
  // dashboard; a closeout sits at "pending" only when its variance exceeded 2%
  // and an admin has to approve or reject it. Counted over the FILTERED teams so
  // the band never points at rows the current filters hide.
  const pendingCloseouts = useMemo(
    () =>
      filteredTeams.filter(
        (t) => aggregates.closeoutsByTeam[t.id] === "pending"
      ).length,
    [filteredTeams, aggregates]
  );

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

  // The ledger column is drawn only when at least one source came back with
  // rows — an unreadable source (RLS) or a quiet week leaves the table alone.
  const hasLedger = movements.length > 0 || unmatched.count > 0;

  const agg = filteredAggregates;
  const sentPct = agg.totalBudget > 0 ? (agg.totalReleased / agg.totalBudget) * 100 : 0;
  const usedPct = agg.totalBudget > 0 ? (agg.totalSpent / agg.totalBudget) * 100 : 0;
  const spentOfSentPct =
    agg.totalReleased > 0 ? (agg.totalSpent / agg.totalReleased) * 100 : 0;
  const heldPct =
    agg.totalReleased > 0 ? (agg.availableCash / agg.totalReleased) * 100 : 0;

  return (
    <div className="ffsa-screen">
      <Masthead
        context="Outreach finance"
        title={isStaff ? "Organisation Dashboard" : "Your outreaches"}
        actions={
          <>
            {showGroupsLink && (
              <MastheadAction href="/finance/outreach/groups">Groups</MastheadAction>
            )}
            <CreateTeamForm programs={programs ?? []} />
          </>
        }
      />

      {isStaff && pendingCloseouts > 0 && (
        <NeedsYou>
          {pendingCloseouts === 1
            ? "1 team closeout is waiting on your review"
            : `${pendingCloseouts} team closeouts are waiting on your review`}
        </NeedsYou>
      )}

      {/* Filter strip — bone, sits directly under the masthead */}
      <div className="flex flex-wrap items-center gap-2 border-b border-rule bg-bone px-8 py-3">
        <span className="mono-label mr-1">Filter</span>
        {groups.length > 0 && (
          <Select value={groupFilter} onValueChange={setGroupFilter}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="All Groups" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Groups</SelectItem>
              {groups.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name}
                  {g.category ? ` · ${g.category}` : ""}
                </SelectItem>
              ))}
              <SelectItem value={NO_GROUP}>Not in a group</SelectItem>
            </SelectContent>
          </Select>
        )}
        <Select value={schoolFilter} onValueChange={setSchoolFilter}>
          <SelectTrigger className="w-[180px]">
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
          <SelectTrigger className="w-[160px]">
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
      </div>

      <div className="space-y-7 px-8 py-7">
        {/* Money strip — four cells, each measuring itself against a real ratio */}
        <div className="border-x border-t border-ink">
          <KpiStrip>
            <MoneyKpi
              lead
              label="Total budget"
              value={formatCurrency(agg.totalBudget)}
              pct={usedPct}
              foot={`${usedPct.toFixed(0)}% spent · ${agg.teamCount} teams · ${agg.totalPeople} people`}
              tone={barTone(usedPct)}
            />
            <MoneyKpi
              label="Funds sent"
              value={formatCurrency(agg.totalReleased)}
              pct={sentPct}
              foot={`${sentPct.toFixed(0)}% of budget released`}
            />
            <MoneyKpi
              label="Total spent"
              value={formatCurrency(agg.totalSpent)}
              pct={spentOfSentPct}
              foot={`${spentOfSentPct.toFixed(0)}% of funds sent`}
              tone={barTone(spentOfSentPct)}
            />
            <MoneyKpi
              label="Available cash"
              value={formatCurrency(agg.availableCash)}
              negative={agg.availableCash < 0}
              positive={agg.availableCash >= 0}
              pct={Math.max(0, heldPct)}
              foot={
                agg.availableCash < 0
                  ? "Overspent against funds sent"
                  : `${Math.max(0, heldPct).toFixed(0)}% of funds sent still held`
              }
            />
          </KpiStrip>
        </div>

        {/* Teams, with the movements ledger alongside on wide screens. The
            right column only exists when there is something real in it, so the
            table keeps the full width when a viewer cannot read the sources. */}
        <div
          className={
            hasLedger
              ? "grid gap-7 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-stretch"
              : undefined
          }
        >
        <div className="border border-ink">
          <SectionBar
            title={sectionTitle}
            meta={`${agg.teamCount} teams · ${agg.totalPeople} people`}
          />
          {filteredTeams.length === 0 ? (
            <p className="px-6 py-10 text-center text-[13px] text-[color:var(--text-tertiary)]">
              {isStaff
                ? "No outreach teams match your filters. Create your first team to get started."
                : "No outreaches yet. Start one with New Team: you'll be its owner and can invite co-leaders to run the budget with you."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Team</TableHead>
                    <TableHead className="text-right">People</TableHead>
                    <TableHead className="text-right">Budget</TableHead>
                    <TableHead className="min-w-[170px]">Funded</TableHead>
                    <TableHead>Funding state</TableHead>
                    <TableHead className="text-right">Spent</TableHead>
                    <TableHead className="min-w-[170px]">Still with team</TableHead>
                    <TableHead className="w-[150px]">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTeams.map((team) => {
                    const released = aggregates.releasesByTeam[team.id] || 0;
                    const spent = aggregates.expensesByTeam[team.id] || 0;
                    // Money still with the team: sent minus what they spent
                    // of it (not base prepayments) — see outreach-cash.ts.
                    const cash = teamCash(team.id);
                    const available = cash.left;
                    const budget = Number(team.total_budget_zar);
                    const pctUsed = budget > 0 ? (spent / budget) * 100 : 0;
                    const pctFunded = budget > 0 ? (released / budget) * 100 : 0;
                    const funding = fundingState(pctFunded);
                    const costPerPerson =
                      team.people_count > 0 ? spent / team.people_count : 0;
                    const isExpanded = expandedTeams.has(team.id);
                    const categoryBudgets =
                      aggregates.budgetDetailsByTeam[team.id] || [];
                    const categoryExpenses =
                      aggregates.expenseDetailsByTeam[team.id] || {};
                    const access = teamAccess[team.id] ?? { canEdit: false, label: null };

                    return (
                      <Fragment key={team.id}>
                        <TableRow>
                          <TableCell className="align-top">
                            <div className="flex items-start gap-2">
                              {categoryBudgets.length > 0 ? (
                                <button
                                  onClick={() => toggleExpand(team.id)}
                                  aria-label={
                                    isExpanded
                                      ? "Hide category breakdown"
                                      : "Show category breakdown"
                                  }
                                  className="mt-0.5 text-[color:var(--text-tertiary)] hover:text-[color:var(--text-primary)]"
                                >
                                  {isExpanded ? (
                                    <ChevronDown className="h-3.5 w-3.5" />
                                  ) : (
                                    <ChevronRight className="h-3.5 w-3.5" />
                                  )}
                                </button>
                              ) : (
                                <span className="w-3.5 shrink-0" />
                              )}
                              <div className="min-w-0">
                                <Link
                                  href={`/finance/outreach/${team.id}`}
                                  className="block truncate font-display text-[19px] font-black uppercase leading-none hover:text-electric"
                                >
                                  {team.team_name}
                                </Link>
                                <p className="mono-label mt-1.5">
                                  {team.programs?.code ?? ""}
                                  {team.programs?.name ? ` · ${team.programs.name}` : ""}
                                  {team.location ? ` · ${team.location}` : ""}
                                </p>
                                {(teamGroups[team.id] ?? []).length > 0 && (
                                  <p className="mono-label mt-1 text-[color:var(--text-tertiary)]">
                                    {(teamGroups[team.id] ?? [])
                                      .map((g) => groupName[g])
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </p>
                                )}
                                {access.label && (
                                  <div className="mt-1.5">
                                    <StatusPill tone="quiet">{access.label}</StatusPill>
                                  </div>
                                )}
                              </div>
                            </div>
                          </TableCell>

                          <TableCell className="align-top text-right">
                            <span className="numeral text-[20px]">
                              {team.people_count}
                            </span>
                            <p className="mono-label mt-1 whitespace-nowrap">
                              {formatCurrency(costPerPerson)} ea
                            </p>
                          </TableCell>

                          <TableCell className="tabular align-top whitespace-nowrap text-right font-mono text-[12.5px]">
                            {formatCurrency(budget)}
                          </TableCell>

                          <TableCell className="align-top">
                            <div className="tabular mb-1.5 whitespace-nowrap font-mono text-[12.5px]">
                              {formatCurrency(released)}
                              <span className="ml-2 text-[color:var(--text-tertiary)]">
                                {pctFunded.toFixed(0)}%
                              </span>
                            </div>
                            <Bar pct={pctFunded} />
                          </TableCell>

                          <TableCell className="align-top">
                            <StatusPill tone={funding.tone}>{funding.label}</StatusPill>
                          </TableCell>

                          <TableCell className="align-top whitespace-nowrap text-right">
                            <span
                              className="tabular font-mono text-[12.5px]"
                              style={
                                pctUsed > 100
                                  ? { color: "hsl(var(--destructive))" }
                                  : undefined
                              }
                            >
                              {formatCurrency(spent)}
                            </span>
                            <p className="mono-label mt-1">
                              {pctUsed.toFixed(0)}% of budget
                            </p>
                          </TableCell>

                          <TableCell className="align-top">
                            {cash.level === "none" ? (
                              <span className="mono-label">Nothing sent yet</span>
                            ) : (
                              <>
                                <div
                                  className="tabular mb-1.5 whitespace-nowrap font-mono text-[12.5px]"
                                  style={{ color: LEVEL_COLOUR[cash.level] }}
                                >
                                  {formatCurrency(available)}
                                  <span className="ml-2">
                                    {Math.max(0, cash.pctLeft ?? 0).toFixed(0)}% left
                                  </span>
                                </div>
                                <Bar pct={cash.pctSpent ?? 0} tone={LEVEL_COLOUR[cash.level]} />
                                {cash.level !== "ok" && (
                                  <p className="mono-label mt-1.5" style={{ color: LEVEL_COLOUR[cash.level] }}>
                                    {cash.level === "critical" ? "Send money now" : "Send money soon"}
                                  </p>
                                )}
                              </>
                            )}
                          </TableCell>

                          <TableCell className="align-top">
                            <div className="flex items-center gap-1">
                              <StatusPill tone={statusTones[team.status] ?? "quiet"}>
                                {team.status}
                              </StatusPill>
                              {access.canEdit && (
                              <Select
                                value={team.status}
                                onValueChange={(val) =>
                                  handleStatusChange(team.id, val)
                                }
                              >
                                <SelectTrigger className="h-6 w-6 border-0 bg-transparent p-0 [&>svg]:h-3 [&>svg]:w-3">
                                  <ChevronDown className="h-3 w-3 text-[color:var(--text-tertiary)]" />
                                </SelectTrigger>
                                <SelectContent>
                                  {statusOptions.map((s) => (
                                    <SelectItem key={s} value={s}>
                                      {s.charAt(0).toUpperCase() + s.slice(1)}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>

                        {isExpanded && categoryBudgets.length > 0 && (
                          <TableRow>
                            <TableCell colSpan={TABLE_COLUMNS} className="bg-bone !py-4">
                              <p className="mono-label mb-2">Category breakdown</p>
                              <div className="max-w-3xl">
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
                                        className="flex items-center justify-between gap-4 border-b border-rule py-1.5 text-[12.5px] last:border-0"
                                      >
                                        <span className="truncate text-[color:var(--text-secondary)]">
                                          {cat.name}
                                        </span>
                                        <div className="tabular flex shrink-0 gap-5 font-mono">
                                          <span>
                                            {formatCurrency(cat.budget_amount_zar)}
                                          </span>
                                          <span
                                            style={{
                                              color:
                                                catRemaining < 0
                                                  ? "hsl(var(--destructive))"
                                                  : "var(--green-text)",
                                            }}
                                          >
                                            {formatCurrency(catRemaining)}
                                          </span>
                                        </div>
                                      </div>
                                    );
                                  })}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        <MovementsPanel
          movements={movements}
          unmatched={unmatched}
          formatCurrency={formatCurrency}
        />
        </div>

        {/* Archived teams: out of the list above, kept for admins to restore
            or (when nothing is linked) delete. */}
        {canManage && archivedTeams.length > 0 && (
          <div className="border border-rule">
            <button
              type="button"
              onClick={() => setShowArchived((o) => !o)}
              className="flex w-full items-center justify-between px-5 py-3 text-left"
            >
              <span className="mono-label">Archived teams · {archivedTeams.length}</span>
              {showArchived ? (
                <ChevronDown className="h-4 w-4 text-[color:var(--text-tertiary)]" />
              ) : (
                <ChevronRight className="h-4 w-4 text-[color:var(--text-tertiary)]" />
              )}
            </button>
            {showArchived && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Team</TableHead>
                    <TableHead>Archived</TableHead>
                    <TableHead className="w-[230px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {archivedTeams.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>
                        <Link
                          href={`/finance/outreach/${t.id}`}
                          className="font-display text-[16px] font-black uppercase leading-none hover:text-electric"
                        >
                          {t.team_name}
                        </Link>
                        {t.program_code && <p className="mono-label mt-1">{t.program_code}</p>}
                      </TableCell>
                      <TableCell className="tabular font-mono text-[12.5px]">
                        {new Date(t.archived_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <TeamAdminActions
                          key={t.deleteBlockers.join("|")}
                          teamId={t.id}
                          teamName={t.team_name}
                          archived
                          deleteBlockers={t.deleteBlockers}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
