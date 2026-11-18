import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, filterValue, type FakeQuery } from "@/lib/testing/fake-supabase";

// GET /api/me reads only the caller's own rows, through their own client.

const state = vi.hoisted(() => ({
  fake: null as unknown as ReturnType<typeof import("@/lib/testing/fake-supabase").createFakeSupabase>,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.fake.client,
}));

import { GET } from "./route";

function world(opts: { user?: { id: string; email?: string } | null; active?: boolean; error?: string; trainingError?: boolean }) {
  state.fake = createFakeSupabase({
    user: opts.user === undefined ? { id: "u1", email: "me@hub.test" } : opts.user,
    resolve: (q: FakeQuery) => {
      if (opts.error && q.table === "user_permissions") return { error: { message: opts.error } };
      if (q.table === "users") {
        return {
          data: {
            first_name: "Sam",
            last_name: "Dlamini",
            preferred_name: "Sammy",
            avatar_url: "https://cdn.test/a.png",
            is_active: opts.active ?? true,
          },
        };
      }
      if (q.table === "user_roles") {
        return {
          data: [{ role_id: "r-pl", scope_type: "program", scope_id: "p1", roles: { name: "program_leader" } }],
        };
      }
      if (q.table === "user_permissions") {
        return { data: [{ scope_type: null, scope_id: null, permissions: { key: "events.view" } }] };
      }
      if (q.table === "enrollment_staff") {
        return opts.trainingError ? { error: { message: "relation does not exist" } } : { data: null, count: 2 };
      }
      if (q.table === "program_staff") return { data: null, count: 0 };
      if (q.table === "role_permissions") {
        return { data: [{ role_id: "r-pl", permissions: { key: "schools.manage" } }] };
      }
      return { data: [] };
    },
  });
}

describe("GET /api/me", () => {
  beforeEach(() => world({}));

  it("401 JSON when not signed in", async () => {
    world({ user: null });
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthenticated" });
  });

  it("returns the contract shape, no-store", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toMatchObject({
      user: { id: "u1", email: "me@hub.test" },
      profile: {
        firstName: "Sam",
        lastName: "Dlamini",
        preferredName: "Sammy",
        avatarUrl: "https://cdn.test/a.png",
        isActive: true,
      },
      roles: [{ name: "program_leader", scopeType: "program", scopeId: "p1" }],
      permissions: [
        { key: "events.view", scopeType: null, scopeId: null, source: "direct" },
        { key: "schools.manage", scopeType: "program", scopeId: "p1", source: "role" },
      ],
    });
    expect(Number.isNaN(Date.parse(body.serverTime))).toBe(false);
  });

  it("every per-user read is filtered to the caller's own id", async () => {
    await GET();
    const byTable = Object.fromEntries(state.fake.queries.map((q) => [q.table, q]));
    expect(filterValue(byTable.users, "eq", "id")).toBe("u1");
    expect(filterValue(byTable.user_roles, "eq", "user_id")).toBe("u1");
    expect(filterValue(byTable.user_permissions, "eq", "user_id")).toBe("u1");
    expect(filterValue(byTable.role_permissions, "in", "role_id")).toEqual(["r-pl"]);
    expect(filterValue(byTable.enrollment_staff, "eq", "user_id")).toBe("u1");
    expect(filterValue(byTable.program_staff, "eq", "user_id")).toBe("u1");
  });

  it("reports Training ties as head counts", async () => {
    const body = await (await GET()).json();
    expect(body.training).toEqual({ walkingWith: 2, programStaff: 0 });
    const walking = state.fake.queries.find((q) => q.table === "enrollment_staff");
    expect(walking?.head).toBe(true);
  });

  it("answers 200 with training: null when the ties can't be read (334 not applied)", async () => {
    world({ trainingError: true });
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).training).toBeNull();
  });

  it("403 deactivated if the users row says so", async () => {
    world({ active: false });
    const res = await GET();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "deactivated" });
  });

  it("500 when a read fails", async () => {
    world({ error: "boom" });
    const res = await GET();
    expect(res.status).toBe(500);
  });
});
