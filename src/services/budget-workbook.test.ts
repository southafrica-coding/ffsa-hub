import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { lineTotalCents } from "@/lib/finance/budget-workbook";
import { createBudgetWorkbook, getBudgetWorkbook, listBudgetWorkbooks, saveBudgetWorkbook } from "./budget-workbook";

const NPC = "11111111-1111-4111-8111-111111111111";
const USA = "22222222-2222-4222-8222-222222222222";
const OWNER = "33333333-3333-4333-8333-333333333333";
const PERIOD = "66666666-6666-4666-8666-666666666666";
const LINE = "44444444-4444-4444-8444-444444444444";
const EXPENSE = "55555555-5555-4555-8555-555555555555";

type Row = Record<string, unknown>;
type Write = { table: string; op: string; payload: unknown };

function memory(options?: {
  missing?: string[];
  hide?: string[];
  denyInsert?: string[];
  denyUpdate?: string[];
  denyArchive?: string[];
  loseRace?: string[];
  rpcError?: { code: string; message: string };
  inactiveOrg?: boolean;
}) {
  const tables: Record<string, Row[]> = {
    finance_orgs: [
      { id: NPC, key: "npc", name: "FFSA NPC", record_currency: "ZAR", is_active: true },
      { id: USA, key: "usa", name: "FF USA Inc", record_currency: "USD", is_active: true },
    ],
    fiscal_periods: [
      {
        id: PERIOD,
        org_id: NPC,
        kind: "year",
        label: "2027",
        start_date: "2027-01-01",
        end_date: "2027-12-31",
        archived_at: null,
      },
    ],
    budget_templates: [{ id: "tpl-standard", key: "team_standard", is_active: true, archived_at: null }],
    budgets: [],
    budget_sections: [],
    budget_lines: [],
    budget_expenses: [],
    budget_workbook_revisions: [],
  };
  const missing = new Set(options?.missing ?? []);
  const hide = new Set(options?.hide ?? []);
  const denyInsert = new Set(options?.denyInsert ?? []);
  const denyUpdate = new Set(options?.denyUpdate ?? []);
  const denyArchive = new Set(options?.denyArchive ?? []);
  const loseRace = new Set(options?.loseRace ?? []);
  const writes: Write[] = [];
  let clock = Date.parse("2026-11-06T00:00:00.000Z");
  const stamp = () => {
    clock += 1000;
    return new Date(clock).toISOString();
  };

  function applyLine(row: Row) {
    const budget = tables.budgets.find((item) => item.id === row.budget_id);
    if (row.uses_driver) row.multiplier = budget?.driver_value ?? 0;
    if (row.kind === "fixed") row.frequency = 1;
    row.line_total_cents = lineTotalCents({
      amount_cents: Number(row.amount_cents),
      frequency: Number(row.frequency),
      multiplier: Number(row.multiplier),
    });
    row.coding_status = "needs_coding";
    row.archived_at = row.archived_at ?? null;
  }

  function recomputeDriver(budgetId: string) {
    const budget = tables.budgets.find((item) => item.id === budgetId);
    for (const line of tables.budget_lines) {
      if (line.budget_id !== budgetId || line.archived_at || !line.uses_driver) continue;
      line.multiplier = budget?.driver_value ?? 0;
      line.line_total_cents = lineTotalCents({
        amount_cents: Number(line.amount_cents),
        frequency: Number(line.frequency),
        multiplier: Number(line.multiplier),
      });
    }
  }

  function rows(table: string, filters: { op: string; col: string; val: unknown }[], order: string | null, limit: number | null) {
    let list = tables[table].filter((row) =>
      filters.every((filter) => {
        const value = row[filter.col] ?? null;
        if (filter.op === "eq") return value === filter.val;
        if (filter.op === "is") return value === (filter.val ?? null);
        if (filter.op === "in") return (filter.val as unknown[]).includes(value);
        return true;
      })
    );
    if (order) list = [...list].sort((a, b) => String(a[order] ?? "").localeCompare(String(b[order] ?? "")));
    if (limit !== null) list = list.slice(0, limit);
    return list;
  }

  function query(table: string) {
    const state = {
      op: "select" as "select" | "insert" | "update",
      payload: null as Row | null,
      filters: [] as { op: string; col: string; val: unknown }[],
      order: null as string | null,
      limit: null as number | null,
    };
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    builder.select = chain;
    builder.eq = (col: string, val: unknown) => {
      state.filters.push({ op: "eq", col, val });
      return builder;
    };
    builder.is = (col: string, val: unknown) => {
      state.filters.push({ op: "is", col, val });
      return builder;
    };
    builder.in = (col: string, val: unknown) => {
      state.filters.push({ op: "in", col, val });
      return builder;
    };
    builder.order = (col: string) => {
      state.order = col;
      return builder;
    };
    builder.limit = (n: number) => {
      state.limit = n;
      return builder;
    };
    builder.insert = (payload: Row) => {
      state.op = "insert";
      state.payload = payload;
      return builder;
    };
    builder.update = (payload: Row) => {
      state.op = "update";
      state.payload = payload;
      return builder;
    };
    const finish = (one: boolean) => {
      if (missing.has(table) || tables[table] === undefined) {
        return {
          data: null,
          error: { code: "PGRST205", message: `Could not find the table 'public.${table}' in the schema cache` },
        };
      }
      if (hide.has(table) && state.op === "select") return { data: one ? null : [], error: null };
      if (state.op === "insert" && denyInsert.has(table)) {
        writes.push({ table, op: "insert", payload: state.payload });
        return { data: null, error: { code: "42501", message: `new row violates row-level security policy for table "${table}"` } };
      }
      if (state.op === "insert" && state.payload) {
        writes.push({ table, op: "insert", payload: structuredClone(state.payload) });
        const stored: Row = { ...state.payload, id: state.payload.id ?? randomUUID(), updated_at: stamp() };
        if (table === "budget_lines") applyLine(stored);
        if (table === "budget_expenses") stored.archived_at = null;
        tables[table].push(stored);
        return { data: one ? stored : [stored], error: null };
      }
      if (state.op === "update" && state.payload && loseRace.has(table)) {
        const matched = rows(table, state.filters, null, null);
        writes.push({ table, op: "update", payload: structuredClone(state.payload) });
        for (const row of matched) row.updated_at = stamp();
        return { data: one ? null : [], error: null };
      }
      if (state.op === "update" && state.payload && denyUpdate.has(table)) {
        writes.push({ table, op: "update", payload: structuredClone(state.payload) });
        return { data: one ? null : [], error: null };
      }
      if (state.op === "update" && state.payload && denyArchive.has(table) && "archived_at" in state.payload) {
        writes.push({ table, op: "update", payload: structuredClone(state.payload) });
        return { data: one ? null : [], error: null };
      }
      if (state.op === "update" && state.payload) {
        writes.push({ table, op: "update", payload: structuredClone(state.payload) });
        const matched = rows(table, state.filters, null, null);
        for (const row of matched) Object.assign(row, state.payload, { updated_at: stamp() });
        if (table === "budgets" && "driver_value" in state.payload) {
          for (const row of matched) recomputeDriver(String(row.id));
        }
        if (table === "budget_lines") {
          for (const row of matched) {
            if ("amount_cents" in state.payload || "uses_driver" in state.payload || "multiplier" in state.payload) applyLine(row);
          }
        }
        return { data: one ? matched[0] ?? null : matched, error: null };
      }
      const list = rows(table, state.filters, state.order, state.limit);
      if (one) return { data: list[0] ?? null, error: list.length > 1 ? { code: "PGRST116", message: "multiple rows" } : null };
      return { data: list, error: null };
    };
    builder.maybeSingle = async () => finish(true);
    builder.single = async () => finish(true);
    builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(finish(false)).then(resolve, reject);
    return builder;
  }

  function restore(snap: Record<string, Row[]>) {
    for (const key of Object.keys(tables)) tables[key] = snap[key];
  }

  function insertTemplate(args: Record<string, unknown>) {
    if (denyInsert.has("budgets")) {
      return { data: null, error: { code: "42501", message: 'new row violates row-level security policy for table "budgets"' } };
    }
    const period = tables.fiscal_periods.find((row) => row.id === args.p_period_id && !row.archived_at);
    if (!period) return { data: null, error: { code: "22023", message: "Period not found or archived" } };
    if (args.p_org_id && args.p_org_id !== period.org_id) {
      return { data: null, error: { code: "23514", message: "Budget org comes from the fiscal period" } };
    }
    const org = tables.finance_orgs.find((row) => row.id === period.org_id);
    if (!org || org.key !== "npc" || org.record_currency !== "ZAR" || args.p_currency === "USD") {
      return { data: null, error: { code: "23514", message: "Hub budgets are for South Africa only" } };
    }
    const ownerColumn =
      args.p_owner_kind === "staff_ministry"
        ? "staff_ministry_id"
        : args.p_owner_kind === "ministry_subcategory"
          ? "subcategory_id"
          : args.p_owner_kind === "program"
            ? "program_id"
            : args.p_owner_kind === "event"
              ? "event_id"
              : "outreach_team_id";
    const duplicate = tables.budgets.find(
      (row) =>
        !row.archived_at &&
        row.org_id === period.org_id &&
        row.owner_kind === args.p_owner_kind &&
        row[ownerColumn] === args.p_owner_id &&
        row.period_id === period.id &&
        String(row.name).toLowerCase() === String(args.p_name).trim().toLowerCase()
    );
    if (duplicate) return { data: null, error: { code: "23505", message: "duplicate key" } };
    const id = randomUUID();
    tables.budgets.push({
      id,
      name: args.p_name,
      status: "draft",
      org_id: period.org_id,
      currency: "ZAR",
      owner_kind: args.p_owner_kind,
      staff_ministry_id: null,
      subcategory_id: null,
      program_id: null,
      event_id: null,
      outreach_team_id: null,
      [ownerColumn]: args.p_owner_id,
      period_id: period.id,
      driver_label: args.p_driver_label ?? null,
      driver_value: args.p_driver_value ?? null,
      funding_goal_cents: null,
      funds_in_hand_cents: null,
      income_goal_cents: null,
      fundraising_goal_cents: null,
      notes: null,
      archived_at: null,
      updated_at: stamp(),
    });
    const sections = [
      ["overview", "Overview", 10],
      ["dashboard", "Dashboard", 20],
      ["variable", "Variable cost", 30],
      ["fixed", "Fixed cost", 40],
      ["expense_tracker", "Expense tracker", 50],
      ["notes", "Notes", 60],
    ];
    for (const [key, label, sort] of sections) {
      tables.budget_sections.push({ id: randomUUID(), budget_id: id, key, label, sort });
    }
    tables.budget_workbook_revisions.push({ budget_id: id, revision: stamp() });
    return { data: id, error: null };
  }

  function bumpRevision(budgetId: string) {
    const row = tables.budget_workbook_revisions.find((item) => item.budget_id === budgetId);
    const revision = stamp();
    if (row) row.revision = revision;
    else tables.budget_workbook_revisions.push({ budget_id: budgetId, revision });
  }

  function revisionOf(budgetId: string): string | null {
    const budget = tables.budgets.find((row) => row.id === budgetId && !row.archived_at);
    if (!budget || typeof budget.updated_at !== "string") return null;
    const stamps = [budget.updated_at as string];
    for (const line of tables.budget_lines) {
      if (line.budget_id === budgetId && !line.archived_at && typeof line.updated_at === "string") stamps.push(line.updated_at);
    }
    for (const expense of tables.budget_expenses) {
      if (expense.budget_id === budgetId && !expense.archived_at && typeof expense.updated_at === "string") stamps.push(expense.updated_at);
    }
    return stamps.reduce((latest, stamp) => (Date.parse(stamp) >= Date.parse(latest) ? stamp : latest));
  }

  function applySheet(
    budgetId: string,
    header: unknown,
    lines: unknown,
    expenses: unknown,
    expected: unknown,
    checkRevision: boolean
  ): { revision?: string | null; error: { code: string; message: string } | null } {
    const budget = tables.budgets.find((row) => row.id === budgetId && !row.archived_at);
    if (!budget) return { error: { code: "P0002", message: "Budget not found" } };
    const tokenRow = tables.budget_workbook_revisions.find((row) => row.budget_id === budgetId);
    const token = typeof tokenRow?.revision === "string" ? tokenRow.revision : null;
    if (checkRevision) {
      const expectedMs = typeof expected === "string" ? Date.parse(expected) : NaN;
      const tokenMs = token ? Date.parse(token) : NaN;
      if (!token || expectedMs !== tokenMs) return { error: { code: "40001", message: "workbook revision conflict" } };
    }
    const writesAtStart = writes.length;
    const lineRows = Array.isArray(lines) ? (lines as Row[]) : null;
    const expenseRows = Array.isArray(expenses) ? (expenses as Row[]) : null;
    if (loseRace.has("budget_lines") && lineRows) {
      const live = tables.budget_lines.filter((row) => row.budget_id === budgetId && !row.archived_at);
      const changes = lineRows.some((line) => {
        const current = live.find((row) => row.id === line.id);
        if (!current) return true;
        return Number(current.amount_cents) !== Number(line.amount_cents) || current.name !== line.name || (current.notes ?? null) !== (line.notes ?? null);
      });
      const archives = live.some((row) => {
        if (lineRows.some((line) => line.id === row.id)) return false;
        if (!expenseRows && tables.budget_expenses.some((expense) => expense.budget_id === budgetId && expense.line_id === row.id && !expense.archived_at)) {
          return false;
        }
        return true;
      });
      if (changes || archives) return { error: { code: "40001", message: "workbook revision conflict" } };
    }
    if (header && typeof header === "object") {
      const patch = header as Row;
      const differs = Object.keys(patch).some((key) => (budget[key] ?? null) !== (patch[key] ?? null));
      if (differs) {
        if (denyUpdate.has("budgets")) return { error: { code: "42501", message: "row-level security" } };
        writes.push({ table: "budgets", op: "update", payload: structuredClone(patch) });
        Object.assign(budget, patch, { updated_at: stamp() });
        if ("driver_value" in patch) recomputeDriver(budgetId);
      }
    }
    const kept = new Set<string>();
    if (lineRows) {
      for (const line of lineRows) {
        const section = tables.budget_sections.find((row) => row.budget_id === budgetId && row.key === line.kind);
        const payload = {
          section_id: section?.id,
          kind: line.kind,
          name: line.name,
          amount_cents: line.amount_cents,
          frequency: line.kind === "fixed" ? 1 : line.frequency,
          multiplier: line.multiplier,
          uses_driver: line.uses_driver === true,
          sort: line.sort ?? 0,
          notes: line.notes ?? null,
        };
        const current = line.id
          ? tables.budget_lines.find((row) => row.id === line.id && row.budget_id === budgetId && !row.archived_at)
          : undefined;
        if (current) {
          kept.add(String(current.id));
          const unchanged =
            current.section_id === payload.section_id &&
            current.kind === payload.kind &&
            current.name === payload.name &&
            Number(current.amount_cents) === Number(payload.amount_cents) &&
            Number(current.frequency) === Number(payload.frequency) &&
            Number(current.multiplier) === Number(payload.multiplier) &&
            current.uses_driver === payload.uses_driver &&
            (current.sort ?? 0) === payload.sort &&
            (current.notes ?? null) === payload.notes;
          if (unchanged) continue;
          if (denyUpdate.has("budget_lines")) return { error: { code: "42501", message: "row-level security" } };
          writes.push({ table: "budget_lines", op: "update", payload });
          Object.assign(current, payload, { updated_at: stamp() });
          applyLine(current);
        } else {
          if (denyInsert.has("budget_lines")) {
            return { error: { code: "42501", message: 'new row violates row-level security policy for table "budget_lines"' } };
          }
          const id = (typeof line.id === "string" && line.id) || randomUUID();
          const stored: Row = { ...payload, id, budget_id: budgetId, updated_at: stamp(), archived_at: null };
          writes.push({ table: "budget_lines", op: "insert", payload: { ...payload, id, budget_id: budgetId } });
          applyLine(stored);
          tables.budget_lines.push(stored);
          kept.add(id);
        }
      }
    }
    const keptExpenses = new Set<string>();
    if (expenseRows) {
      for (const expense of expenseRows) {
        if (expense.line_id && lineRows && !kept.has(String(expense.line_id))) {
          return { error: { code: "23514", message: "Expense must reference a live line of this budget" } };
        }
        const payload = {
          line_id: expense.line_id ?? null,
          expense_date: expense.expense_date,
          vendor: expense.vendor ?? null,
          description: expense.description,
          amount_cents: expense.amount_cents,
          reference: expense.reference ?? null,
          notes: expense.notes ?? null,
        };
        const current = expense.id
          ? tables.budget_expenses.find((row) => row.id === expense.id && row.budget_id === budgetId && !row.archived_at)
          : undefined;
        if (current) {
          keptExpenses.add(String(current.id));
          const unchanged =
            (current.line_id ?? null) === payload.line_id &&
            current.expense_date === payload.expense_date &&
            (current.vendor ?? null) === payload.vendor &&
            current.description === payload.description &&
            Number(current.amount_cents) === Number(payload.amount_cents) &&
            (current.reference ?? null) === payload.reference &&
            (current.notes ?? null) === payload.notes;
          if (unchanged) continue;
          if (denyUpdate.has("budget_expenses")) return { error: { code: "42501", message: "row-level security" } };
          writes.push({ table: "budget_expenses", op: "update", payload });
          Object.assign(current, payload, { updated_at: stamp() });
        } else {
          if (denyInsert.has("budget_expenses")) return { error: { code: "42501", message: "row-level security" } };
          const id = (typeof expense.id === "string" && expense.id) || randomUUID();
          writes.push({ table: "budget_expenses", op: "insert", payload: { ...payload, id, budget_id: budgetId } });
          tables.budget_expenses.push({ ...payload, id, budget_id: budgetId, archived_at: null, updated_at: stamp() });
          keptExpenses.add(id);
        }
      }
      for (const expense of tables.budget_expenses) {
        if (expense.budget_id !== budgetId || expense.archived_at || keptExpenses.has(String(expense.id))) continue;
        if (denyArchive.has("budget_expenses")) return { error: { code: "42501", message: "row-level security" } };
        expense.archived_at = stamp();
        expense.updated_at = stamp();
      }
    }
    if (lineRows) {
      const protect = new Set<string>();
      if (!expenseRows) {
        for (const expense of tables.budget_expenses) {
          if (expense.budget_id === budgetId && !expense.archived_at && expense.line_id) protect.add(String(expense.line_id));
        }
      }
      for (const line of tables.budget_lines) {
        if (line.budget_id !== budgetId || line.archived_at || kept.has(String(line.id)) || protect.has(String(line.id))) continue;
        if (tables.budget_expenses.some((expense) => expense.budget_id === budgetId && expense.line_id === line.id && !expense.archived_at)) {
          return { error: { code: "23514", message: "A line with a live expense cannot be archived" } };
        }
        if (denyArchive.has("budget_lines")) return { error: { code: "42501", message: "row-level security" } };
        writes.push({ table: "budget_lines", op: "update", payload: { archived_at: true } });
        line.archived_at = stamp();
        line.updated_at = stamp();
      }
    }
    if (writes.length !== writesAtStart) bumpRevision(budgetId);
    const next = tables.budget_workbook_revisions.find((row) => row.budget_id === budgetId);
    return { revision: typeof next?.revision === "string" ? next.revision : null, error: null };
  }

  const client = {
    from: (table: string) => query(table),
    async rpc(name: string, args: Record<string, unknown>) {
      writes.push({ table: "rpc", op: name, payload: structuredClone(args) });
      if (options?.rpcError) return { data: null, error: options.rpcError };
      if (name === "budget_workbook_org_ok") {
        if (flags.inactiveOrg) return { data: false, error: null };
        const visible = tables.budgets.some((row) => row.id === args.p_budget_id && !row.archived_at);
        return { data: visible ? true : null, error: null };
      }
      if (name === "create_budget_workbook_sheet") {
        const snap = structuredClone(tables);
        const created = insertTemplate(args);
        if (created.error) return created;
        const applied = applySheet(String(created.data), args.p_header ?? null, args.p_lines ?? null, args.p_expenses ?? null, null, false);
        if (applied.error) {
          restore(snap);
          return { data: null, error: applied.error };
        }
        return created;
      }
      if (name === "apply_budget_workbook") {
        const snap = structuredClone(tables);
        const applied = applySheet(String(args.p_budget_id), args.p_header ?? null, args.p_lines ?? null, args.p_expenses ?? null, args.p_expected_updated_at, true);
        if (applied.error) {
          restore(snap);
          return { data: null, error: applied.error };
        }
        return { data: applied.revision, error: null };
      }
      return { data: null, error: { code: "PGRST202", message: `Could not find the function public.${name} in the schema cache` } };
    },
  };

  const flags = { inactiveOrg: options?.inactiveOrg === true };
  return { client, tables, writes, denyInsert, denyUpdate, denyArchive, loseRace, flags };
}

const period = {
  periodKind: "year",
  periodLabel: "2027",
  periodStart: "2027-01-01",
  periodEnd: "2027-12-31",
};

function sheet(extra: Record<string, unknown> = {}) {
  return {
    name: "DTS 2027",
    ownerKind: "program",
    ownerId: OWNER,
    periodId: PERIOD,
    ...period,
    ...extra,
  };
}

describe("budget workbook save and load", () => {
  let db: ReturnType<typeof memory>;

  beforeEach(() => {
    db = memory();
  });

  it("returns schema_not_applied when the workbook tables are missing", async () => {
    db = memory({ missing: ["budgets"] });
    const result = await createBudgetWorkbook(db.client, sheet());
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ code: "schema_not_applied" });
    expect(JSON.stringify(result.body)).not.toMatch(/Hub Data/i);
    expect(db.writes).toEqual([]);
  });

  it("creates a South Africa workbook from the standard template and reloads it", async () => {
    const result = await createBudgetWorkbook(
      db.client,
      sheet({
        ownerKind: "outreach_team",
        purpose: "Food for the team",
        notes: "Bring receipts.",
        driverLabel: "Volunteers",
        driverValue: 8,
        fundingGoal: "10000",
        fundsInHandCents: 250000,
        lines: [
          { id: LINE, kind: "variable", name: "Food", amount: "190", frequency: "12", multiplier: "1", usesDriver: true, notes: "per person" },
          { kind: "fixed", name: "Van", amountCents: 240050, frequency: 4, multiplier: 1 },
        ],
        expenses: [{ id: EXPENSE, date: "2027-02-01", what: "Groceries", amount: "45.50", lineId: LINE, proof: "slip-1", checked: true }],
      })
    );
    expect(result.status).toBe(201);
    const rpc = db.writes.find((write) => write.op === "create_budget_workbook_sheet");
    expect(rpc?.payload).toMatchObject({
      p_template_id: "tpl-standard",
      p_owner_kind: "outreach_team",
      p_owner_id: OWNER,
      p_period_id: PERIOD,
      p_org_id: NPC,
      p_name: "DTS 2027",
      p_currency: null,
      p_driver_label: "Volunteers",
      p_driver_value: 8,
    });
    const lineInserts = db.writes.filter((write) => write.table === "budget_lines" && write.op === "insert");
    expect(lineInserts).toHaveLength(2);
    expect(lineInserts[0].payload).toMatchObject({
      id: LINE,
      kind: "variable",
      amount_cents: 19000,
      frequency: 12,
      multiplier: 8,
      uses_driver: true,
      notes: "per person",
    });
    expect(lineInserts[0].payload).not.toHaveProperty("line_total_cents");
    expect(lineInserts[0].payload).not.toHaveProperty("coding_status");
    expect(lineInserts[0].payload).not.toHaveProperty("category_id");
    expect(lineInserts[1].payload).toMatchObject({ kind: "fixed", frequency: 1, amount_cents: 240050 });
    const expense = db.writes.find((write) => write.table === "budget_expenses");
    expect(expense?.payload).toMatchObject({
      id: EXPENSE,
      line_id: LINE,
      description: "Groceries",
      amount_cents: 4550,
      reference: "slip-1",
    });
    expect(db.writes.some((write) => write.table === "budget_xero_spends" || write.table === "budget_line_coding")).toBe(false);
    expect(JSON.stringify(db.writes)).not.toContain("purpose");

    const budget = result.body.budget as {
      currency: string;
      orgId: string;
      ownerKind: string;
      notes: string;
      fundingGoalCents: number;
      lines: { name: string; lineTotalCents: number; codingStatus: string; usesDriver: boolean }[];
      expenses: { reference: string; amountCents: number }[];
      sections: { key: string }[];
    };
    expect(budget.currency).toBe("ZAR");
    expect(budget.orgId).toBe(NPC);
    expect(budget.ownerKind).toBe("outreach_team");
    expect(budget.notes).toBe("Bring receipts.");
    expect(budget.fundingGoalCents).toBe(1_000_000);
    expect(budget.lines.find((line) => line.name === "Food")).toMatchObject({
      lineTotalCents: 1_824_000,
      usesDriver: true,
      codingStatus: "needs_coding",
    });
    expect(budget.expenses[0]).toMatchObject({ reference: "slip-1", amountCents: 4550 });
    expect(budget.sections.map((section) => section.key)).toEqual([
      "overview",
      "dashboard",
      "variable",
      "fixed",
      "expense_tracker",
      "notes",
    ]);
    expect(result.body.ignored).toEqual(expect.arrayContaining(["purpose", "fixedFrequency", "checked"]));

    const loaded = await getBudgetWorkbook(db.client, budgetId(result));
    expect(loaded.status).toBe(200);
    expect(loaded.body.budget).toMatchObject({ id: budgetId(result), notes: "Bring receipts." });
  });

  it("does not create a budget when an expense names a line that is not on the sheet", async () => {
    const result = await createBudgetWorkbook(db.client, sheet({
      expenses: [{ date: "2027-02-01", description: "Groceries", amountCents: 100, lineId: LINE }],
    }));
    expect(result.status).toBe(400);
    expect(db.tables.budgets).toHaveLength(0);
  });

  it("does not create a US workbook", async () => {
    const usd = await createBudgetWorkbook(db.client, sheet({ currency: "USD" }));
    expect(usd.status).toBe(400);
    expect(usd.body.error).toMatch(/rand/);
    const usa = await createBudgetWorkbook(db.client, sheet({ orgId: USA }));
    expect(usa.status).toBe(400);
    expect(db.writes.some((write) => write.op === "create_budget_workbook_sheet" || write.table === "fiscal_periods")).toBe(false);
  });

  it("rejects a US period instead of moving it onto South Africa", async () => {
    const usPeriod = "99999999-9999-4999-8999-999999999999";
    db.tables.fiscal_periods.push({
      id: usPeriod,
      org_id: USA,
      kind: "year",
      label: "2027",
      start_date: "2027-01-01",
      end_date: "2027-12-31",
      archived_at: null,
    });
    const rewritten = await createBudgetWorkbook(db.client, sheet({ periodId: usPeriod, orgId: NPC }));
    expect(rewritten.status).toBe(400);
    expect(rewritten.body.error).toBe("The organisation comes from the period.");
    const result = await createBudgetWorkbook(db.client, sheet({ periodId: usPeriod }));
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/South Africa/);
    expect(db.tables.budgets).toHaveLength(0);
    expect(db.tables.fiscal_periods.find((row) => row.id === usPeriod)?.org_id).toBe(USA);
  });

  it("rejects a passed org id that is not the period's org", async () => {
    const result = await createBudgetWorkbook(db.client, sheet({ periodId: PERIOD, orgId: USA }));
    expect(result.status).toBe(400);
    expect(result.body.error).toBe("The organisation comes from the period.");
    expect(db.tables.budgets).toHaveLength(0);
    expect(db.writes.some((write) => write.op === "create_budget_workbook_sheet")).toBe(false);
  });

  it("stores the period's org and does not write a client currency", async () => {
    const result = await createBudgetWorkbook(db.client, sheet({ periodId: PERIOD, orgId: NPC, currency: "ZAR" }));
    expect(result.status).toBe(201);
    const rpc = db.writes.find((write) => write.op === "create_budget_workbook_sheet");
    expect(rpc?.payload).toMatchObject({ p_org_id: NPC, p_period_id: PERIOD, p_currency: null });
    expect((result.body.budget as { orgId: string; currency: string }).currency).toBe("ZAR");
  });

  it("does not invent a fiscal period when only a typed period is sent", async () => {
    const body: Record<string, unknown> = sheet({ periodLabel: "Term 1", periodKind: "term", periodStart: "2027-01-15", periodEnd: "2027-03-31" });
    delete body.periodId;
    const created = await createBudgetWorkbook(db.client, body);
    expect(created.status).toBe(400);
    expect(created.body.error).toBe("Choose a period that already exists.");
    expect(db.writes.some((write) => write.table === "fiscal_periods" || write.op === "create_budget_workbook_sheet")).toBe(false);
  });

  it("refuses a typed period that does not match the chosen period id", async () => {
    const result = await createBudgetWorkbook(db.client, sheet({ periodEnd: "2027-06-30" }));
    expect(result.status).toBe(400);
    expect(db.writes.some((write) => write.op === "create_budget_workbook_sheet" || write.table === "fiscal_periods")).toBe(false);
  });

  it("does not pass a short unknown database message through as a 500", async () => {
    db = memory({ rpcError: { code: "XX000", message: "boom" } });
    const result = await createBudgetWorkbook(db.client, sheet());
    expect(result.status).toBe(500);
    expect(result.body.error).toBe("The budget couldn't be saved.");
    expect(result.body.error).not.toBe("boom");
  });

  it("turns a short database period error into a 400 without the raw text", async () => {
    db = memory({ rpcError: { code: "22023", message: "Period not found or archived" } });
    const result = await createBudgetWorkbook(db.client, sheet());
    expect(result.status).toBe(400);
    expect(result.body.error).toBe("That period isn't available.");
    expect(result.body.error).not.toBe("Period not found or archived");
  });

  it("leaves outreach creation to the database permission", async () => {
    db = memory({ denyInsert: ["budgets"] });
    const result = await createBudgetWorkbook(db.client, sheet({ ownerKind: "outreach_team" }));
    expect(result.status).toBe(403);
    expect(result.body.error).toMatch(/owner/);
    expect(db.tables.budgets).toHaveLength(0);
  });

  it("creates a workbook when the signed-in user cannot see finance_orgs", async () => {
    db = memory({ hide: ["finance_orgs"] });
    const result = await createBudgetWorkbook(db.client, sheet({ periodId: PERIOD }));
    expect(result.status).toBe(201);
    expect((result.body.budget as { orgId: string }).orgId).toBe(NPC);
    expect(db.writes.some((write) => write.table === "finance_orgs")).toBe(false);
  });

  it("saves amounts and notes, archives a removed line, and keeps the owner", async () => {
    const created = await createBudgetWorkbook(
      db.client,
      sheet({
        lines: [
          { id: LINE, kind: "variable", name: "Food", amountCents: 19000, frequency: 12, multiplier: 8 },
          { id: "77777777-7777-4777-8777-777777777777", kind: "fixed", name: "Van", amountCents: 100, multiplier: 1 },
        ],
      })
    );
    const id = budgetId(created);
    db.writes.length = 0;
    const saved = await saveBudgetWorkbook(db.client, id, {
      name: "DTS 2027",
      ownerKind: "program",
      ownerId: OWNER,
      ...period,
      updatedAt: updatedAtOf(created),
      notes: "Updated",
      lines: [{ id: LINE, kind: "variable", name: "Food", amountCents: 20000, frequency: 12, multiplier: 8, notes: "lunch" }],
      expenses: [{ date: "2027-03-01", description: "Bread", amountCents: -500 }],
    });
    expect(saved.status).toBe(200);
    const budget = saved.body.budget as {
      notes: string;
      ownerId: string;
      lines: { id: string; amountCents: number; lineTotalCents: number; notes: string }[];
      expenses: { amountCents: number; description: string; lineId: string | null }[];
    };
    expect(budget.notes).toBe("Updated");
    expect(budget.ownerId).toBe(OWNER);
    expect(budget.lines).toHaveLength(1);
    expect(budget.lines[0]).toMatchObject({ id: LINE, amountCents: 20000, lineTotalCents: 1_920_000, notes: "lunch" });
    expect(budget.expenses[0]).toMatchObject({ amountCents: -500, description: "Bread", lineId: null });
    expect(db.tables.budget_lines.filter((line) => line.archived_at).map((line) => line.name)).toEqual(["Van"]);
    expect(db.writes.some((write) => write.table === "budget_xero_spends" || write.table === "budget_line_coding")).toBe(false);
  });

  it("does not save when the organisation is no longer the active South Africa one", async () => {
    const created = await createBudgetWorkbook(db.client, sheet());
    db.flags.inactiveOrg = true;
    const saved = await saveBudgetWorkbook(db.client, budgetId(created), {
      updatedAt: updatedAtOf(created),
      notes: "Should not stick",
    });
    expect(saved.status).toBe(409);
    expect(saved.body.error).toBe("This budget is not on the active South Africa organisation.");
    expect(db.writes.some((write) => write.op === "apply_budget_workbook")).toBe(false);
  });

  it("does not change the owner or the period on save", async () => {
    const created = await createBudgetWorkbook(db.client, sheet());
    const saved = await saveBudgetWorkbook(db.client, budgetId(created), {
      ownerKind: "event",
      ownerId: "88888888-8888-4888-8888-888888888888",
    });
    expect(saved.status).toBe(400);
    expect(saved.body.error).toMatch(/owner and period/);
  });

  it("saves tracker rows on a submitted budget without rewriting unchanged lines", async () => {
    const created = await createBudgetWorkbook(db.client, sheet({
      lines: [{ id: LINE, kind: "fixed", name: "Van", amountCents: 100, multiplier: 1 }],
      expenses: [{ id: EXPENSE, date: "2027-02-01", description: "Fuel", amountCents: 500, lineId: LINE }],
    }));
    expect(created.status).toBe(201);
    db.tables.budgets[0].status = "submitted";
    db.denyUpdate.add("budget_lines");
    db.writes.length = 0;
    const saved = await saveBudgetWorkbook(db.client, budgetId(created), {
      updatedAt: updatedAtOf(created),
      lines: [{ id: LINE, kind: "fixed", name: "Van", amountCents: 100, multiplier: 1 }],
      expenses: [
        { id: EXPENSE, date: "2027-02-01", description: "Fuel", amountCents: 500, lineId: LINE },
        { date: "2027-03-01", description: "Bread", amountCents: 200 },
      ],
    });
    expect(saved.status).toBe(200);
    expect(db.writes.filter((write) => write.table === "budget_lines")).toEqual([]);
    expect(db.writes.some((write) => write.table === "budget_expenses" && write.op === "insert")).toBe(true);
    db.tables.budgets[0].status = "approved";
    const again = await saveBudgetWorkbook(db.client, budgetId(created), {
      updatedAt: updatedAtOf(saved),
      lines: [{ id: LINE, kind: "fixed", name: "Van", amountCents: 100, multiplier: 1 }],
      expenses: [
        { id: EXPENSE, date: "2027-02-01", description: "Fuel", amountCents: 500, lineId: LINE },
        { id: expenseId(saved, "Bread"), date: "2027-03-01", description: "Bread", amountCents: 250 },
      ],
    });
    expect(again.status).toBe(200);
    expect(db.writes.filter((write) => write.table === "budget_lines")).toEqual([]);
  });

  it("does not update a line or an expense when the sheet sends the same values", async () => {
    const created = await createBudgetWorkbook(db.client, sheet({
      lines: [{ id: LINE, kind: "fixed", name: "Van", amountCents: 100, multiplier: 1, notes: "once" }],
      expenses: [{ id: EXPENSE, date: "2027-02-01", description: "Fuel", amountCents: 500, lineId: LINE }],
    }));
    db.writes.length = 0;
    const saved = await saveBudgetWorkbook(db.client, budgetId(created), {
      updatedAt: updatedAtOf(created),
      notes: (created.body.budget as { notes: string | null }).notes,
      lines: [{ id: LINE, kind: "fixed", name: "Van", amountCents: 100, multiplier: 1, notes: "once" }],
      expenses: [{ id: EXPENSE, date: "2027-02-01", description: "Fuel", amountCents: 500, lineId: LINE }],
    });
    expect(saved.status).toBe(200);
    expect(db.writes.filter((write) => write.table === "budget_lines" || write.table === "budget_expenses")).toEqual([]);
  });

  it("rejects a stale updatedAt before it archives anyone else's rows", async () => {
    const created = await createBudgetWorkbook(db.client, sheet({
      lines: [{ id: LINE, kind: "fixed", name: "Van", amountCents: 100, multiplier: 1 }],
    }));
    db.tables.budget_workbook_revisions.find((row) => row.budget_id === budgetId(created))!.revision = "2026-12-01T00:00:00.000Z";
    db.writes.length = 0;
    const saved = await saveBudgetWorkbook(db.client, budgetId(created), {
      updatedAt: updatedAtOf(created),
      lines: [],
    });
    expect(saved.status).toBe(409);
    expect(saved.body.error).toMatch(/Reload/);
    expect(db.writes.filter((write) => write.table === "budget_lines")).toEqual([]);
    expect(db.tables.budget_lines.find((line) => line.id === LINE)?.archived_at).toBeNull();
  });

  it("does not overwrite a line when its updated_at moves after the save was checked", async () => {
    const created = await createBudgetWorkbook(db.client, sheet({
      lines: [{ id: LINE, kind: "fixed", name: "Van", amountCents: 100, multiplier: 1 }],
    }));
    db.loseRace.add("budget_lines");
    const saved = await saveBudgetWorkbook(db.client, budgetId(created), {
      updatedAt: updatedAtOf(created),
      lines: [{ id: LINE, kind: "fixed", name: "Van", amountCents: 900, multiplier: 1 }],
    });
    expect(saved.status).toBe(409);
    expect(saved.body.error).toMatch(/Reload/);
    expect(db.tables.budget_lines.find((line) => line.id === LINE)?.amount_cents).toBe(100);
  });

  it("does not archive a line when that row changes after the save was checked", async () => {
    const created = await createBudgetWorkbook(db.client, sheet({
      lines: [{ id: LINE, kind: "fixed", name: "Van", amountCents: 100, multiplier: 1 }],
    }));
    db.loseRace.add("budget_lines");
    const saved = await saveBudgetWorkbook(db.client, budgetId(created), {
      updatedAt: updatedAtOf(created),
      lines: [],
    });
    expect(saved.status).toBe(409);
    expect(db.tables.budget_lines.find((line) => line.id === LINE)?.archived_at).toBeNull();
  });

  it("checks a huge line total before creating a budget", async () => {
    const result = await createBudgetWorkbook(db.client, sheet({
      lines: [{ kind: "fixed", name: "Huge", amountCents: 100_000_000_000_000, multiplier: 100000 }],
    }));
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/too large/);
    expect(db.tables.budgets).toHaveLength(0);
    expect(db.writes.some((write) => write.op === "create_budget_workbook_sheet")).toBe(false);
  });

  it("archives a draft when a later step fails, so a retry is not a bare name clash", async () => {
    db.denyInsert.add("budget_lines");
    const first = await createBudgetWorkbook(db.client, sheet({
      lines: [{ id: LINE, kind: "fixed", name: "Van", amountCents: 100, multiplier: 1 }],
    }));
    expect(first.status).toBe(403);
    expect(first.body.code).toBeUndefined();
    expect(db.tables.budgets.filter((row) => !row.archived_at)).toHaveLength(0);
    db.denyInsert.delete("budget_lines");
    const second = await createBudgetWorkbook(db.client, sheet({
      lines: [{ id: LINE, kind: "fixed", name: "Van", amountCents: 100, multiplier: 1 }],
    }));
    expect(second.status).toBe(201);
  });

  it("rolls the whole create back when a line cannot be saved", async () => {
    db.denyInsert.add("budget_lines");
    db.denyUpdate.add("budgets");
    const result = await createBudgetWorkbook(db.client, sheet({
      lines: [{ id: LINE, kind: "fixed", name: "Van", amountCents: 100, multiplier: 1 }],
    }));
    expect(result.status).toBe(403);
    expect(result.body.code).toBeUndefined();
    expect(db.tables.budgets).toHaveLength(0);
  });

  it("does not report success when archiving a line is skipped", async () => {
    const created = await createBudgetWorkbook(db.client, sheet({
      lines: [{ id: LINE, kind: "fixed", name: "Van", amountCents: 100, multiplier: 1 }],
    }));
    db.denyArchive.add("budget_lines");
    const saved = await saveBudgetWorkbook(db.client, budgetId(created), {
      updatedAt: updatedAtOf(created),
      lines: [],
    });
    expect(saved.status).toBe(403);
    expect(db.tables.budget_lines.find((line) => line.id === LINE)?.archived_at).toBeNull();
  });

  it("does not archive a line that still has live expenses when the tracker is left out", async () => {
    const created = await createBudgetWorkbook(db.client, sheet({
      lines: [{ id: LINE, kind: "fixed", name: "Van", amountCents: 100, multiplier: 1 }],
      expenses: [{ id: EXPENSE, date: "2027-02-01", description: "Fuel", amountCents: 500, lineId: LINE }],
    }));
    db.writes.length = 0;
    const saved = await saveBudgetWorkbook(db.client, budgetId(created), {
      updatedAt: updatedAtOf(created),
      lines: [],
    });
    expect(saved.status).toBe(200);
    expect(db.tables.budget_lines.find((line) => line.id === LINE)?.archived_at).toBeNull();
    expect(db.tables.budget_expenses.find((row) => row.id === EXPENSE)?.archived_at).toBeNull();
    expect(db.writes.filter((write) => write.table === "budget_lines" && write.op === "update")).toEqual([]);
  });

  it("lists only rand workbooks", async () => {
    await createBudgetWorkbook(db.client, sheet());
    db.tables.budgets.push({
      id: randomUUID(),
      name: "USA hidden",
      status: "draft",
      org_id: USA,
      currency: "USD",
      owner_kind: "event",
      staff_ministry_id: null,
      subcategory_id: null,
      program_id: null,
      event_id: OWNER,
      outreach_team_id: null,
      period_id: PERIOD,
      archived_at: null,
      driver_label: null,
      driver_value: null,
      funding_goal_cents: null,
      funds_in_hand_cents: null,
      income_goal_cents: null,
      fundraising_goal_cents: null,
      notes: null,
    });
    const listed = await listBudgetWorkbooks(db.client);
    expect(listed.status).toBe(200);
    const budgets = listed.body.budgets as { name: string; currency: string }[];
    expect(budgets.map((budget) => budget.name)).toEqual(["DTS 2027"]);
    expect(budgets[0].currency).toBe("ZAR");
  });
});

function budgetId(result: { body: Record<string, unknown> }): string {
  return (result.body.budget as { id: string }).id;
}

function updatedAtOf(result: { body: Record<string, unknown> }): string {
  return (result.body.budget as { updatedAt: string }).updatedAt;
}

function expenseId(result: { body: Record<string, unknown> }, description: string): string {
  const expenses = (result.body.budget as { expenses: { id: string; description: string }[] }).expenses;
  const found = expenses.find((row) => row.description === description);
  if (!found) throw new Error(`missing expense ${description}`);
  return found.id;
}
