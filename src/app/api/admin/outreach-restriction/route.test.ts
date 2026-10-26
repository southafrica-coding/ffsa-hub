import { beforeEach, describe, expect, it, vi } from "vitest";

// The "outreach limited to own teams" toggle (migration 274), at the API
// layer. An in-memory stand-in for Supabase: user_roles is a map of user →
// role names, and every write is recorded, so a refused request can be shown
// to have written nothing.

const TARGET = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const state = vi.hoisted(() => {
  const state = {
    callerId: "sa" as string | null,
    roles: {} as Record<string, string[]>,
    writes: [] as { table: string; op: string; payload: unknown }[],
    client() {
      const caller = state.callerId;
      return {
        auth: {
          getUser: async () => ({ data: { user: caller ? { id: caller } : null } }),
        },
        rpc: async () => ({ data: null, error: null }),
        from(table: string) {
          const filters: Record<string, unknown> = {};
          let op = "select";
          let payload: unknown;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const q: any = {
            select: () => q,
            eq: (col: string, val: unknown) => {
              filters[col] = val;
              return q;
            },
            in: (col: string, val: unknown) => {
              filters[col] = val;
              return q;
            },
            limit: () => q,
            insert: (p: unknown) => {
              op = "insert";
              payload = p;
              return q;
            },
            upsert: (p: unknown) => {
              op = "upsert";
              payload = p;
              return q;
            },
            single: async () => q.run(),
            then: (res: (v: unknown) => unknown) => Promise.resolve(q.run()).then(res),
            run() {
              if (op === "select" && table === "user_roles") {
                const names = (filters["roles.name"] as string[]) ?? [];
                const mine = state.roles[filters.user_id as string] ?? [];
                return {
                  data: mine.filter((n) => names.includes(n)).map((name) => ({ roles: { name } })),
                  error: null,
                };
              }
              if (op === "select") return { data: [], error: null };
              state.writes.push({ table, op, payload });
              return { data: payload, error: null };
            },
          };
          return q;
        },
      };
    },
  };
  return state;
});

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.client() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.client() }));

const route = await import("./route");

const req = (body: unknown) =>
  new Request("http://localhost/api/admin/outreach-restriction", {
    method: "POST",
    body: JSON.stringify(body),
  });

beforeEach(() => {
  state.callerId = "sa";
  state.roles = {
    sa: ["super_admin"],
    ga: ["admin"],
    fin: ["finance_admin"],
    stefan: ["staff"],
  };
  state.writes = [];
});

describe("POST /api/admin/outreach-restriction", () => {
  it.each(["sa", "ga"])("%s (an admin tier) turns the flag on", async (who) => {
    state.callerId = who;
    const res = await route.POST(req({ user_id: TARGET, limited_to_own_teams: true }));
    expect(res.status).toBe(200);
    const write = state.writes.find((w) => w.table === "outreach_user_restrictions")!;
    expect(write.op).toBe("upsert");
    expect(write.payload).toMatchObject({ user_id: TARGET, limited_to_own_teams: true, set_by: who });
  });

  it("turns it off again", async () => {
    const res = await route.POST(req({ user_id: TARGET, limited_to_own_teams: false }));
    expect(res.status).toBe(200);
    expect(state.writes.find((w) => w.table === "outreach_user_restrictions")!.payload).toMatchObject({
      limited_to_own_teams: false,
    });
  });

  it("records who changed it in the audit log", async () => {
    await route.POST(req({ user_id: TARGET, limited_to_own_teams: true }));
    expect(state.writes.find((w) => w.table === "audit_logs")!.payload).toMatchObject({
      user_id: "sa",
      resource_type: "outreach_user_restrictions",
      resource_id: TARGET,
      changes: { limited_to_own_teams: true },
    });
  });

  it("never touches roles or permissions", async () => {
    await route.POST(req({ user_id: TARGET, limited_to_own_teams: true }));
    expect(state.writes.map((w) => w.table).sort()).toEqual(["audit_logs", "outreach_user_restrictions"]);
  });

  it("refuses a signed-out caller", async () => {
    state.callerId = null;
    expect((await route.POST(req({ user_id: TARGET, limited_to_own_teams: true }))).status).toBe(401);
    expect(state.writes).toEqual([]);
  });

  it.each(["fin", "stefan"])("refuses %s (not an admin tier), writing nothing", async (who) => {
    state.callerId = who;
    expect((await route.POST(req({ user_id: TARGET, limited_to_own_teams: false }))).status).toBe(403);
    expect(state.writes).toEqual([]);
  });

  it.each([
    [{ user_id: TARGET }],
    [{ user_id: TARGET, limited_to_own_teams: "yes" }],
    [{ user_id: "not-a-uuid", limited_to_own_teams: true }],
    [{ limited_to_own_teams: true }],
  ])("rejects a bad body %j", async (body) => {
    expect((await route.POST(req(body))).status).toBe(400);
    expect(state.writes).toEqual([]);
  });
});
