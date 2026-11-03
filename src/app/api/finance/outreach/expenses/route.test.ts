import { beforeEach, describe, expect, it, vi } from "vitest";

// Outreach expenses POST. The phone app picks the expense id itself and
// retries a save that may already have got through (a dropped connection),
// so the same id twice must give back the first row, not a second expense
// and not an error. Everything the website sends (no id) behaves as before.
//
// The route runs against an in-memory stand-in for Supabase: `rows` is the
// expenses table as RLS shows it to the caller, `insertError` forces the
// next insert to fail.

const state = vi.hoisted(() => {
  const state = {
    callerId: "pat" as string | null,
    rows: [] as Record<string, unknown>[],
    insertError: null as { code?: string; message: string } | null,
    inserts: [] as Record<string, unknown>[],
    alerts: [] as string[],
    afterCallbacks: [] as (() => unknown)[],
    client() {
      const caller = state.callerId;
      return {
        auth: { getUser: async () => ({ data: { user: caller ? { id: caller } : null } }) },
        from() {
          let filterId: string | null = null;
          let pending: Record<string, unknown> | null = null;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const q: any = {
            insert: (payload: Record<string, unknown>) => {
              pending = payload;
              return q;
            },
            select: () => q,
            eq: (_col: string, v: string) => {
              filterId = v;
              return q;
            },
            single: async () => {
              if (!pending) return { data: null, error: null };
              state.inserts.push(pending);
              if (state.insertError) return { data: null, error: state.insertError };
              const row = { id: pending.id ?? "server-id", ...pending };
              state.rows.push(row);
              return { data: row, error: null };
            },
            maybeSingle: async () => ({
              data: state.rows.find((r) => r.id === filterId) ?? null,
              error: null,
            }),
          };
          return q;
        },
      };
    },
  };
  return state;
});

vi.mock("next/server", async (orig) => {
  const actual = await orig<typeof import("next/server")>();
  return { ...actual, after: (fn: () => unknown) => state.afterCallbacks.push(fn) };
});
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.client() }));
vi.mock("@/lib/outreach/cash-alerts", () => ({
  checkCashAlert: (teamId: string) => state.alerts.push(teamId),
}));

const { POST } = await import("./route");

const ID = "0b6c8a62-3c1e-4d2a-9f43-5e6f7a8b9c0d";
const TEAM = "7f1d2c3b-4a59-4e8d-8c7b-6a5f4e3d2c1b";
const base = { team_id: TEAM, category_id: "cat-1", expense_date: "2026-11-03", zar_amount: 120 };
const post = (body: unknown) =>
  POST(new Request("http://localhost/api/finance/outreach/expenses", { method: "POST", body: JSON.stringify(body) }));
const runAfter = () => state.afterCallbacks.splice(0).forEach((fn) => fn());

beforeEach(() => {
  state.callerId = "pat";
  state.rows = [];
  state.insertError = null;
  state.inserts = [];
  state.alerts = [];
  state.afterCallbacks = [];
});

describe("POST /api/finance/outreach/expenses", () => {
  it("still saves a website expense with no id, as its creator, and checks the cash alert", async () => {
    const res = await post({ ...base, created_by: "someone-else" });
    expect(res.status).toBe(200);
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0].created_by).toBe("pat");
    expect(state.inserts[0].id).toBeUndefined();
    runAfter();
    expect(state.alerts).toEqual([TEAM]);
  });

  it("refuses someone signed out", async () => {
    state.callerId = null;
    expect((await post({ ...base, id: ID })).status).toBe(401);
    expect(state.inserts).toEqual([]);
  });

  it("still needs the required fields", async () => {
    expect((await post({ id: ID, team_id: TEAM })).status).toBe(400);
    expect(state.inserts).toEqual([]);
  });

  it("saves with the id the app chose", async () => {
    const res = await post({ ...base, id: ID });
    expect(res.status).toBe(200);
    expect((await res.json()).data.id).toBe(ID);
  });

  it("rejects an id that isn't a UUID", async () => {
    expect((await post({ ...base, id: "1; drop table" })).status).toBe(400);
    expect(state.inserts).toEqual([]);
  });

  it("answers a retried save with the first row instead of a second expense", async () => {
    await post({ ...base, id: ID });
    runAfter();
    state.insertError = { code: "23505", message: "duplicate key value violates unique constraint" };
    const res = await post({ ...base, id: ID });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ success: true, replayed: true, data: { id: ID, team_id: TEAM } });
    expect(state.rows).toHaveLength(1);
    // Nothing changed, so no second cash-alert check.
    runAfter();
    expect(state.alerts).toEqual([TEAM]);
  });

  it("won't hand back someone else's expense for a reused id", async () => {
    // The id exists but RLS hides it from this caller.
    state.insertError = { code: "23505", message: "duplicate key" };
    const res = await post({ ...base, id: ID });
    expect(res.status).toBe(409);
    expect(JSON.stringify(await res.json())).not.toContain("team_id");
  });

  it("won't treat an id on a different team as a replay", async () => {
    state.rows = [{ id: ID, team_id: "other-team" }];
    state.insertError = { code: "23505", message: "duplicate key" };
    expect((await post({ ...base, id: ID })).status).toBe(409);
  });

  it("turns a row-level-security refusal into a 403", async () => {
    state.insertError = { code: "42501", message: "new row violates row-level security policy" };
    const res = await post({ ...base, id: ID });
    expect(res.status).toBe(403);
    runAfter();
    expect(state.alerts).toEqual([]);
  });

  it("keeps other database errors as a 500 with their message", async () => {
    state.insertError = { code: "23502", message: "null value in column" };
    const res = await post(base);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("null value in column");
  });
});
