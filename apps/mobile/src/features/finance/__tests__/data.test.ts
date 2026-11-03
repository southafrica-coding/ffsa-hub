import { DataError, loadHome, loadTeam, receiptCount, type ReadClient } from "../data";
import { TEAM } from "../__fixtures__/fixtures";

// A stand-in for the Supabase client: each table/rpc answers with whatever
// RLS would let this person see. Queries are recorded.
type Answer = { data: unknown; error: { message: string } | null };
function fakeDb(tables: Record<string, Answer>, rpcs: Record<string, Answer>) {
  const calls: string[] = [];
  const db: ReadClient = {
    rpc: (fn: string, args?: Record<string, unknown>) => {
      calls.push(`rpc:${fn}:${JSON.stringify(args ?? {})}`);
      return Promise.resolve(rpcs[fn] ?? { data: null, error: null });
    },
    from: (table: string) => {
      calls.push(`from:${table}`);
      const answer = tables[table] ?? { data: [], error: null };
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "order", "range"]) q[m] = () => q;
      q.maybeSingle = () => Promise.resolve(answer);
      q.then = (res: (a: Answer) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(answer).then(res, rej);
      return q;
    },
  };
  return { db, calls };
}

const myTeams = [
  { membership_id: "m1", role: "owner", team_id: TEAM, team_name: "Burundi", location: "Bujumbura", country: "Burundi", status: "active", start_date: "2026-11-01", end_date: null, program_name: "DTS" },
  { membership_id: "m2", role: "team_member", team_id: "t-2", team_name: "Malawi", location: null, country: null, status: "planning", start_date: null, end_date: null, program_name: null },
];

describe("loadHome", () => {
  it("lists every team you're on, with money only where RLS lets you read it", async () => {
    const { db } = fakeDb(
      {
        outreach_teams: { data: [{ id: TEAM, team_name: "Burundi", currency: "BIF", status: "active" }], error: null },
        outreach_team_budgets: { data: [{ team_id: TEAM, category_id: "c1", budget_amount_zar: "10000" }, { team_id: TEAM, category_id: "c2", budget_amount_zar: 2500 }], error: null },
        outreach_expenses: { data: [{ team_id: TEAM, zar_amount: "1200.40" }, { team_id: TEAM, zar_amount: 300 }], error: null },
      },
      { my_outreach_teams: { data: myTeams, error: null } },
    );
    const { teams } = await loadHome(db);
    expect(teams).toHaveLength(2);
    expect(teams[0].money).toEqual({ currency: "BIF", budget: 12500, spent: 1500.4 });
    // A plain member sees the team, but no figures.
    expect(teams[1].money).toBeNull();
  });

  it("asks for no money at all when you're only a member", async () => {
    const { db, calls } = fakeDb({ outreach_teams: { data: [], error: null } }, { my_outreach_teams: { data: [myTeams[1]], error: null } });
    const { teams } = await loadHome(db);
    expect(teams[0].money).toBeNull();
    expect(calls).not.toContain("from:outreach_expenses");
  });

  it("is empty for someone on no team", async () => {
    const { db } = fakeDb({}, { my_outreach_teams: { data: [], error: null } });
    expect(await loadHome(db)).toEqual({ teams: [] });
  });

  it("turns a network failure into a plain, offline-flagged error", async () => {
    const { db } = fakeDb({}, { my_outreach_teams: { data: null, error: { message: "TypeError: Network request failed" } } });
    await expect(loadHome(db)).rejects.toMatchObject({ name: "DataError", offline: true, message: expect.stringMatching(/Check your connection/) });
  });

  it("doesn't leak database wording for other errors", async () => {
    const { db } = fakeDb({}, { my_outreach_teams: { data: null, error: { message: "permission denied for function my_outreach_teams" } } });
    const err = await loadHome(db).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DataError);
    expect((err as Error).message).not.toMatch(/permission denied/);
  });

  it("refuses a malformed answer instead of showing nonsense", async () => {
    const { db } = fakeDb({}, { my_outreach_teams: { data: [{ nope: true }], error: null } });
    await expect(loadHome(db)).rejects.toThrow(/couldn't read/);
  });
});

describe("loadTeam", () => {
  it("gives the money view to someone RLS lets read the team", async () => {
    const { db, calls } = fakeDb(
      {
        outreach_teams: { data: { id: TEAM, team_name: "Burundi", currency: "ZAR", status: "active" }, error: null },
        outreach_budget_categories: { data: [{ id: "c1", name: "Food", sort_order: 1 }], error: null },
        outreach_team_budgets: { data: [{ team_id: TEAM, category_id: "c1", budget_amount_zar: 1000 }], error: null },
        outreach_expenses: { data: [{ id: "e1", team_id: TEAM, category_id: "c1", expense_date: "2026-11-02", zar_amount: "100", payment_method: "cash" }], error: null },
        outreach_cash_batches: { data: [{ batch_date: "2026-11-01", local_currency: "BIF", exchange_rate: 150 }], error: null },
        outreach_receipts: { data: [{ expense_id: "e1" }, { expense_id: "e1" }], error: null },
      },
      { can_edit_outreach_team: { data: true, error: null } },
    );
    const t = await loadTeam(db, TEAM);
    expect(t.kind).toBe("money");
    if (t.kind !== "money") return;
    expect(t.canEdit).toBe(true);
    expect(t.expenses[0].zar_amount).toBe(100);
    expect(t.receiptCounts).toEqual({ e1: 2 });
    expect(t.pulls).toHaveLength(1);
    expect(calls).toContain(`rpc:can_edit_outreach_team:${JSON.stringify({ check_team_id: TEAM })}`);
  });

  it("hides edit buttons when the hint can't be read (RLS still decides)", async () => {
    const { db } = fakeDb(
      { outreach_teams: { data: { id: TEAM, team_name: "Burundi" }, error: null } },
      { can_edit_outreach_team: { data: null, error: { message: "function does not exist" } } },
    );
    const t = await loadTeam(db, TEAM);
    expect(t.kind === "money" && t.canEdit).toBe(false);
  });

  it("gives plain members the money-free overview (migration 260)", async () => {
    const { db } = fakeDb(
      { outreach_teams: { data: null, error: null } },
      {
        outreach_team_overview: {
          data: { id: TEAM, team_name: "Burundi", status: "active", my_role: "team_member", roster: [{ id: "p1", role: "owner", name: "Thandi" }] },
          error: null,
        },
      },
    );
    const t = await loadTeam(db, TEAM);
    expect(t).toMatchObject({ kind: "member", overview: { my_role: "team_member", roster: [{ name: "Thandi" }] } });
  });

  it("is 'none' when you can't see the team at all", async () => {
    const { db } = fakeDb({ outreach_teams: { data: null, error: null } }, { outreach_team_overview: { data: null, error: null } });
    expect(await loadTeam(db, TEAM)).toEqual({ kind: "none" });
  });
});

describe("receiptCount", () => {
  it("counts a legacy receipt_path as one receipt", () => {
    expect(receiptCount({ id: "e1", receipt_path: null }, { e1: 3 })).toBe(3);
    expect(receiptCount({ id: "e2", receipt_path: "old/path.jpg" }, {})).toBe(1);
    expect(receiptCount({ id: "e3", receipt_path: null }, {})).toBe(0);
  });
});
