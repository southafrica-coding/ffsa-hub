import { beforeEach, describe, expect, it, vi } from "vitest";

// Outreach groups (migration 273), at the API layer. The routes run against
// an in-memory stand-in for Supabase whose RPCs answer the way the
// database's helpers would:
//   is_outreach_staff_editor()      → caller is in `editors`
//   can_manage_outreach_group(g)    → editor, or caller manages g
// Every write is recorded, so a refused request can be shown to have
// written nothing — the check happens on the server before the database.

const G1 = "11111111-1111-4111-8111-111111111111";
const G2 = "22222222-2222-4222-8222-222222222222";
const T1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const T2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const U1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const state = vi.hoisted(() => {
  const state = {
    callerId: "pat" as string | null,
    editors: new Set<string>(),
    managers: {} as Record<string, string[]>,
    links: [] as { group_id: string; team_id: string }[],
    writes: [] as { op: string; payload?: unknown }[],
    client() {
      const caller = state.callerId;
      const isEditor = !!caller && state.editors.has(caller);
      return {
        auth: {
          getUser: async () => ({ data: { user: caller ? { id: caller } : null } }),
        },
        rpc: async (fn: string, args?: Record<string, string>) => {
          if (fn === "is_outreach_staff_editor") return { data: isEditor, error: null };
          if (fn === "can_manage_outreach_group") {
            const g = args?.p_group ?? "";
            return { data: isEditor || (state.managers[g] ?? []).includes(caller ?? ""), error: null };
          }
          return { data: null, error: null };
        },
        from(table: string) {
          const filters: Record<string, string> = {};
          let op = "select";
          let payload: unknown;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const q: any = {
            select: () => q,
            eq: (col: string, val: string) => {
              filters[col] = val;
              return q;
            },
            insert: (p: unknown) => {
              op = "insert";
              payload = p;
              return q;
            },
            update: (p: unknown) => {
              op = "update";
              payload = p;
              return q;
            },
            delete: () => {
              op = "delete";
              return q;
            },
            single: async () => q.run(),
            then: (res: (v: unknown) => unknown) => Promise.resolve(q.run()).then(res),
            run() {
              if (op === "select") return { data: [], error: null };
              state.writes.push({ op: `${table}.${op}`, payload: payload ?? filters });
              if (table === "outreach_group_teams" && op === "insert") {
                state.links.push(payload as { group_id: string; team_id: string });
                return { data: payload, error: null };
              }
              if (table === "outreach_group_teams" && op === "delete") {
                const before = state.links.length;
                state.links = state.links.filter(
                  (l) => !(l.group_id === filters.group_id && l.team_id === filters.team_id)
                );
                return { data: before > state.links.length ? [{ team_id: filters.team_id }] : [], error: null };
              }
              if (op === "delete") return { data: [{ id: "x" }], error: null };
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

const groups = await import("./route");
const groupTeams = await import("./teams/route");
const groupManagers = await import("./managers/route");

const req = (method: string, body?: unknown, query = "") =>
  new Request(`http://localhost/api${query}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  state.callerId = "pat";
  state.editors = new Set(["sa", "fin"]);
  state.managers = { [G1]: ["mia"], [G2]: ["max"] };
  state.links = [{ group_id: G1, team_id: T1 }];
  state.writes = [];
});

describe("creating, renaming and deleting groups", () => {
  it.each(["sa", "fin"])("administrator %s creates a group", async (who) => {
    state.callerId = who;
    const res = await groups.POST(req("POST", { name: "  Nations  ", category: "International" }));
    expect(res.status).toBe(200);
    expect(state.writes).toEqual([
      {
        op: "outreach_groups.insert",
        payload: { name: "Nations", category: "International", description: null, created_by: who },
      },
    ]);
  });

  it.each(["pat", "mia"])("%s (a leader / a manager) can't create one", async (who) => {
    state.callerId = who;
    expect((await groups.POST(req("POST", { name: "Nations" }))).status).toBe(403);
    expect(state.writes).toEqual([]);
  });

  it("a manager can't rename or delete their own group", async () => {
    state.callerId = "mia";
    expect((await groups.PUT(req("PUT", { id: G1, name: "Mine now" }))).status).toBe(403);
    expect((await groups.DELETE(req("DELETE", { id: G1 }))).status).toBe(403);
    expect(state.writes).toEqual([]);
  });

  it("refuses someone signed out", async () => {
    state.callerId = null;
    expect((await groups.POST(req("POST", { name: "Nations" }))).status).toBe(401);
  });

  it("needs a name and a real id", async () => {
    state.callerId = "sa";
    expect((await groups.POST(req("POST", { name: "   " }))).status).toBe(400);
    expect((await groups.PUT(req("PUT", { id: "not-a-uuid", name: "x" }))).status).toBe(400);
    expect((await groups.DELETE(req("DELETE", {}))).status).toBe(400);
    expect(state.writes).toEqual([]);
  });

  it("an administrator deletes a group", async () => {
    state.callerId = "fin";
    expect((await groups.DELETE(req("DELETE", { id: G1 }))).status).toBe(200);
    expect(state.writes.map((w) => w.op)).toEqual(["outreach_groups.delete"]);
  });
});

describe("putting teams in groups and taking them out", () => {
  it("a manager adds a team to the group they manage", async () => {
    state.callerId = "mia";
    const res = await groupTeams.POST(req("POST", { group_id: G1, team_id: T2 }));
    expect(res.status).toBe(200);
    expect(state.links).toContainEqual({ group_id: G1, team_id: T2, added_by: "mia" });
  });

  it("but not to a group someone else manages", async () => {
    state.callerId = "mia";
    expect((await groupTeams.POST(req("POST", { group_id: G2, team_id: T2 }))).status).toBe(403);
    expect(state.writes).toEqual([]);
  });

  it("a manager takes a team out of their group", async () => {
    state.callerId = "mia";
    const res = await groupTeams.DELETE(req("DELETE", undefined, `?group_id=${G1}&team_id=${T1}`));
    expect(res.status).toBe(200);
    expect(state.links).toEqual([]);
  });

  it("a manager can't take a team out of another group", async () => {
    state.callerId = "max";
    const res = await groupTeams.DELETE(req("DELETE", undefined, `?group_id=${G1}&team_id=${T1}`));
    expect(res.status).toBe(403);
    expect(state.links).toEqual([{ group_id: G1, team_id: T1 }]);
  });

  it("a team leader who manages nothing can't change any group", async () => {
    state.callerId = "pat";
    expect((await groupTeams.POST(req("POST", { group_id: G1, team_id: T2 }))).status).toBe(403);
    expect((await groupTeams.DELETE(req("DELETE", undefined, `?group_id=${G1}&team_id=${T1}`))).status).toBe(403);
    expect(state.writes).toEqual([]);
  });

  it("administrators change any group's teams", async () => {
    state.callerId = "sa";
    expect((await groupTeams.POST(req("POST", { group_id: G2, team_id: T1 }))).status).toBe(200);
    expect((await groupTeams.DELETE(req("DELETE", undefined, `?group_id=${G1}&team_id=${T1}`))).status).toBe(200);
    expect(state.links).toEqual([{ group_id: G2, team_id: T1, added_by: "sa" }]);
  });

  it("a team can be in two groups", async () => {
    state.callerId = "sa";
    await groupTeams.POST(req("POST", { group_id: G2, team_id: T1 }));
    expect(state.links.filter((l) => l.team_id === T1).map((l) => l.group_id).sort()).toEqual([G1, G2]);
  });

  it("says so when the team isn't in the group", async () => {
    state.callerId = "mia";
    const res = await groupTeams.DELETE(req("DELETE", undefined, `?group_id=${G1}&team_id=${T2}`));
    expect(res.status).toBe(404);
  });

  it("checks ids before anything else", async () => {
    state.callerId = "sa";
    expect((await groupTeams.POST(req("POST", { group_id: G1, team_id: "x" }))).status).toBe(400);
    expect((await groupTeams.DELETE(req("DELETE", undefined, `?group_id=${G1}`))).status).toBe(400);
    state.callerId = null;
    expect((await groupTeams.POST(req("POST", { group_id: G1, team_id: T2 }))).status).toBe(401);
    expect(state.writes).toEqual([]);
  });
});

describe("assigning managers", () => {
  it("administrators assign and unassign managers", async () => {
    state.callerId = "fin";
    expect((await groupManagers.POST(req("POST", { group_id: G1, user_id: U1 }))).status).toBe(200);
    expect(
      (await groupManagers.DELETE(req("DELETE", undefined, `?group_id=${G1}&user_id=${U1}`))).status
    ).toBe(200);
    expect(state.writes.map((w) => w.op)).toEqual([
      "outreach_group_managers.insert",
      "outreach_group_managers.delete",
    ]);
  });

  it("a manager can't appoint another manager, even to their own group", async () => {
    state.callerId = "mia";
    expect((await groupManagers.POST(req("POST", { group_id: G1, user_id: U1 }))).status).toBe(403);
    expect(
      (await groupManagers.DELETE(req("DELETE", undefined, `?group_id=${G1}&user_id=${U1}`))).status
    ).toBe(403);
    expect(state.writes).toEqual([]);
  });
});
