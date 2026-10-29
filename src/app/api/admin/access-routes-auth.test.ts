import { beforeEach, describe, expect, it, vi } from "vitest";

// Every route behind an access-changing control on /users, /users/[id]/permissions
// and /roles must refuse a signed-out caller (401) and a caller without the
// right tier (403) — and refuse BEFORE writing anything. The confirmation
// dialogs are UI only; these checks are the real gate.
//
// Same in-memory Supabase stand-in as protect-super-admin.test.ts: user_roles
// is a map of user → role names (role id = role name), role_permissions and
// permissions are small maps, and every write is recorded in `writes`.

const state = vi.hoisted(() => {
  type Filters = Record<string, unknown[]>;
  const state = {
    callerId: null as string | null,
    roles: {} as Record<string, string[]>,
    /** role name → permission keys it bundles */
    rolePerms: {} as Record<string, string[]>,
    /** permission id → key */
    permissions: {} as Record<string, string>,
    writes: [] as string[],
    client(authId?: string | null) {
      return {
        auth: {
          getUser: async () => ({ data: { user: authId ? { id: authId } : null } }),
        },
        rpc: async () => ({ data: null, error: null }),
        from(table: string) {
          const filters: Filters = {};
          let op = "select";
          const rows = (): unknown[] => {
            if (table === "user_roles") {
              const ids = (filters.user_id as string[]) ?? Object.keys(state.roles);
              const names = filters["roles.name"] as string[] | undefined;
              return ids.flatMap((u) =>
                (state.roles[u] ?? [])
                  .filter((n) => !names || names.includes(n))
                  .map((n) => ({
                    id: `${u}:${n}`,
                    user_id: u,
                    role_id: n,
                    scope_type: null,
                    scope_id: null,
                    roles: { name: n, display_name: n, is_system: true },
                  }))
              );
            }
            if (table === "role_permissions") {
              const roleIds = (filters.role_id as string[]) ?? [];
              return roleIds.flatMap((r) =>
                (state.rolePerms[r] ?? []).map((key) => ({ permissions: { key } }))
              );
            }
            if (table === "permissions") {
              const ids = (filters.id as string[]) ?? [];
              return ids
                .filter((id) => state.permissions[id])
                .map((id) => ({ id, key: state.permissions[id] }));
            }
            if (table === "roles") {
              const names = (filters.name ?? filters.id) as string[] | undefined;
              return (names ?? []).map((n) => ({ id: n, name: n, is_system: false }));
            }
            if (table === "users") {
              const ids = (filters.id as string[]) ?? [];
              return ids.map((id) => ({ id, email: `${id}@ffsa.test` }));
            }
            return [];
          };
          const result = () =>
            op === "select" ? { data: rows(), error: null } : { data: null, error: null };
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const q: any = {
            eq: (col: string, v: unknown) => ((filters[col] = [v]), q),
            in: (col: string, vs: unknown[]) => ((filters[col] = vs), q),
            single: async () => {
              const r = result();
              return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: null };
            },
            then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
              Promise.resolve(result()).then(res, rej),
          };
          q.maybeSingle = q.single;
          for (const m of ["select", "order", "limit", "is", "neq", "ilike", "or"]) {
            q[m] = () => q;
          }
          for (const w of ["insert", "update", "delete", "upsert"]) {
            q[w] = () => {
              op = w;
              state.writes.push(`${table}.${w}`);
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

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.client(state.callerId),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.client() }));
vi.mock("@/lib/google/calendar", () => ({
  addUserToBaseCalendar: vi.fn(),
  removeUserFromBaseCalendar: vi.fn(),
  syncCalendarAccess: vi.fn(),
}));
vi.mock("@/lib/users/set-membership-role", async (orig) => ({
  ...(await orig<typeof import("@/lib/users/set-membership-role")>()),
  setMembershipRole: vi.fn(async () => {
    state.writes.push("setMembershipRole");
    return { roleNames: [] };
  }),
}));
vi.mock("@/services/permissions", async (orig) => ({
  ...(await orig<typeof import("@/services/permissions")>()),
  grantPermission: vi.fn(async () => {
    state.writes.push("grantPermission");
    return { data: {}, error: null };
  }),
  revokePermission: vi.fn(async () => {
    state.writes.push("revokePermission");
    return { data: {}, error: null };
  }),
}));

const grantRole = await import("./grant-role/route");
const revokeRole = await import("./revoke-role/route");
const grantPermission = await import("./grant-permission/route");
const revokePermission = await import("./revoke-permission/route");
const setMembership = await import("./set-membership-role/route");
const setUserActive = await import("./set-user-active/route");
const roles = await import("./roles/route");
const roleById = await import("./roles/[id]/route");

const req = (method: string, body?: unknown) =>
  new Request("http://localhost/api", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const post = (body: unknown) => req("POST", body);
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  state.callerId = null;
  state.roles = {
    pat: ["staff"], // ordinary staff member — no admin tier, no manage_roles
    rm: ["role_manager"], // holds administration.manage_roles via a title
    ga: ["admin", "staff"], // General Admin
    jane: ["student"], // the person being changed
  };
  state.rolePerms = { role_manager: ["administration.manage_roles"] };
  state.permissions = {
    "perm-finance": "finance.view",
    "perm-records": "records_library.manage",
  };
  state.writes = [];
});

const calls: Array<[string, () => Promise<Response>]> = [
  ["change membership role", () => setMembership.POST(post({ user_id: "jane", role: "staff" }))],
  ["add a title", () => grantRole.POST(post({ user_id: "jane", role_name: "dts_leader" }))],
  ["remove a title", () => revokeRole.POST(post({ user_id: "jane", role_name: "student" }))],
  ["make General Admin", () => grantRole.POST(post({ user_id: "jane", role_name: "admin" }))],
  ["remove General Admin", () => revokeRole.POST(post({ user_id: "ga", role_name: "admin" }))],
  ["make Super Admin", () => grantRole.POST(post({ user_id: "jane", role_name: "super_admin" }))],
  [
    "grant a permission",
    () => grantPermission.POST(post({ user_id: "jane", permission_id: "perm-finance" })),
  ],
  [
    "revoke a permission",
    () => revokePermission.POST(post({ user_id: "jane", permission_id: "perm-finance" })),
  ],
  ["mark inactive", () => setUserActive.POST(post({ user_id: "jane", is_active: false }))],
  ["create a role", () => roles.POST(post({ display_name: "Sneaky", permission_ids: [] }))],
  [
    "edit a role",
    () => roleById.PATCH(req("PATCH", { display_name: "X", permission_ids: [] }), params("r1")),
  ],
  ["delete a role", () => roleById.DELETE(req("DELETE"), params("r1"))],
];

describe("access-changing routes refuse signed-out callers", () => {
  it.each(calls)("%s → 401, nothing written", async (_label, call) => {
    state.callerId = null;
    const res = await call();
    expect(res.status).toBe(401);
    expect(state.writes).toEqual([]);
  });
});

describe("access-changing routes refuse an ordinary staff member", () => {
  it.each(calls)("%s → 403, nothing written", async (_label, call) => {
    state.callerId = "pat";
    const res = await call();
    expect(res.status).toBe(403);
    expect(state.writes).toEqual([]);
  });
});

describe("a manage_roles holder stays below the admin tiers", () => {
  beforeEach(() => {
    state.callerId = "rm";
  });

  it.each([
    ["make General Admin", () => grantRole.POST(post({ user_id: "jane", role_name: "admin" }))],
    ["remove General Admin", () => revokeRole.POST(post({ user_id: "ga", role_name: "admin" }))],
    ["make Super Admin", () => grantRole.POST(post({ user_id: "jane", role_name: "super_admin" }))],
    ["change membership role", () => setMembership.POST(post({ user_id: "jane", role: "staff" }))],
    [
      "grant a permission directly",
      () => grantPermission.POST(post({ user_id: "jane", permission_id: "perm-finance" })),
    ],
  ] as Array<[string, () => Promise<Response>]>)("%s → 403", async (_label, call) => {
    const res = await call();
    expect(res.status).toBe(403);
    expect(state.writes).toEqual([]);
  });
});

describe("a General Admin keeps the Super-Admin-only grants out of reach", () => {
  beforeEach(() => {
    state.callerId = "ga";
  });

  it("cannot grant Super Admin", async () => {
    expect((await grantRole.POST(post({ user_id: "jane", role_name: "super_admin" }))).status).toBe(403);
  });

  it("cannot grant the Records Library permission", async () => {
    const res = await grantPermission.POST(post({ user_id: "jane", permission_id: "perm-records" }));
    expect(res.status).toBe(403);
    expect(state.writes).toEqual([]);
  });

  it("can still make the changes the UI offers them", async () => {
    expect((await setMembership.POST(post({ user_id: "jane", role: "staff" }))).status).toBe(200);
    expect(
      (await grantPermission.POST(post({ user_id: "jane", permission_id: "perm-finance" }))).status
    ).toBe(200);
    expect((await grantRole.POST(post({ user_id: "jane", role_name: "admin" }))).status).toBe(200);
  });
});
