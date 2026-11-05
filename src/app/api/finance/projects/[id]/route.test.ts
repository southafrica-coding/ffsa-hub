import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakeSupabase,
  filterValue,
  permissionWorldResolver,
  type FakeQuery,
  type PermissionWorld,
} from "@/lib/testing/fake-supabase";

const state = vi.hoisted(() => ({
  fake: null as unknown as ReturnType<typeof import("@/lib/testing/fake-supabase").createFakeSupabase>,
  updates: [] as Array<{ id: string; patch: unknown; userId: string }>,
  audits: [] as unknown[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.fake.client,
}));
vi.mock("@/services/audit", () => ({
  createAuditLog: async (_s: unknown, entry: unknown) => {
    state.audits.push(entry);
    return { error: null };
  },
}));
vi.mock("@/lib/finance/orgs", async (orig) => ({
  ...(await orig<typeof import("@/lib/finance/orgs")>()),
  updateFinanceProject: async (_s: unknown, id: string, patch: unknown, userId: string) => {
    state.updates.push({ id, patch, userId });
    return { data: { id, ...(patch as object) }, error: null };
  },
}));

import { PATCH } from "./route";

const PROJECTS: Record<string, { id: string; org_id: string; name: string; project_type: string | null }> = {
  p1: { id: "p1", org_id: "npc", name: "Glory", project_type: null },
  p2: { id: "p2", org_id: "usa", name: "Glory", project_type: null },
  p3: { id: "p3", org_id: "npc", name: "Woven", project_type: null },
};

function world(access: PermissionWorld & { financeEdit?: boolean }, user: { id: string } | null = { id: "me" }) {
  state.fake = createFakeSupabase({
    user,
    resolve: (q: FakeQuery) => {
      if (q.rpc?.name === "has_permission") {
        const key = (q.rpc.args as { required_permission: string }).required_permission;
        return { data: key === "finance.edit" && !!access.financeEdit };
      }
      if (q.table === "finance_projects") {
        const id = filterValue(q, "eq", "id") as string;
        return { data: PROJECTS[id] ?? null };
      }
      return permissionWorldResolver(access)(q) ?? { data: [] };
    },
  });
}

const call = (body: unknown, id = "p1") =>
  PATCH(
    new Request("http://x/api/finance/projects/" + id, {
      method: "PATCH",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  );

const FINANCE_ADMIN: PermissionWorld = { roles: [{ id: "r", name: "finance_admin" }], direct: [] };

describe("PATCH /api/finance/projects/[id]", () => {
  beforeEach(() => {
    state.updates = [];
    state.audits = [];
    world(FINANCE_ADMIN);
  });

  it("401 when not signed in", async () => {
    world(FINANCE_ADMIN, null);
    expect((await call({ project_type: "event" })).status).toBe(401);
  });

  it.each<[string, PermissionWorld & { financeEdit?: boolean }, number]>([
    ["nobody", { roles: [], direct: [] }, 403],
    ["events_admin", { roles: [{ id: "r", name: "events_admin" }], direct: [] }, 403],
    ["finance.view only", { roles: [], direct: [{ module: "finance", key: "finance.view" }] }, 403],
    ["admin", { roles: [{ id: "r", name: "admin" }], direct: [] }, 200],
    ["super_admin", { roles: [{ id: "r", name: "super_admin" }], direct: [] }, 200],
    ["finance_admin", FINANCE_ADMIN, 200],
    ["finance.edit", { roles: [], direct: [], financeEdit: true }, 200],
  ])("%s → %i", async (_label, access, status) => {
    world(access);
    expect((await call({ project_type: "event" })).status).toBe(status);
  });

  it("saves the type and writes an audit log", async () => {
    const res = await call({ project_type: "asset" });
    expect(res.status).toBe(200);
    expect(state.updates).toEqual([{ id: "p1", patch: { project_type: "asset" }, userId: "me" }]);
    expect(state.audits).toEqual([
      {
        action: "finance_project.update",
        resource_type: "finance_project",
        resource_id: "p1",
        changes: { before: { project_type: null }, after: { project_type: "asset" } },
      },
    ]);
  });

  it("clears the type with null or empty", async () => {
    expect((await call({ project_type: "" })).status).toBe(200);
    expect(state.updates[0].patch).toEqual({ project_type: null });
  });

  it("400 on an unknown type", async () => {
    expect((await call({ project_type: "building" })).status).toBe(400);
    expect(state.updates).toEqual([]);
  });

  it("ignores name / org changes: nothing editable → 400", async () => {
    expect((await call({ name: "Renamed", org_id: "usa" })).status).toBe(400);
    expect(state.updates).toEqual([]);
  });

  it("drops name / org from a mixed body", async () => {
    await call({ name: "Renamed", notes: "  hi  " });
    expect(state.updates[0].patch).toEqual({ notes: "hi" });
  });

  it("links to a project in the other org, refuses the same org or itself", async () => {
    expect((await call({ linked_project_id: "p2" })).status).toBe(200);
    expect((await call({ linked_project_id: "p3" })).status).toBe(400);
    expect((await call({ linked_project_id: "p1" })).status).toBe(400);
    expect((await call({ linked_project_id: "nope" })).status).toBe(400);
    expect(state.updates).toHaveLength(1);
  });

  it("unlinks with null", async () => {
    expect((await call({ linked_project_id: null })).status).toBe(200);
    expect(state.updates[0].patch).toEqual({ linked_project_id: null });
  });

  it("404 for an unknown project", async () => {
    expect((await call({ project_type: "event" }, "missing")).status).toBe(404);
  });

  it("400 on bad JSON", async () => {
    expect((await call("{not json")).status).toBe(400);
  });
});
