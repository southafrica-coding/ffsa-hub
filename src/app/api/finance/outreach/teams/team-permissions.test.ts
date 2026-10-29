import { beforeEach, describe, expect, it, vi } from "vitest";

// Outreach teams: anyone signed in may create one and becomes its owner
// (migration 260). Only outreach administrators — the database's
// is_outreach_staff_editor(): Super Admin, General Admin, finance_admin, or
// a finance.edit grant — archive, unarchive or delete a team (migration
// 272), and a delete only goes through when nothing is linked.
//
// The routes run against an in-memory stand-in for Supabase. `editors` says
// who is_outreach_staff_editor() answers true for; every write and every
// archive/delete RPC is recorded in `writes`.

const state = vi.hoisted(() => {
  const state = {
    callerId: "pat" as string | null,
    editors: new Set<string>(),
    blockers: {} as Record<string, number>,
    deleteError: null as { code: string; message: string } | null,
    writes: [] as { op: string; payload?: unknown }[],
    client() {
      const caller = state.callerId;
      return {
        auth: {
          getUser: async () => ({ data: { user: caller ? { id: caller } : null } }),
        },
        rpc: async (fn: string, args?: Record<string, unknown>) => {
          const editor = !!caller && state.editors.has(caller);
          if (fn === "is_outreach_staff_editor") return { data: editor, error: null };
          if (fn === "outreach_team_delete_blockers") {
            return { data: editor ? state.blockers : null, error: null };
          }
          if (fn === "set_outreach_team_archived" || fn === "delete_outreach_team") {
            state.writes.push({ op: fn, payload: args });
            if (fn === "delete_outreach_team" && state.deleteError) {
              return { data: null, error: state.deleteError };
            }
            return { data: null, error: null };
          }
          return { data: null, error: null };
        },
        from(table: string) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const q: any = {
            select: () => q,
            eq: () => q,
            single: async () => ({ data: { id: "t1" }, error: null }),
            then: (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(res),
          };
          for (const w of ["insert", "update", "delete"]) {
            q[w] = (payload: unknown) => {
              state.writes.push({ op: `${table}.${w}`, payload });
              return q;
            };
          }
          return q;
        },
      };
    },
  };
  return state;
});

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.client() }));

const teams = await import("./route");
const archive = await import("./archive/route");

const req = (method: string, body: unknown) =>
  new Request("http://localhost/api", { method, body: JSON.stringify(body) });

beforeEach(() => {
  state.callerId = "pat";
  // ga = General Admin, sa = Super Admin, fin = finance_admin / finance.edit.
  state.editors = new Set(["sa", "ga", "fin"]);
  state.blockers = {};
  state.deleteError = null;
  state.writes = [];
});

describe("creating an outreach team", () => {
  it("lets an ordinary signed-in member create one, as its creator", async () => {
    // "pat" is not an outreach administrator.
    const res = await teams.POST(req("POST", { team_name: "Botswana" }));
    expect(res.status).toBe(200);
    expect(state.writes.map((w) => w.op)).toEqual(["outreach_teams.insert"]);
    const payload = state.writes[0].payload as Record<string, unknown>;
    expect(payload.created_by).toBe("pat");
    expect(payload.program_id).toBeNull();
  });

  it("refuses someone signed out", async () => {
    state.callerId = null;
    expect((await teams.POST(req("POST", { team_name: "Botswana" }))).status).toBe(401);
    expect(state.writes).toEqual([]);
  });

  it("still needs a team name", async () => {
    expect((await teams.POST(req("POST", { location: "Gaborone" }))).status).toBe(400);
    expect(state.writes).toEqual([]);
  });

  it.each(["sa", "ga", "fin"])("lets outreach administrator %s create one", async (who) => {
    state.callerId = who;
    const res = await teams.POST(req("POST", { team_name: "Botswana" }));
    expect(res.status).toBe(200);
    expect(state.writes.map((w) => w.op)).toEqual(["outreach_teams.insert"]);
  });

  it("ignores fields a create may not set, like archived_at", async () => {
    // A non-admin can't create a team that arrives already archived.
    await teams.POST(
      req("POST", { team_name: "Botswana", archived_at: "2026-01-01", created_by: "someone-else" })
    );
    const payload = state.writes[0].payload as Record<string, unknown>;
    expect(payload.archived_at).toBeUndefined();
    expect(payload.created_by).toBe("pat");
    expect(payload.team_name).toBe("Botswana");
  });
});

describe("updating a team never archives it", () => {
  it("strips archived_at / archived_by from a plain update", async () => {
    state.callerId = "pat"; // e.g. an owner using the ordinary update
    await teams.PUT(req("PUT", { id: "t1", status: "active", archived_at: "2026-01-01", archived_by: "pat" }));
    const payload = state.writes[0].payload as Record<string, unknown>;
    expect(payload).toEqual({ status: "active" });
  });
});

describe("archiving and unarchiving", () => {
  it.each([true, false])("refuses an ordinary staff member archived=%s", async (archived) => {
    const res = await archive.POST(req("POST", { id: "t1", archived }));
    expect(res.status).toBe(403);
    expect(state.writes).toEqual([]);
  });

  it.each([true, false])("lets an administrator set archived=%s", async (archived) => {
    state.callerId = "ga";
    const res = await archive.POST(req("POST", { id: "t1", archived }));
    expect(res.status).toBe(200);
    expect(state.writes).toEqual([
      { op: "set_outreach_team_archived", payload: { p_team: "t1", p_archived: archived } },
    ]);
  });

  it("rejects a request without a clear yes/no", async () => {
    state.callerId = "ga";
    expect((await archive.POST(req("POST", { id: "t1" }))).status).toBe(400);
    expect((await archive.POST(req("POST", { archived: true }))).status).toBe(400);
    expect(state.writes).toEqual([]);
  });
});

describe("deleting a team", () => {
  it("refuses an ordinary staff member", async () => {
    const res = await teams.DELETE(req("DELETE", { id: "t1" }));
    expect(res.status).toBe(403);
    expect(state.writes).toEqual([]);
  });

  it("deletes a team with nothing linked", async () => {
    state.callerId = "sa";
    const res = await teams.DELETE(req("DELETE", { id: "t1" }));
    expect(res.status).toBe(200);
    expect(state.writes).toEqual([{ op: "delete_outreach_team", payload: { p_team: "t1" } }]);
  });

  it("offers archive instead when records would be lost, deleting nothing", async () => {
    state.callerId = "ga";
    state.blockers = { outreach_expenses: 4, people: 1 };
    const res = await teams.DELETE(req("DELETE", { id: "t1" }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.archive).toBe(true);
    expect(body.blockers).toEqual(["1 person on the team besides the owner", "4 expenses"]);
    expect(state.writes).toEqual([]);
  });

  it("still offers archive if the database finds something linked at the last moment", async () => {
    state.callerId = "fin";
    state.deleteError = { code: "23503", message: "linked" };
    const res = await teams.DELETE(req("DELETE", { id: "t1" }));
    expect(res.status).toBe(409);
    expect((await res.json()).archive).toBe(true);
  });

  it("needs an id", async () => {
    state.callerId = "ga";
    expect((await teams.DELETE(req("DELETE", {}))).status).toBe(400);
  });
});
