import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeQuery } from "@/lib/testing/fake-supabase";

const fetchAssignableContacts = vi.hoisted(() => vi.fn(async () => []));

const state = vi.hoisted(() => ({
  user: null as ReturnType<typeof createFakeSupabase>["client"] | null,
  rows: [] as Array<{ assigned_staff_id: string; program_id: string; status: string }>,
  error: false,
  active: true as boolean | null,
  scoped: true,
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.user }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      const selected: { ids?: string[] } = {};
      const q: Record<string, unknown> = {
        select() { return q; },
        not() { return q; },
        in(_col: string, ids: string[]) { selected.ids = ids; return q; },
        is() { return q; },
        eq() { return q; },
        then(resolve: (v: unknown) => unknown) {
          if (state.error) return Promise.resolve({ data: null, error: { message: "boom" } }).then(resolve);
          if (table === "users") {
            const ids = selected.ids ?? [];
            return Promise.resolve({
              data: ids.map((id) => ({ id, first_name: id, last_name: "", preferred_name: null, email: null })),
              error: null,
            }).then(resolve);
          }
          return Promise.resolve({ data: state.rows, error: null }).then(resolve);
        },
      };
      return q;
    },
  }),
}));
vi.mock("@/lib/auth/assignable-contacts", () => ({
  fetchAssignableContacts,
  ASSIGNABLE_CONTACT_PERMISSION_KEY: "schools.assignable_as_contact",
}));

import { GET as pickable } from "./staff-pickable/route";
import { GET as workload } from "./staff-workload/route";

const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function signIn() {
  state.user = createFakeSupabase({
    user: { id: "u" },
    resolve: (q: FakeQuery) => {
      if (q.table === "users") return { data: { is_active: state.active } };
      if (q.table === "user_roles") {
        if (!state.scoped) {
          return { data: [{ scope_type: null, scope_id: null, roles: { name: "admin" } }] };
        }
        return { data: [{ scope_type: "program", scope_id: A, role_id: "pl", roles: { name: "program_leader" } }] };
      }
      if (q.table === "role_permissions") {
        return { data: [{ role_id: "pl", permissions: { module: "schools", key: "schools.manage" } }] };
      }
      return { data: [] };
    },
  }).client;
}

describe("staff routes stay inside the caller's programs", () => {
  beforeEach(() => {
    state.error = false;
    state.active = true;
    state.scoped = true;
    state.rows = [
      { assigned_staff_id: "s1", program_id: A, status: "submitted" },
      { assigned_staff_id: "s2", program_id: B, status: "submitted" },
    ];
    fetchAssignableContacts.mockClear();
    signIn();
  });

  it("lets a scoped leader open the picker for their program", async () => {
    const res = await pickable(new Request(`http://localhost/api/schools/staff-pickable?program_id=${A}`));
    expect(res.status).toBe(200);
    expect(fetchAssignableContacts).toHaveBeenCalled();
  });

  it("refuses the picker for another program", async () => {
    const res = await pickable(new Request(`http://localhost/api/schools/staff-pickable?program_id=${B}`));
    expect(res.status).toBe(403);
    expect(fetchAssignableContacts).not.toHaveBeenCalled();
  });

  it("filters workload to the scoped leader's program and leaves an unscoped admin unfiltered", async () => {
    const scoped = await workload();
    expect(scoped.status).toBe(200);
    const scopedBody = await scoped.json();
    expect(scopedBody.workload.map((row: { user: { id: string } }) => row.user.id)).toEqual(["s1"]);

    state.scoped = false;
    signIn();
    const open = await workload();
    const openBody = await open.json();
    expect(openBody.workload.map((row: { user: { id: string } }) => row.user.id).sort()).toEqual(["s1", "s2"]);
  });

  it("refuses a deactivated leader and a failed workload read", async () => {
    state.active = false;
    signIn();
    expect((await pickable(new Request(`http://localhost/api/schools/staff-pickable?program_id=${A}`))).status).toBe(403);

    state.active = true;
    signIn();
    state.error = true;
    expect((await workload()).status).toBe(403);
  });
});
