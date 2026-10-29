import { describe, expect, it } from "vitest";
import {
  addLine,
  archiveLine,
  copyBudgetToPeriod,
  createBudgetFromTemplate,
  getBudgetTemplates,
  pickEditableLineFields,
  saveBudgetAsTemplate,
  updateLine,
} from "./budgets";

// A stand-in for the Supabase client that records every call in order.
function recorder() {
  const calls: [string, ...unknown[]][] = [];
  const builder: Record<string, unknown> = {};
  for (const m of ["from", "select", "insert", "update", "eq", "is", "or", "order", "single"]) {
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

  it("getBudgetTemplates narrows to the standard templates plus one owner's", async () => {
    const { client, calls } = recorder();
    await getBudgetTemplates(client, { ownerKind: "program", ownerId: "som" });
    expect(calls).toContainEqual(["is", "archived_at", null]);
    expect(calls).toContainEqual(["or", "owner_kind.is.null,program_id.eq.som"]);
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
