import { describe, expect, it } from "vitest";
import {
  addBudgetExpense,
  addLine,
  archiveLine,
  codeBudgetLine,
  copyBudgetToPeriod,
  createBudgetFromTemplate,
  getBudgetExpenseTracker,
  getBudgetTemplates,
  getFinanceProjectTrackingOption,
  listBudgetOverviews,
  listBudgets,
  pickEditableExpenseFields,
  pickEditableLineFields,
  saveBudgetAsTemplate,
  updateLine,
} from "./budgets";

// A stand-in for the Supabase client that records every call in order.
function recorder() {
  const calls: [string, ...unknown[]][] = [];
  const builder: Record<string, unknown> = {};
  for (const m of ["from", "select", "insert", "update", "upsert", "eq", "is", "or", "order", "single", "maybeSingle"]) {
    builder[m] = (...args: unknown[]) => {
      calls.push([m, ...args]);
      return builder;
    };
  }
  builder.rpc = (...args: unknown[]) => {
    calls.push(["rpc", ...args]);
    return builder;
  };
  return { client: builder, calls };
}

describe("pickEditableLineFields", () => {
  it("drops the fields the database owns, even if a request body sends them", () => {
    const picked = pickEditableLineFields({
      name: "Meals",
      amount_cents: 19000,
      frequency: 12,
      line_total_cents: 1,
      coding_status: "overridden",
      budget_id: "other-budget",
      created_by: "someone-else",
      archived_at: null,
      id: "x",
    });
    expect(picked).toEqual({ name: "Meals", amount_cents: 19000, frequency: 12 });
  });

  it("keeps an explicit null (e.g. clearing notes) but not undefined", () => {
    expect(pickEditableLineFields({ notes: null, category_id: undefined })).toEqual({ notes: null });
  });
});

describe("budget service calls", () => {
  it("createBudgetFromTemplate calls the RPC with every argument, nulls for the optional ones", async () => {
    const { client, calls } = recorder();
    await createBudgetFromTemplate(client, {
      templateId: "t",
      ownerKind: "staff_ministry",
      ownerId: "pw",
      periodId: "p",
      orgId: "npc",
      name: "Sound – Upstairs",
    });
    expect(calls).toEqual([
      [
        "rpc",
        "create_budget_from_template",
        {
          p_template_id: "t",
          p_owner_kind: "staff_ministry",
          p_owner_id: "pw",
          p_period_id: "p",
          p_org_id: "npc",
          p_name: "Sound – Upstairs",
          p_currency: null,
          p_driver_label: null,
          p_driver_value: null,
          p_submit: false,
        },
      ],
    ]);
  });

  it("copyBudgetToPeriod passes the source, period, optional name and submit flag", async () => {
    const { client, calls } = recorder();
    await copyBudgetToPeriod(client, { sourceBudgetId: "b2026", periodId: "p2027", submit: true });
    expect(calls).toEqual([
      ["rpc", "copy_budget_to_period", { p_source_budget_id: "b2026", p_period_id: "p2027", p_name: null, p_submit: true }],
    ]);
  });

  it("saveBudgetAsTemplate passes the budget and name", async () => {
    const { client, calls } = recorder();
    await saveBudgetAsTemplate(client, "b1", "Sound – yearly");
    expect(calls).toEqual([["rpc", "save_budget_as_template", { p_budget_id: "b1", p_name: "Sound – yearly" }]]);
  });

  it("getBudgetTemplates narrows to the standard templates plus one owner's and one org", async () => {
    const { client, calls } = recorder();
    await getBudgetTemplates(client, { ownerKind: "program", ownerId: "som", orgId: "npc" });
    expect(calls).toContainEqual(["is", "archived_at", null]);
    expect(calls).toContainEqual(["or", "owner_kind.is.null,program_id.eq.som"]);
    expect(calls).toContainEqual(["or", "org_id.is.null,org_id.eq.npc"]);
  });

  it("listBudgets and the dashboard filter by one org and never select outreach tables", async () => {
    const listed = recorder();
    await listBudgets(listed.client, { orgId: "npc", periodId: "p", status: "draft" });
    expect(listed.calls).toContainEqual(["from", "budgets"]);
    expect(listed.calls).toContainEqual(["eq", "org_id", "npc"]);
    expect(listed.calls).toContainEqual(["eq", "period_id", "p"]);
    expect(listed.calls.some((c) => String(c[1]).includes("outreach"))).toBe(false);

    const dash = recorder();
    await listBudgetOverviews(dash.client, { orgId: "usa", status: "approved" });
    expect(dash.calls).toContainEqual(["from", "v_budget_overview"]);
    expect(dash.calls).toContainEqual(["eq", "org_id", "usa"]);
    expect(dash.calls).toContainEqual(["eq", "status", "approved"]);
  });

  it("codes a line by explicit ids and loads a project's tracking option by id only", async () => {
    const coded = recorder();
    await codeBudgetLine(coded.client, {
      lineId: "l1",
      orgRegion: "za",
      accountId: "acct",
      trackingOption1Id: "opt",
    });
    expect(coded.calls).toContainEqual(["from", "budget_line_coding"]);
    expect(coded.calls).toContainEqual([
      "upsert",
      {
        line_id: "l1",
        org_region: "za",
        account_id: "acct",
        tracking_option_1_id: "opt",
        tracking_option_2_id: null,
      },
      { onConflict: "line_id" },
    ]);

    const project = recorder();
    await getFinanceProjectTrackingOption(project.client, "proj-1");
    expect(project.calls).toContainEqual(["from", "finance_projects"]);
    expect(project.calls).toContainEqual(["eq", "id", "proj-1"]);
    expect(project.calls).toContainEqual(["select", "id, org_id, xero_tracking_option_id"]);
    expect(project.calls.some((c) => c[0] === "ilike" || c[0] === "like")).toBe(false);
  });

  it("records an expense without an org, currency or outreach fields", async () => {
    const { client, calls } = recorder();
    await addBudgetExpense(client, {
      budget_id: "b",
      expense_date: "2027-05-01",
      description: "Cable",
      amount_cents: 1500,
      // @ts-expect-error — the expense does not carry its own org or currency
      org_id: "npc",
      currency: "ZAR",
    });
    expect(calls.find((c) => c[0] === "insert")![1]).toEqual({
      budget_id: "b",
      expense_date: "2027-05-01",
      description: "Cable",
      amount_cents: 1500,
    });
    expect(calls).toContainEqual(["from", "budget_expenses"]);
  });

  it("drops org and currency if an expense patch tries to set them", () => {
    expect(pickEditableExpenseFields({ amount_cents: -500, org_id: "usa", currency: "USD" })).toEqual({
      amount_cents: -500,
    });
  });

  it("reads the expense tracker for one budget in date order", async () => {
    const { client, calls } = recorder();
    await getBudgetExpenseTracker(client, "b1");
    expect(calls).toContainEqual(["from", "v_budget_expense_tracker"]);
    expect(calls).toContainEqual(["eq", "budget_id", "b1"]);
    expect(calls).toContainEqual(["order", "expense_date"]);
    expect(calls).toContainEqual(["order", "expense_id"]);
  });

  it("addLine never sends a total or a coding status", async () => {
    const { client, calls } = recorder();
    await addLine(client, {
      budget_id: "b",
      section_id: "s",
      kind: "variable",
      name: "Meals",
      amount_cents: 19000,
      frequency: 12,
      multiplier: 8,
      // @ts-expect-error — not an input field; must be dropped at runtime too
      line_total_cents: 1,
    });
    const insert = calls.find((c) => c[0] === "insert")![1];
    expect(insert).toEqual({
      budget_id: "b",
      section_id: "s",
      kind: "variable",
      name: "Meals",
      amount_cents: 19000,
      frequency: 12,
      multiplier: 8,
    });
  });

  it("updateLine only patches editable fields of that line", async () => {
    const { client, calls } = recorder();
    // @ts-expect-error — budget_id is not patchable
    await updateLine(client, "l1", { amount_cents: 500, budget_id: "elsewhere" });
    expect(calls.find((c) => c[0] === "update")![1]).toEqual({ amount_cents: 500 });
    expect(calls).toContainEqual(["eq", "id", "l1"]);
  });

  it("archiveLine sets archived_at instead of deleting", async () => {
    const { client, calls } = recorder();
    await archiveLine(client, "l1");
    const patch = calls.find((c) => c[0] === "update")![1] as { archived_at: string };
    expect(Object.keys(patch)).toEqual(["archived_at"]);
    expect(Number.isNaN(Date.parse(patch.archived_at))).toBe(false);
    expect(calls.some((c) => c[0] === "delete")).toBe(false);
    expect(calls).toContainEqual(["is", "archived_at", null]);
  });
});
