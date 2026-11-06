import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./receipts", () => ({
  budgetForSlip: vi.fn(),
}));

import { budgetForSlip } from "./receipts";
import { confirmRepayment } from "./repayments";

const budgetForSlipMock = vi.mocked(budgetForSlip);

function adminFake() {
  const inserts: Record<string, unknown>[] = [];
  const lookups: Record<string, unknown>[] = [];
  const rows: Record<string, unknown>[] = [];
  let uniqueOnInsert = false;

  function chain(table: string) {
    const filters: Record<string, unknown> = {};
    const api = {
      select() {
        return api;
      },
      eq(key: string, value: unknown) {
        filters[key] = value;
        return api;
      },
      maybeSingle: async () => {
        if (table === "users") return { data: { id: "hub-1" }, error: null };
        return { data: null, error: null };
      },
      limit: async () => {
        lookups.push({ table, ...filters });
        if (table !== "budget_repayments") return { data: [], error: null };
        const hit = rows.filter((row) => row.slack_message_ts === filters.slack_message_ts);
        return { data: hit.slice(0, 1), error: null };
      },
      insert: async (row: Record<string, unknown>) => {
        inserts.push(row);
        if (uniqueOnInsert || rows.some((existing) => existing.slack_message_ts === row.slack_message_ts)) {
          return { error: { code: "23505", message: "duplicate key value violates unique constraint" } };
        }
        rows.push(row);
        return { error: null };
      },
    };
    return api;
  }

  return {
    from: (table: string) => chain(table),
    inserts,
    lookups,
    rows,
    armUnique() {
      uniqueOnInsert = true;
    },
  };
}

const VALUE = "18000|ZAR|team-1|U123|-|for a taxi";
const DRAFT = "8b1d6c3a-1f2e-4a5b-9c8d-0e1f2a3b4c5d";

describe("confirmRepayment", () => {
  beforeEach(() => {
    budgetForSlipMock.mockReset();
    budgetForSlipMock.mockResolvedValue({
      budgetId: "b1",
      currency: "ZAR",
      lineId: "l1",
      teamId: "team-1",
    });
  });

  it("stores each confirm token and does not block a second same-amount repayment", async () => {
    const admin = adminFake();
    const first = await confirmRepayment(admin, "U123", VALUE, { messageTs: "1710000000.000100" });
    const repeat = await confirmRepayment(admin, "U123", VALUE, { messageTs: "1710000000.000100" });
    const second = await confirmRepayment(admin, "U123", VALUE, { messageTs: "1710000000.000200" });

    expect(first.text).toMatch(/noted on the budget/);
    expect(repeat.text).toMatch(/already noted/);
    expect(second.text).toMatch(/noted on the budget/);
    expect(admin.rows.map((row) => row.slack_message_ts)).toEqual(["1710000000.000100", "1710000000.000200"]);
    expect(admin.rows[0]).toMatchObject({
      budget_id: "b1",
      line_id: "l1",
      amount_cents: 18000,
      slack_message_ts: "1710000000.000100",
      description: "for a taxi",
    });
    expect("currency" in (admin.rows[0] ?? {})).toBe(false);
    expect(admin.lookups.some((lookup) => lookup.table === "budget_repayments" && "description" in lookup)).toBe(false);
    expect(admin.lookups.some((lookup) => lookup.slack_message_ts === "1710000000.000100")).toBe(true);
  });

  it("uses the receipt draft id when the click has no message ts", async () => {
    const admin = adminFake();
    const value = `18000|ZAR|team-1|U123|${DRAFT}|for a taxi`;
    await confirmRepayment(admin, "U123", value, { messageTs: null });
    const repeat = await confirmRepayment(admin, "U123", value, {});
    expect(repeat.text).toMatch(/already noted/);
    expect(admin.rows).toHaveLength(1);
    expect(admin.rows[0]?.slack_message_ts).toBe(DRAFT);
  });

  it("treats a unique collision on the same token as a no-op", async () => {
    const admin = adminFake();
    admin.armUnique();
    const result = await confirmRepayment(admin, "U123", VALUE, { messageTs: "1710000000.000100" });
    expect(result.text).toMatch(/already noted/);
    expect(admin.rows).toHaveLength(0);
  });

  it("does not insert when the confirm has neither ts nor draft id", async () => {
    const admin = adminFake();
    const result = await confirmRepayment(admin, "U123", VALUE);
    expect(result.text).toMatch(/isn't saved on the budget/);
    expect(admin.inserts).toHaveLength(0);
  });
});
