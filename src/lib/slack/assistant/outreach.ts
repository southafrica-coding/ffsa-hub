/**
 * Outreach teams in Slack: who is asking, which team they mean, and the
 * budget tools the bot may use for them.
 *
 * The admin Q&A bot (access.ts) is a fixed allowlist that sees
 * everything. Outreach is the opposite: anyone on a team may ask, but
 * only about their own team. So scope is decided HERE, in code, from the
 * asker's Hub memberships — never from what the model passes in. A tool
 * call naming another team is matched only against the teams this asker
 * may see.
 *
 *   DM            → the asker's teams (slack_enabled ones); one team is
 *                   the default, several means "say which".
 *   team channel  → the team linked to that channel, nothing else.
 *   finance staff → may also ask about any team by name in a DM.
 *
 * Uses the service-role client (the bot has no logged-in user), so every
 * query is filtered by the resolved team ids.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { guessCategory, type BudgetCategory } from "@/lib/finance/outreach-budget";
import { mondayOf, plannerDays, pot, shiftDate } from "@/lib/finance/outreach-plan";
import { OUTREACH_LEADER_ROLES } from "@/lib/finance/outreach-roles";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any;

export type OutreachTeamRef = {
  id: string;
  team_name: string;
  country: string | null;
  /** The asker's role on the team; null when they see it as finance staff. */
  role: string | null;
};

export type OutreachScope = {
  hubUserId: string;
  /** The team a question is about when it doesn't name one. */
  defaultTeamId: string | null;
  /** Every team this asker may ask about in this conversation. */
  teams: OutreachTeamRef[];
  /** True in a team channel: answers are seen by the whole team. */
  inTeamChannel: boolean;
};

export type OutreachResolution =
  | { kind: "none" }
  | { kind: "refuse"; reason: string }
  | { kind: "ok"; scope: OutreachScope };

const FINANCE_STAFF_ROLES = ["super_admin", "admin", "finance_admin"];
const FINANCE_STAFF_PERMISSIONS = ["finance.view", "finance.edit"];

/** Admins and finance staff see every outreach team, as in the Hub. */
export async function isFinanceStaff(admin: AdminClient, hubUserId: string): Promise<boolean> {
  const { data: roles } = await admin
    .from("user_roles")
    .select("role_id, roles!inner(name)")
    .eq("user_id", hubUserId);
  const roleRows = (roles ?? []) as { role_id: string; roles: { name: string } | { name: string }[] }[];
  const names = roleRows.flatMap((r) => (Array.isArray(r.roles) ? r.roles : [r.roles]).map((x) => x.name));
  if (names.some((n) => FINANCE_STAFF_ROLES.includes(n))) return true;

  const { data: direct } = await admin
    .from("user_permissions")
    .select("permissions!inner(key)")
    .eq("user_id", hubUserId)
    .in("permissions.key", FINANCE_STAFF_PERMISSIONS)
    .limit(1);
  if (direct && direct.length > 0) return true;

  const roleIds = roleRows.map((r) => r.role_id);
  if (roleIds.length === 0) return false;
  const { data: viaRole } = await admin
    .from("role_permissions")
    .select("permissions!inner(key)")
    .in("role_id", roleIds)
    .in("permissions.key", FINANCE_STAFF_PERMISSIONS)
    .limit(1);
  return !!(viaRole && viaRole.length > 0);
}

type TeamRow = { id: string; team_name: string; country: string | null; slack_enabled: boolean };

/**
 * Decide whether this Slack message is an outreach conversation and, if
 * so, which teams it may touch. `none` means "not outreach — fall back to
 * the admin bot rules"; `refuse` carries a reply for the asker.
 */
export async function resolveOutreachScope(
  admin: AdminClient,
  args: { hubUserId: string | null; channelId: string; isDM: boolean }
): Promise<OutreachResolution> {
  // A channel linked to a team is ALWAYS that team's conversation.
  if (!args.isDM) {
    const { data: linked } = await admin
      .from("outreach_teams")
      .select("id, team_name, country, slack_enabled")
      .eq("slack_channel_id", args.channelId)
      .maybeSingle();
    const team = linked as TeamRow | null;
    if (!team) return { kind: "none" };

    if (!team.slack_enabled) {
      return { kind: "refuse", reason: `Budget questions aren't switched on for *${team.team_name}* yet.` };
    }
    if (!args.hubUserId) {
      return {
        kind: "refuse",
        reason: "I don't know who you are yet — link your Slack on your Hub profile, then ask again.",
      };
    }
    // The budget is for the team's owner and co-leaders (migration 260);
    // plain members see the trip, not the money.
    const memberRole = await membershipRole(admin, team.id, args.hubUserId);
    const role = memberRole && OUTREACH_LEADER_ROLES.includes(memberRole) ? memberRole : null;
    if (role === null && !(await isFinanceStaff(admin, args.hubUserId))) {
      return {
        kind: "refuse",
        reason: memberRole
          ? `*${team.team_name}*'s budget is run by its owner and co-leaders, so I can't share it with team members.`
          : `This channel is for *${team.team_name}*'s budget, and you're not on that team in the Hub.`,
      };
    }
    return {
      kind: "ok",
      scope: {
        hubUserId: args.hubUserId,
        defaultTeamId: team.id,
        teams: [{ id: team.id, team_name: team.team_name, country: team.country, role }],
        inTeamChannel: true,
      },
    };
  }

  // DM.
  if (!args.hubUserId) return { kind: "none" };

  const { data: rows } = await admin
    .from("outreach_team_members")
    .select("role, outreach_teams!inner(id, team_name, country, slack_enabled, status)")
    .eq("user_id", args.hubUserId)
    .in("role", OUTREACH_LEADER_ROLES)
    .eq("outreach_teams.slack_enabled", true);
  const mine: OutreachTeamRef[] = ((rows ?? []) as { role: string; outreach_teams: TeamRow }[]).map(
    (r) => ({
      id: r.outreach_teams.id,
      team_name: r.outreach_teams.team_name,
      country: r.outreach_teams.country,
      role: r.role,
    })
  );

  const staff = await isFinanceStaff(admin, args.hubUserId);
  if (mine.length === 0 && !staff) return { kind: "none" };

  let teams = mine;
  if (staff) {
    const { data: all } = await admin.from("outreach_teams").select("id, team_name, country");
    const mineIds = new Set(mine.map((t) => t.id));
    teams = [
      ...mine,
      ...((all ?? []) as TeamRow[])
        .filter((t) => !mineIds.has(t.id))
        .map((t) => ({ id: t.id, team_name: t.team_name, country: t.country, role: null })),
    ];
  }

  return {
    kind: "ok",
    scope: {
      hubUserId: args.hubUserId,
      // Your own team is the default; staff with no team must name one.
      defaultTeamId: mine.length === 1 ? mine[0].id : null,
      teams,
      inTeamChannel: false,
    },
  };
}

async function membershipRole(admin: AdminClient, teamId: string, hubUserId: string) {
  const { data } = await admin
    .from("outreach_team_members")
    .select("role")
    .eq("team_id", teamId)
    .eq("user_id", hubUserId)
    .maybeSingle();
  return (data as { role: string } | null)?.role ?? null;
}

// ────────────────────────────────────────────────────────────
// Pure helpers (tested)
// ────────────────────────────────────────────────────────────

export type TeamPick =
  | { ok: true; team: OutreachTeamRef }
  | { ok: false; needs_clarification: string; candidates: string[] };

/** Which team a question is about, chosen only from teams in scope. */
export function pickTeam(scope: OutreachScope, asked?: string | null): TeamPick {
  const q = (asked ?? "").trim().toLowerCase();
  if (q) {
    // Exact name, then part of a name, and only then the country — so
    // "Botswana" means the team called Botswana, not any team going there.
    const byName = (t: OutreachTeamRef) => t.team_name.toLowerCase();
    let loose = scope.teams.filter((t) => byName(t) === q);
    if (!loose.length) loose = scope.teams.filter((t) => byName(t).includes(q) || q.includes(byName(t)));
    if (!loose.length) loose = scope.teams.filter((t) => (t.country ?? "").toLowerCase() === q);
    if (loose.length === 1) return { ok: true, team: loose[0] };
    if (loose.length > 1) {
      return { ok: false, needs_clarification: "Which team?", candidates: loose.map((t) => t.team_name) };
    }
    // Asked for a team they can't see (or that doesn't exist) — never leak which.
    return {
      ok: false,
      needs_clarification: `No team called "${asked}" that you can see.`,
      candidates: scope.teams.filter((t) => t.role !== null).map((t) => t.team_name),
    };
  }
  const def = scope.teams.find((t) => t.id === scope.defaultTeamId);
  if (def) return { ok: true, team: def };
  const own = scope.teams.filter((t) => t.role !== null);
  return {
    ok: false,
    needs_clarification: "Which team do you mean?",
    candidates: (own.length ? own : scope.teams).map((t) => t.team_name),
  };
}

// Casual words people use in Slack that a budget sheet never does.
const SLACK_WORDS: [RegExp, string][] = [
  [/\b(gas|petrol|diesel|fuel)\b/i, "Transport"],
  [/\b(groceries|grocery|eating|snacks?)\b/i, "Food"],
  [/\b(housing|rent|sleeping|beds?)\b/i, "Accommodation"],
];

/** A category from casual words, or null. */
export function resolveCategory(text: string, categories: BudgetCategory[]): BudgetCategory | null {
  const q = text.trim().toLowerCase();
  if (!q) return null;
  const exact = categories.find((c) => c.name.toLowerCase() === q || c.slug === q);
  if (exact) return exact;
  for (const [re, name] of SLACK_WORDS) {
    if (re.test(text)) {
      const c = categories.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (c) return c;
    }
  }
  return guessCategory(text, categories);
}

const SAST_OFFSET_MS = 2 * 60 * 60 * 1000; // SA and Botswana: UTC+2, no DST

/** YYYY-MM-DD of a date in SAST. */
export function sastDate(d: Date): string {
  return new Date(d.getTime() + SAST_OFFSET_MS).toISOString().slice(0, 10);
}

export type ExpensePeriod = "today" | "yesterday" | "this_week" | "all";

/** Inclusive [from, to] dates for an expense_date filter; null = no bound. */
export function periodRange(period: ExpensePeriod | undefined, now = new Date()) {
  const today = sastDate(now);
  const shift = (days: number) => sastDate(new Date(now.getTime() + days * 86_400_000));
  switch (period) {
    case "today":
      return { from: today, to: today, label: "today" };
    case "yesterday":
      return { from: shift(-1), to: shift(-1), label: "yesterday" };
    case "this_week": {
      // Week starts Monday.
      const dow = new Date(today + "T00:00:00Z").getUTCDay(); // 0 = Sunday
      const back = (dow + 6) % 7;
      return { from: shift(-back), to: today, label: "this week" };
    }
    default:
      return { from: null, to: null, label: "the whole outreach" };
  }
}

type LineRow = { category_id: string; description: string; total_zar: number | string };
type ExpenseRow = {
  category_id: string;
  zar_amount: number | string;
  expense_date?: string;
};

export type CategorySummary = {
  category: string;
  planned: number;
  spent: number;
  left: number;
  receipts: number;
};

/** Planned / spent / left per category, the same sums the Hub shows. */
export function summarise(categories: BudgetCategory[], lines: LineRow[], expenses: ExpenseRow[]) {
  const byId = new Map<string, CategorySummary & { sort: number }>();
  const row = (id: string) => {
    let r = byId.get(id);
    if (!r) {
      const c = categories.find((x) => x.id === id);
      r = { category: c?.name ?? "Unknown", planned: 0, spent: 0, left: 0, receipts: 0, sort: c?.sort_order ?? 9999 };
      byId.set(id, r);
    }
    return r;
  };
  for (const l of lines) row(l.category_id).planned += Number(l.total_zar);
  for (const e of expenses) {
    const r = row(e.category_id);
    r.spent += Number(e.zar_amount);
    r.receipts += 1;
  }
  const rows = [...byId.values()]
    .map((r) => ({ ...r, planned: round(r.planned), spent: round(r.spent), left: round(r.planned - r.spent) }))
    .sort((a, b) => a.sort - b.sort);
  const planned = round(rows.reduce((s, r) => s + r.planned, 0));
  const spent = round(rows.reduce((s, r) => s + r.spent, 0));
  return {
    categories: rows.map((r) => ({
      category: r.category,
      planned: r.planned,
      spent: r.spent,
      left: r.left,
      receipts: r.receipts,
    })),
    totals: { planned, spent, left: round(planned - spent) },
  };
}

const round = (n: number) => Math.round(n * 100) / 100;

// ────────────────────────────────────────────────────────────
// Tools
// ────────────────────────────────────────────────────────────

async function loadCategories(admin: AdminClient): Promise<BudgetCategory[]> {
  const { data } = await admin.from("outreach_budget_categories").select("id, name, slug, sort_order");
  return (data ?? []) as BudgetCategory[];
}

async function outreachBudget(admin: AdminClient, scope: OutreachScope, input: { team?: string; category?: string }) {
  const pick = pickTeam(scope, input.team);
  if (!pick.ok) return pick;
  const team = pick.team;

  const [categories, { data: teamRow }, { data: lines }, { data: expenses }, { data: releases }] =
    await Promise.all([
      loadCategories(admin),
      admin
        .from("outreach_teams")
        .select("team_name, people_count, start_date, end_date, status")
        .eq("id", team.id)
        .single(),
      admin.from("outreach_budget_lines").select("category_id, description, total_zar").eq("team_id", team.id),
      admin.from("outreach_expenses").select("category_id, zar_amount").eq("team_id", team.id),
      admin.from("outreach_fund_releases").select("amount_zar").eq("team_id", team.id),
    ]);

  const summary = summarise(categories, lines ?? [], expenses ?? []);
  const released = round(((releases ?? []) as { amount_zar: number }[]).reduce((s, r) => s + Number(r.amount_zar), 0));
  const cash = {
    released_to_team: released,
    spent: summary.totals.spent,
    unspent_of_released: round(released - summary.totals.spent),
  };
  const base = {
    team: team.team_name,
    people_on_team: teamRow?.people_count ?? null,
    dates: [teamRow?.start_date, teamRow?.end_date].filter(Boolean).join(" to ") || null,
    currency: "ZAR",
  };

  if (input.category) {
    const cat = resolveCategory(input.category, categories);
    const inBudget = summary.categories.map((c) => c.category);
    if (!cat) {
      return {
        ...base,
        needs_clarification: `No budget category matches "${input.category}".`,
        candidates: inBudget,
      };
    }
    const hit = summary.categories.find((c) => c.category === cat.name);
    return {
      ...base,
      asked_for: input.category,
      ...(hit ?? { planned: 0, spent: 0, left: 0, receipts: 0 }),
      category: cat.name,
      not_in_budget: !hit || hit.planned === 0,
      lines: ((lines ?? []) as LineRow[])
        .filter((l) => l.category_id === cat.id)
        .map((l) => ({ description: l.description, total: Number(l.total_zar) })),
      cash,
    };
  }

  return { ...base, ...summary, cash };
}

async function outreachExpenses(
  admin: AdminClient,
  scope: OutreachScope,
  input: { team?: string; category?: string; period?: ExpensePeriod; limit?: number }
) {
  const pick = pickTeam(scope, input.team);
  if (!pick.ok) return pick;
  const team = pick.team;
  const categories = await loadCategories(admin);
  const range = periodRange(input.period);
  const limit = Math.min(Math.max(Number(input.limit) || 10, 1), 25);

  let cat: BudgetCategory | null = null;
  if (input.category) {
    cat = resolveCategory(input.category, categories);
    if (!cat) {
      return {
        team: team.team_name,
        needs_clarification: `No budget category matches "${input.category}".`,
        candidates: categories.map((c) => c.name),
      };
    }
  }

  let q = admin
    .from("outreach_expenses")
    .select("expense_date, vendor, description, category_id, local_currency, local_amount, zar_amount, purchaser")
    .eq("team_id", team.id)
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (cat) q = q.eq("category_id", cat.id);
  if (range.from) q = q.gte("expense_date", range.from);
  if (range.to) q = q.lte("expense_date", range.to);
  const { data } = await q.limit(500);
  const all = (data ?? []) as (ExpenseRow & {
    vendor: string | null;
    description: string | null;
    local_currency: string | null;
    local_amount: number | null;
    purchaser: string | null;
  })[];
  const name = new Map(categories.map((c) => [c.id, c.name]));

  return {
    team: team.team_name,
    period: range.label,
    category: cat?.name ?? "all categories",
    count: all.length,
    total_zar: round(all.reduce((s, e) => s + Number(e.zar_amount), 0)),
    showing: Math.min(limit, all.length),
    expenses: all.slice(0, limit).map((e) => ({
      date: e.expense_date,
      vendor: e.vendor,
      description: e.description,
      category: name.get(e.category_id) ?? "Unknown",
      zar: Number(e.zar_amount),
      local:
        e.local_currency && e.local_currency !== "ZAR" && e.local_amount != null
          ? `${e.local_currency} ${Number(e.local_amount)}`
          : null,
      by: e.purchaser,
    })),
  };
}

export type PlanPeriod = "today" | "tomorrow" | "this_week" | "next_week" | "whole";

export function planRange(period: PlanPeriod | undefined, today: string): { from: string; to: string; label: string } {
  switch (period) {
    case "tomorrow":
      return { from: shiftDate(today, 1), to: shiftDate(today, 1), label: "tomorrow" };
    case "this_week":
      return { from: mondayOf(today), to: shiftDate(mondayOf(today), 6), label: "this week (Mon–Sun)" };
    case "next_week":
      return { from: shiftDate(mondayOf(today), 7), to: shiftDate(mondayOf(today), 13), label: "next week (Mon–Sun)" };
    case "whole":
      return { from: "0000-01-01", to: "9999-12-31", label: "the whole plan" };
    default:
      return { from: today, to: today, label: "today" };
  }
}

/**
 * The team lead's day plans (food / accommodation planner) for a period:
 * what was planned, what's been spent, what's left, plus each category's
 * "still to plan". Defaults to Food and Accommodation.
 */
async function outreachPlan(
  admin: AdminClient,
  scope: OutreachScope,
  input: { team?: string; category?: string; period?: PlanPeriod }
) {
  const pick = pickTeam(scope, input.team);
  if (!pick.ok) return pick;
  const team = pick.team;
  const [{ data: teamRow }, { data: plans }, { data: expenses }, { data: lines }, categories] = await Promise.all([
    admin.from("outreach_teams").select("start_date, end_date").eq("id", team.id).single(),
    admin.from("outreach_day_plans").select("category_id, plan_date, amount_zar, note").eq("team_id", team.id),
    admin.from("outreach_expenses").select("expense_date, zar_amount, category_id").eq("team_id", team.id).range(0, 9999),
    admin.from("outreach_budget_lines").select("category_id, total_zar").eq("team_id", team.id),
    loadCategories(admin),
  ]);

  let cats: BudgetCategory[];
  if (input.category) {
    const c = resolveCategory(input.category, categories);
    if (!c) return { team: team.team_name, needs_clarification: `No category matches "${input.category}".`, candidates: ["Food", "Accommodation"] };
    cats = [c];
  } else {
    cats = categories.filter((c) => ["food", "accommodation"].includes(c.name.toLowerCase()));
  }

  const today = sastDate(new Date());
  const r = planRange(input.period, today);
  type P = { category_id: string; plan_date: string; amount_zar: number; note: string | null };
  type E = { expense_date: string; zar_amount: number; category_id: string };

  const perCategory = cats.map((c) => {
    const days = plannerDays({
      tripStart: teamRow?.start_date ?? null,
      tripEnd: teamRow?.end_date ?? null,
      plans: ((plans ?? []) as P[]).filter((p) => p.category_id === c.id),
      spends: ((expenses ?? []) as E[]).filter((e) => e.category_id === c.id),
    });
    const budget = ((lines ?? []) as { category_id: string; total_zar: number }[])
      .filter((l) => l.category_id === c.id)
      .reduce((s, l) => s + Number(l.total_zar), 0);
    const inRange = days.filter((d) => d.date >= r.from && d.date <= r.to);
    const planned = Math.round(inRange.reduce((s, d) => s + d.planned, 0) * 100) / 100;
    const spent = Math.round(inRange.reduce((s, d) => s + d.spent, 0) * 100) / 100;
    const pt = pot({ budget, days, today });
    return {
      category: c.name,
      planned,
      spent,
      left_to_spend: Math.round((planned - spent) * 100) / 100,
      notes: inRange.filter((d) => d.note).map((d) => ({ date: d.date, note: d.note, planned: d.planned })),
      nothing_planned: planned === 0,
      available_in_category: pt.available,
      still_to_plan: pt.stillToPlan,
    };
  });

  return {
    team: team.team_name,
    period: r.label,
    dates: input.period === "whole" ? null : r.from === r.to ? r.from : `${r.from} to ${r.to}`,
    categories: perCategory,
  };
}

export async function executeOutreachTool(
  admin: AdminClient,
  scope: OutreachScope,
  name: string,
  input: Record<string, unknown>
): Promise<unknown> {
  try {
    switch (name) {
      case "outreach_budget":
        return await outreachBudget(admin, scope, input as { team?: string; category?: string });
      case "outreach_plan":
        return await outreachPlan(admin, scope, input as { team?: string; category?: string; period?: PlanPeriod });
      case "outreach_expenses":
        return await outreachExpenses(
          admin,
          scope,
          input as { team?: string; category?: string; period?: ExpensePeriod; limit?: number }
        );
      default:
        return null; // not an outreach tool
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export const OUTREACH_TOOL_NAMES = new Set(["outreach_budget", "outreach_expenses", "outreach_plan"]);

const TEAM_PARAM = {
  type: "string" as const,
  description:
    "Team name, only if the user names one (e.g. 'Botswana'). Omit to use the team this conversation is about.",
};

export const OUTREACH_TOOLS: Anthropic.Tool[] = [
  {
    name: "outreach_budget",
    description:
      "An outreach team's budget: for each category what was planned, what has been spent and what is left, plus overall totals and cash released to the team. Pass `category` for one category — casual words are fine ('gas' → Transport, 'groceries' → Food).",
    input_schema: {
      type: "object",
      properties: {
        team: TEAM_PARAM,
        category: {
          type: "string",
          description: "The category the user asked about, in their words. Omit for the whole budget.",
        },
      },
    },
  },
  {
    name: "outreach_plan",
    description:
      "The team lead's daily plan for Food and Accommodation (or one category): how much they planned for today / tomorrow / this week / next week, how much has been spent, what's left to spend, their notes for those days, and how much of the category is still unplanned. Use for 'how much can we spend on food today?' or 'what's our food budget this week?'.",
    input_schema: {
      type: "object",
      properties: {
        team: TEAM_PARAM,
        category: { type: "string", description: "One category in the user's words, e.g. 'food'. Omit for Food and Accommodation." },
        period: {
          type: "string",
          enum: ["today", "tomorrow", "this_week", "next_week", "whole"],
          description: "Which period. Defaults to today.",
        },
      },
    },
  },
  {
    name: "outreach_expenses",
    description:
      "Expenses (receipts) an outreach team has logged, newest first, with the total. Filter by category and/or period.",
    input_schema: {
      type: "object",
      properties: {
        team: TEAM_PARAM,
        category: { type: "string", description: "Category in the user's words. Omit for all." },
        period: {
          type: "string",
          enum: ["today", "yesterday", "this_week", "all"],
          description: "Time window. Omit or 'all' for the whole outreach.",
        },
        limit: { type: "number", description: "How many to list (default 10, max 25)." },
      },
    },
  },
];
