import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeQuery } from "@/lib/testing/fake-supabase";

// With a program_id the list uses userCanManageProgram, so a named leader
// and a program-scoped schools.* grant can load it. A missing program_id
// is 400 before any access check.

const PROGRAM_A = "11111111-1111-4111-8111-111111111111";
const PROGRAM_B = "22222222-2222-4222-8222-222222222222";

const h = vi.hoisted(() => ({ userClient: null as unknown }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => h.userClient,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({}),
}));
vi.mock("@/lib/auth/assignable-contacts", () => ({
  fetchAssignableContacts: async () => [],
}));

const route = await import("./route");

type RoleSeed = { name: string; scope_type: string | null; scope_id: string | null };
type PermSeed = { key: string; scope_type: string | null; scope_id: string | null };

function filterArg(q: FakeQuery, op: string, column: string): unknown {
  return q.filters.find((f) => f.op === op && f.args[0] === column)?.args[1];
}

function signIn(seed: { roles?: RoleSeed[]; perms?: PermSeed[]; leaderOf?: string[] }) {
  h.userClient = createFakeSupabase({
    user: { id: "me" },
    resolve: (q) => {
      if (q.table === "users") return { data: { is_active: true } };
      if (q.table === "user_roles") {
        return {
          data: (seed.roles ?? []).map((role) => ({
            scope_type: role.scope_type,
            scope_id: role.scope_id,
            roles: { name: role.name },
          })),
        };
      }
      if (q.table === "user_permissions") {
        let rows = seed.perms ?? [];
        if (q.filters.some((f) => f.op === "is" && f.args[0] === "scope_type" && f.args[1] === null)) {
          rows = rows.filter((perm) => perm.scope_type == null);
        }
        const scopeType = filterArg(q, "eq", "scope_type");
        if (typeof scopeType === "string") rows = rows.filter((perm) => perm.scope_type === scopeType);
        const scopeId = filterArg(q, "eq", "scope_id");
        if (typeof scopeId === "string") rows = rows.filter((perm) => perm.scope_id === scopeId);
        const keys = filterArg(q, "in", "permissions.key");
        if (Array.isArray(keys)) rows = rows.filter((perm) => keys.includes(perm.key));
        return { data: rows.map((perm) => ({ permissions: { key: perm.key } })) };
      }
      if (q.table === "program_leaders") {
        const programId = filterArg(q, "eq", "program_id");
        const hit = (seed.leaderOf ?? []).filter((id) => id === programId);
        return { data: hit.map((id) => ({ id })) };
      }
      return { data: [] };
    },
  }).client;
}

beforeEach(() => {
  h.userClient = null;
});

function get(programId?: string) {
  const query = programId ? `?program_id=${programId}` : "";
  return route.GET(new Request(`http://x/api/schools/staff-pickable${query}`));
}

describe("GET /api/schools/staff-pickable", () => {
  it("lets a program_leaders row and a program-scoped schools grant load that program", async () => {
    signIn({ leaderOf: [PROGRAM_A] });
    expect((await get(PROGRAM_A)).status).toBe(200);

    signIn({ perms: [{ key: "schools.manage", scope_type: "program", scope_id: PROGRAM_A }] });
    expect((await get(PROGRAM_A)).status).toBe(200);
  });

  it("refuses a program_leader scoped to another school", async () => {
    signIn({
      roles: [{ name: "program_leader", scope_type: "program", scope_id: PROGRAM_B }],
    });
    expect((await get(PROGRAM_A)).status).toBe(403);
  });

  it("rejects a missing program_id before the access check", async () => {
    signIn({ leaderOf: [PROGRAM_A] });
    expect((await get()).status).toBe(400);

    signIn({ perms: [{ key: "schools.manage", scope_type: null, scope_id: null }] });
    expect((await get()).status).toBe(400);
  });
});
