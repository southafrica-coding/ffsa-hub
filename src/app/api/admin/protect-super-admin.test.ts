import { beforeEach, describe, expect, it, vi } from "vitest";

// Every route that changes someone's account standing must refuse a General
// Admin acting on a Super Admin — and refuse BEFORE writing anything.
//
// The routes run against an in-memory stand-in for Supabase: user_roles is a
// map of user → role names, every insert/update/delete is recorded in
// `writes`, and anything else reads as empty.

const state = vi.hoisted(() => {
  type Filters = Record<string, unknown[]>;
  const state = {
    callerId: "ga",
    roles: {} as Record<string, string[]>,
    users: {} as Record<string, Record<string, unknown>>,
    writes: [] as string[],
    client(authId?: string) {
      return {
        auth: {
          getUser: async () => ({ data: { user: authId ? { id: authId } : null } }),
          admin: {
            deleteUser: async () => {
              state.writes.push("auth.deleteUser");
              return { error: null };
            },
            updateUserById: async () => {
              state.writes.push("auth.updateUserById");
              return { error: null };
            },
          },
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
                    roles: { name: n, display_name: n },
                  }))
              );
            }
            if (table === "roles") {
              const names = (filters.name ?? filters.id) as string[] | undefined;
              return (names ?? []).map((n) => ({ id: n, name: n }));
            }
            if (table === "users") {
              const ids = (filters.id as string[]) ?? [];
              return ids
                .filter((id) => state.users[id])
                .map((id) => ({ id, ...state.users[id] }));
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
vi.mock("@/services/users", () => ({
  approveUser: vi.fn(async () => {
    state.writes.push("approveUser");
    return { data: {}, error: null };
  }),
}));
vi.mock("@/services/user-merge", () => ({
  previewUserMerge: vi.fn(async () => ({ preview: {} })),
  dryRunMerge: vi.fn(async () => ({ report: {} })),
  mergeUsers: vi.fn(async () => {
    state.writes.push("mergeUsers");
    return { report: {} };
  }),
  retireLoserAuthUser: vi.fn(async () => ({ warning: null })),
}));

const setUserActive = await import("./set-user-active/route");
const deleteUser = await import("./delete-user/route");
const convert = await import("./convert-to-community/route");
const setMembership = await import("./set-membership-role/route");
const grantRole = await import("./grant-role/route");
const revokeRole = await import("./revoke-role/route");
const approveUser = await import("./approve-user/route");
const mergeUsers = await import("./merge-users/route");
const userProfile = await import("@/app/api/users/[id]/route");

const post = (body: unknown) =>
  new Request("http://localhost/api", { method: "POST", body: JSON.stringify(body) });
const patch = (body: unknown) =>
  new Request("http://localhost/api", { method: "PATCH", body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  state.callerId = "ga";
  state.roles = {
    boss: ["super_admin", "staff"], // the Super Admin being acted on
    sa: ["super_admin"], // a second Super Admin
    ga: ["admin", "staff"], // a General Admin
    pat: ["staff"], // an ordinary staff member
  };
  state.users = {
    boss: { email: "boss@ffsa.test", job_title: "Director", is_active: true },
    pat: { email: "pat@ffsa.test", job_title: null, is_active: true },
    // Callers are looked up for users.is_active. NULL/absent would be active
    // too; a missing row is not.
    ga: { is_active: true },
    sa: { is_active: true },
  };
  state.writes = [];
});

describe("a General Admin cannot change a Super Admin's account", () => {
  const cases: Array<[string, () => Promise<Response>]> = [
    ["deactivate", () => setUserActive.POST(post({ user_id: "boss", is_active: false }))],
    ["delete", () => deleteUser.POST(post({ user_id: "boss" }))],
    ["convert to community", () => convert.POST(post({ user_id: "boss", keep: {} }))],
    [
      "open the convert picker",
      () => convert.GET(new Request("http://localhost/api?user_id=boss")),
    ],
    ["change membership role", () => setMembership.POST(post({ user_id: "boss", role: "community" }))],
    ["add a title", () => grantRole.POST(post({ user_id: "boss", role_name: "staff" }))],
    ["remove a title", () => revokeRole.POST(post({ user_id: "boss", role_name: "staff" }))],
    ["make General Admin", () => grantRole.POST(post({ user_id: "boss", role_name: "admin" }))],
    ["remove General Admin", () => revokeRole.POST(post({ user_id: "boss", role_name: "admin" }))],
    ["approve / set job title", () => approveUser.POST(post({ user_id: "boss", job_title: "Intern" }))],
    [
      "merge them away",
      () => mergeUsers.POST(post({ winnerId: "pat", loserId: "boss", mode: "merge" })),
    ],
    [
      "merge into them",
      () => mergeUsers.POST(post({ winnerId: "boss", loserId: "pat", mode: "preview" })),
    ],
    ["change job title", () => userProfile.PATCH(patch({ job_title: "Intern" }), params("boss"))],
    [
      "change login email",
      () => userProfile.PATCH(patch({ email: "evil@ffsa.test" }), params("boss")),
    ],
  ];

  it.each(cases)("%s → 403, nothing written", async (_label, call) => {
    const res = await call();
    expect(res.status).toBe(403);
    expect(state.writes).toEqual([]);
  });

  it("still cannot grant or remove Super Admin itself", async () => {
    expect((await grantRole.POST(post({ user_id: "pat", role_name: "super_admin" }))).status).toBe(403);
    expect((await revokeRole.POST(post({ user_id: "boss", role_name: "super_admin" }))).status).toBe(403);
    expect(state.writes).toEqual([]);
  });

  it("can still fix ordinary profile details, re-sending the same title and email", async () => {
    const res = await userProfile.PATCH(
      patch({ phone: "+27 82 000 0000", job_title: "Director", email: "BOSS@ffsa.test" }),
      params("boss")
    );
    expect(res.status).toBe(200);
    expect(state.writes).toEqual(["users.update", "audit_logs.insert"]);
  });

  it("can still reactivate an inactive Super Admin", async () => {
    const res = await setUserActive.POST(post({ user_id: "boss", is_active: true }));
    expect(res.status).toBe(200);
  });
});

describe("everyone else is unaffected", () => {
  it("a General Admin can still manage a non-super-admin", async () => {
    expect((await setUserActive.POST(post({ user_id: "pat", is_active: false }))).status).toBe(200);
    expect((await setMembership.POST(post({ user_id: "pat", role: "community" }))).status).toBe(200);
    expect((await grantRole.POST(post({ user_id: "pat", role_name: "admin" }))).status).toBe(200);
    expect((await userProfile.PATCH(patch({ job_title: "Lead" }), params("pat"))).status).toBe(200);
  });

  it("a Super Admin can manage another Super Admin", async () => {
    state.callerId = "sa";
    expect((await setUserActive.POST(post({ user_id: "boss", is_active: false }))).status).toBe(200);
    expect((await setMembership.POST(post({ user_id: "boss", role: "community" }))).status).toBe(200);
    expect((await revokeRole.POST(post({ user_id: "boss", role_name: "staff" }))).status).toBe(200);
    expect((await userProfile.PATCH(patch({ job_title: "Elder" }), params("boss"))).status).toBe(200);
  });
});
