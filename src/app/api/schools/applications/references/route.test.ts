import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, filterValue, type FakeQuery } from "@/lib/testing/fake-supabase";

// PATCH edits a reference's contact through the service-role client, so the
// route itself must keep a leader scoped to one school out of another's.
// The reference below belongs to an application in program A.

type Grant = { key: string; scope: string | null; via: "direct" | "role" };
type World = { roles: string[]; grants: Grant[] };

const state = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: null as any,
  edits: 0,
}));

// has_permission_for (migration 089): the key directly or through a role
// bundle, global (scope null) or scoped to the asked-for program.
function resolve(world: World) {
  return (q: FakeQuery) => {
    if (q.rpc?.name === "has_permission_for") {
      const { required_permission, target_program_id } = q.rpc.args as {
        required_permission: string;
        target_program_id: string;
      };
      return {
        data: world.grants.some(
          (g) => g.key === required_permission && (g.scope === null || g.scope === target_program_id)
        ),
      };
    }
    if (q.table === "user_roles") {
      const wanted = (filterValue(q, "in", "roles.name") as string[] | undefined) ?? [];
      return { data: world.roles.filter((r) => wanted.includes(r)).map((name) => ({ roles: { name } })) };
    }
    if (q.table === "user_permissions") {
      // canManageSchools' unscoped check: any direct grant of the key, wherever scoped.
      const keys = (filterValue(q, "in", "permissions.key") as string[] | undefined) ?? [];
      return {
        data: world.grants
          .filter((g) => g.via === "direct" && keys.includes(g.key))
          .map((g) => ({ permissions: { key: g.key } })),
      };
    }
    if (q.table === "role_permissions") {
      const keys = (filterValue(q, "in", "permissions.key") as string[] | undefined) ?? [];
      return {
        data: world.grants
          .filter((g) => g.via === "role" && keys.includes(g.key))
          .map((g) => ({ permissions: { key: g.key } })),
      };
    }
    if (q.table === "reference_requests") return { data: { id: "ref-1", application_id: "app-1" } };
    if (q.table === "application_responses") {
      // program_id lookup (service role) and userCanReadApplication (RLS) both land here.
      return { data: { id: "app-1", program_id: "prog-A" } };
    }
    return { data: [] };
  };
}

function signIn(world: World) {
  // user_roles is asked twice: role names, then role ids for the bundle lookup.
  const base = resolve(world);
  state.client = createFakeSupabase({
    user: { id: "u1" },
    resolve: (q) =>
      q.table === "user_roles" && q.columns === "role_id"
        ? { data: world.grants.some((g) => g.via === "role") ? [{ role_id: "r1" }] : [] }
        : base(q),
  }).client;
}

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.client }));
vi.mock("@/lib/references/edit-reference-contact", () => ({
  REFERENCE_EDIT_SELECT: "*",
  editReferenceContact: async () => {
    state.edits++;
    return { ok: true, data: {}, emailed: false, emailChanged: false };
  },
}));

import { PATCH } from "./route";

const patch = () =>
  PATCH(
    new Request("http://localhost/api/schools/applications/references", {
      method: "PATCH",
      body: JSON.stringify({ reference_request_id: "ref-1", referee_name: "New Name" }),
    })
  );

const leaderOf = (program: string): World => ({
  roles: ["program_leader"],
  grants: [{ key: "schools.manage", scope: program, via: "role" }],
});

beforeEach(() => {
  state.edits = 0;
});

describe("PATCH /api/schools/applications/references — program scope", () => {
  it.each<[string, World, number]>([
    ["leader of the same program", leaderOf("prog-A"), 200],
    ["leader of a different program", leaderOf("prog-B"), 403],
    [
      "direct schools.manage scoped to a different program",
      { roles: [], grants: [{ key: "schools.manage", scope: "prog-B", via: "direct" }] },
      403,
    ],
    [
      "unscoped schools.manage",
      { roles: [], grants: [{ key: "schools.manage", scope: null, via: "direct" }] },
      200,
    ],
    ["admin", { roles: ["admin"], grants: [] }, 200],
    ["no permission", { roles: ["staff"], grants: [] }, 403],
  ])("%s → %s", async (_label: string, world: World, status: number) => {
    signIn(world);
    const res = await patch();
    expect(res.status).toBe(status);
    expect(state.edits).toBe(status === 200 ? 1 : 0);
  });
});
