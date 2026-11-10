import { describe, expect, it } from "vitest";
import {
  userCanDeleteApplication,
  userCanManageApplications,
  userCanManageProgram,
} from "@/lib/auth/check-schools-access";
import { createFakeSupabase, filterValue, type FakeQuery } from "@/lib/testing/fake-supabase";

// Migration 312's program_leader branch, matched in the app layer:
//   scope_type IS NULL
//   OR (scope_type = 'program' AND scope_id = target_program_id)
// Team and event scopes grant no program. A call with no program id is the
// global check, so only unscoped roles (and the other global sources) count.

const PROGRAM_A = "11111111-1111-4111-8111-111111111111";
const PROGRAM_B = "22222222-2222-4222-8222-222222222222";
const USER = "user-1";

type RoleSeed = {
  name: string;
  scope_type: string | null;
  scope_id: string | null;
};

type PermSeed = {
  key: string;
  scope_type: string | null;
  scope_id: string | null;
};

function matchesFilters(q: FakeQuery, row: Record<string, unknown>): boolean {
  for (const f of q.filters) {
    const column = f.args[0];
    if (typeof column !== "string") continue;
    if (column === "user_id" && f.op === "eq" && row.user_id !== f.args[1]) return false;
    if (column === "program_id" && f.op === "eq" && row.program_id !== f.args[1]) return false;
    if (column === "scope_type" && f.op === "eq" && row.scope_type !== f.args[1]) return false;
    if (column === "scope_type" && f.op === "is" && f.args[1] === null && row.scope_type != null) {
      return false;
    }
    if (column === "scope_id" && f.op === "eq" && row.scope_id !== f.args[1]) return false;
    if (column === "roles.name" && f.op === "in") {
      const names = f.args[1] as string[];
      const roles = row.roles as { name: string } | undefined;
      if (!roles || !names.includes(roles.name)) return false;
    }
    if (column === "permissions.key" && f.op === "in") {
      const keys = f.args[1] as string[];
      const permissions = row.permissions as { key: string } | undefined;
      if (!permissions || !keys.includes(permissions.key)) return false;
    }
  }
  return true;
}

function applyLimit<T>(q: FakeQuery, rows: T[]): T[] {
  const limit = q.filters.find((f) => f.op === "limit");
  if (!limit) return rows;
  const n = Number(limit.args[0]);
  return Number.isFinite(n) ? rows.slice(0, n) : rows;
}

function world(seed: { roles?: RoleSeed[]; perms?: PermSeed[]; leaderOf?: string[] }) {
  const roleRows = (seed.roles ?? []).map((role) => ({
    user_id: USER,
    scope_type: role.scope_type,
    scope_id: role.scope_id,
    roles: { name: role.name },
  }));
  const permRows = (seed.perms ?? []).map((perm) => ({
    user_id: USER,
    scope_type: perm.scope_type,
    scope_id: perm.scope_id,
    permissions: { key: perm.key },
  }));
  const leaderRows = (seed.leaderOf ?? []).map((programId) => ({
    id: `leader-${programId}`,
    user_id: USER,
    program_id: programId,
  }));

  return createFakeSupabase({
    resolve: (q) => {
      if (q.table === "users") return { data: { is_active: true } };
      if (q.table === "user_roles") return { data: applyLimit(q, roleRows.filter((row) => matchesFilters(q, row))) };
      if (q.table === "user_permissions") {
        return { data: applyLimit(q, permRows.filter((row) => matchesFilters(q, row))) };
      }
      if (q.table === "program_leaders") {
        return { data: applyLimit(q, leaderRows.filter((row) => matchesFilters(q, row))) };
      }
      return { data: [] };
    },
  });
}

async function access(seed: { roles?: RoleSeed[]; perms?: PermSeed[]; leaderOf?: string[] }) {
  const f = world(seed);
  const [global, programA, programB, appsA, appsB] = await Promise.all([
    userCanManageApplications(f.client, USER),
    userCanManageProgram(f.client, USER, PROGRAM_A),
    userCanManageProgram(f.client, USER, PROGRAM_B),
    userCanManageApplications(f.client, USER, PROGRAM_A),
    userCanManageApplications(f.client, USER, PROGRAM_B),
  ]);
  const roleQuery = f.queries.find((q) => q.table === "user_roles");
  return { global, programA, programB, appsA, appsB, roleQuery, queries: f.queries };
}

describe("program_leader role scope (migration 312)", () => {
  it("reads scope_type and scope_id off user_roles", async () => {
    const { roleQuery } = await access({
      roles: [{ name: "program_leader", scope_type: "program", scope_id: PROGRAM_A }],
    });
    expect(roleQuery?.columns).toContain("scope_type");
    expect(roleQuery?.columns).toContain("scope_id");
    expect(filterValue(roleQuery!, "eq", "user_id")).toBe(USER);
  });

  it("counts a program-scoped role for that program only, never as global", async () => {
    const got = await access({
      roles: [{ name: "program_leader", scope_type: "program", scope_id: PROGRAM_A }],
    });
    expect(got.global).toBe(false);
    expect(got.appsA).toBe(true);
    expect(got.appsB).toBe(false);
    expect(got.programA).toBe(true);
    expect(got.programB).toBe(false);
  });

  it("does not treat a missing scope_type as unscoped", async () => {
    const f = createFakeSupabase({
      resolve: (q) => {
        if (q.table === "users") return { data: { is_active: true } };
        if (q.table === "user_roles") {
          return { data: [{ user_id: USER, scope_id: null, roles: { name: "program_leader" } }] };
        }
        return { data: [] };
      },
    });
    expect(await userCanManageApplications(f.client, USER)).toBe(false);
    expect(await userCanManageApplications(f.client, USER, PROGRAM_A)).toBe(false);
    expect(await userCanManageProgram(f.client, USER, PROGRAM_A)).toBe(false);
  });

  it("keeps an unscoped role (scope_type null) global, even if scope_id is set", async () => {
    const got = await access({
      roles: [{ name: "program_leader", scope_type: null, scope_id: PROGRAM_A }],
    });
    expect(got.global).toBe(true);
    expect(got.programA).toBe(true);
    expect(got.programB).toBe(true);
  });

  it("grants nothing for a team-scoped role", async () => {
    const got = await access({
      roles: [{ name: "program_leader", scope_type: "team", scope_id: "team-1" }],
    });
    expect(got.global).toBe(false);
    expect(got.appsA).toBe(false);
    expect(got.programA).toBe(false);
    expect(got.programB).toBe(false);
  });

  it("grants nothing for an event-scoped role", async () => {
    const got = await access({
      roles: [{ name: "program_leader", scope_type: "event", scope_id: "event-1" }],
    });
    expect(got.global).toBe(false);
    expect(got.appsA).toBe(false);
    expect(got.programA).toBe(false);
    expect(got.programB).toBe(false);
  });

  it("does not treat a program scope with a null scope_id as global or as a match", async () => {
    const got = await access({
      roles: [{ name: "program_leader", scope_type: "program", scope_id: null }],
    });
    expect(got.global).toBe(false);
    expect(got.programA).toBe(false);
    expect(got.programB).toBe(false);
  });

  it("still counts an unscoped role when a team-scoped row is returned first", async () => {
    const got = await access({
      roles: [
        { name: "program_leader", scope_type: "team", scope_id: "team-1" },
        { name: "program_leader", scope_type: null, scope_id: null },
      ],
    });
    expect(got.global).toBe(true);
    expect(got.programB).toBe(true);
  });
});

describe("sources migration 312 leaves unchanged", () => {
  it("lets admin and super_admin manage every program, including a scoped admin row", async () => {
    const admin = await access({
      roles: [{ name: "admin", scope_type: null, scope_id: null }],
    });
    expect(admin.global).toBe(true);
    expect(admin.programA).toBe(true);
    expect(admin.programB).toBe(true);

    const scopedAdmin = await access({
      roles: [{ name: "admin", scope_type: "program", scope_id: PROGRAM_A }],
    });
    expect(scopedAdmin.global).toBe(true);
    expect(scopedAdmin.programB).toBe(true);

    const superAdmin = await access({
      roles: [{ name: "super_admin", scope_type: "event", scope_id: "event-1" }],
    });
    expect(superAdmin.global).toBe(true);
    expect(superAdmin.programA).toBe(true);
  });

  it("lets a program_leaders row manage that program only, and not the global check", async () => {
    const got = await access({ leaderOf: [PROGRAM_A] });
    expect(got.global).toBe(false);
    expect(got.appsA).toBe(false);
    expect(got.programA).toBe(true);
    expect(got.programB).toBe(false);
    expect(got.queries.map((q) => q.table)).not.toContain("program_staff");
  });

  it("lets each unscoped schools.* management grant stay global", async () => {
    for (const key of ["schools.manage", "schools.approve_applications", "schools.manage_enrollments"]) {
      const got = await access({
        perms: [{ key, scope_type: null, scope_id: null }],
      });
      expect(got.global, key).toBe(true);
      expect(got.programA, key).toBe(true);
      expect(got.programB, key).toBe(true);
    }
  });

  it("lets a program-scoped schools.* grant cover that program only", async () => {
    for (const key of ["schools.manage", "schools.approve_applications", "schools.manage_enrollments"]) {
      const got = await access({
        perms: [{ key, scope_type: "program", scope_id: PROGRAM_A }],
      });
      expect(got.global, key).toBe(false);
      expect(got.appsA, key).toBe(false);
      expect(got.programA, key).toBe(true);
      expect(got.programB, key).toBe(false);
    }
  });

  it("ignores a schools.* grant scoped to a team or an event", async () => {
    const team = await access({
      perms: [{ key: "schools.manage", scope_type: "team", scope_id: "team-1" }],
    });
    expect(team.global).toBe(false);
    expect(team.programA).toBe(false);

    const event = await access({
      perms: [{ key: "schools.approve_applications", scope_type: "event", scope_id: "event-1" }],
    });
    expect(event.global).toBe(false);
    expect(event.programA).toBe(false);
  });

  it("does not treat a program_staff row as management", async () => {
    const f = createFakeSupabase({
      resolve: (q) => {
        if (q.table === "users") return { data: { is_active: true } };
        if (q.table === "program_staff") return { data: [{ id: "ps", program_id: PROGRAM_A }] };
        return { data: [] };
      },
    });
    expect(await userCanManageApplications(f.client, USER)).toBe(false);
    expect(await userCanManageProgram(f.client, USER, PROGRAM_A)).toBe(false);
    expect(f.queries.map((q) => q.table)).not.toContain("program_staff");
  });
});

describe("userCanDeleteApplication expiry gate", () => {
  function client(expired: boolean, canAccess: boolean) {
    return createFakeSupabase({
      resolve: (q) => {
        if (q.table === "rpc:program_end_date") return { data: expired ? "2020-01-01" : null };
        if (q.table === "rpc:program_applications_expired") return { data: expired };
        if (q.table === "rpc:can_access_expired_applications") return { data: canAccess };
        if (q.table === "users") return { data: [{ is_active: true }] };
        if (q.table === "user_permissions") {
          return {
            data: [{ scope_type: null, scope_id: null, permissions: { key: "schools.manage" } }],
          };
        }
        return { data: [] };
      },
    }).client;
  }

  it("ignores a schools.manage grant once the school has expired", async () => {
    expect(await userCanDeleteApplication(client(true, false), USER, PROGRAM_A)).toBe(false);
  });

  it("allows the expired-access set through even without a schools grant", async () => {
    const bare = createFakeSupabase({
      resolve: (q) => {
        if (q.table === "rpc:program_end_date") return { data: "2020-01-01" };
        if (q.table === "rpc:program_applications_expired") return { data: true };
        if (q.table === "rpc:can_access_expired_applications") return { data: true };
        return { data: [] };
      },
    }).client;
    expect(await userCanDeleteApplication(bare, USER, PROGRAM_A)).toBe(true);
  });

  it("uses the normal rule while the school is live", async () => {
    expect(await userCanDeleteApplication(client(false, false), USER, PROGRAM_A)).toBe(true);
  });

  it("denies when an expiry RPC errors, even with schools.manage", async () => {
    const f = createFakeSupabase({
      resolve: (q) => {
        if (q.table === "rpc:program_end_date") return { data: null };
        if (q.table === "rpc:program_applications_expired") {
          return { data: null, error: { message: "down" } };
        }
        if (q.table === "rpc:can_access_expired_applications") return { data: false };
        if (q.table === "user_permissions") {
          return { data: [{ scope_type: null, permissions: { key: "schools.manage" } }] };
        }
        return { data: [] };
      },
    });
    expect(await userCanDeleteApplication(f.client, USER, PROGRAM_A)).toBe(false);
  });

  it("denies a permission lookup error even with an unscoped grant", async () => {
    const f = createFakeSupabase({
      resolve: (q) => {
        if (q.table.startsWith("rpc:")) return { data: false };
        if (q.table === "users") return { data: null, error: { message: "down" } };
        if (q.table === "user_permissions") {
          return { data: [{ scope_type: null, scope_id: null, permissions: { key: "schools.manage" } }] };
        }
        return { data: [] };
      },
    });
    expect(await userCanDeleteApplication(f.client, USER, PROGRAM_A)).toBe(false);
  });

  it("denies when the expiry lookup throws", async () => {
    const f = createFakeSupabase({
      resolve: (q) => {
        if (q.table.startsWith("rpc:")) throw new Error("down");
        if (q.table === "user_permissions") {
          return { data: [{ scope_type: null, permissions: { key: "schools.manage" } }] };
        }
        return { data: [] };
      },
    });
    expect(await userCanDeleteApplication(f.client, USER, PROGRAM_A)).toBe(false);
  });
});

describe("userCanDeleteApplication scope and lookup failures", () => {
  function live(
    resolve: (q: { table: string; columns: string | null }) => { data?: unknown; error?: unknown } | undefined
  ) {
    return createFakeSupabase({
      resolve: (q) => {
        if (q.table === "rpc:program_end_date") return { data: null };
        if (q.table === "rpc:program_applications_expired") return { data: false };
        if (q.table === "rpc:can_access_expired_applications") return { data: false };
        if (q.table === "users") return { data: [{ is_active: true }] };
        return resolve(q) ?? { data: [] };
      },
    }).client;
  }

  it("denies team- and event-scoped grants, direct and via a role", async () => {
    for (const key of ["schools.manage", "schools.approve_applications"] as const) {
      for (const scopeType of ["team", "event"] as const) {
        const direct = live((q) => {
          if (q.table === "user_permissions") {
            return {
              data: [{ scope_type: scopeType, scope_id: `${scopeType}-1`, permissions: { key } }],
            };
          }
          return undefined;
        });
        expect(await userCanDeleteApplication(direct, USER, PROGRAM_A), `direct ${key} ${scopeType}`).toBe(
          false
        );

        const viaRole = live((q) => {
          if (q.table === "user_roles") {
            return {
              data: [{ role_id: "r1", scope_type: scopeType, scope_id: `${scopeType}-1` }],
            };
          }
          if (q.table === "role_permissions") {
            return { data: [{ permissions: { key } }] };
          }
          return undefined;
        });
        expect(await userCanDeleteApplication(viaRole, USER, PROGRAM_A), `role ${key} ${scopeType}`).toBe(
          false
        );
      }
    }
  });

  it("denies when the user_roles lookup errors or throws", async () => {
    const errored = live((q) => {
      if (q.table !== "user_roles") return undefined;
      if (q.columns?.includes("role_id")) return { data: null, error: { message: "down" } };
      return { data: [] };
    });
    expect(await userCanDeleteApplication(errored, USER, PROGRAM_A)).toBe(false);

    const thrown = live((q) => {
      if (q.table === "user_roles" && q.columns?.includes("role_id")) throw new Error("down");
      return undefined;
    });
    expect(await userCanDeleteApplication(thrown, USER, PROGRAM_A)).toBe(false);
  });

  it("denies when the role_permissions lookup errors or throws", async () => {
    const errored = live((q) => {
      if (q.table === "user_roles") {
        return { data: [{ role_id: "r1", scope_type: null, scope_id: null }] };
      }
      if (q.table === "role_permissions") return { data: null, error: { message: "down" } };
      return undefined;
    });
    expect(await userCanDeleteApplication(errored, USER, PROGRAM_A)).toBe(false);

    const thrown = live((q) => {
      if (q.table === "user_roles") {
        return { data: [{ role_id: "r1", scope_type: null, scope_id: null }] };
      }
      if (q.table === "role_permissions") throw new Error("down");
      return undefined;
    });
    expect(await userCanDeleteApplication(thrown, USER, PROGRAM_A)).toBe(false);
  });
});

const PROGRAM = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function activeClient(opts: { active?: boolean | null; error?: boolean; leader?: boolean; admin?: boolean }) {
  return createFakeSupabase({
    resolve: (q) => {
      if (opts.error) return { data: null, error: { message: "boom" } };
      if (q.table === "users") return { data: { is_active: opts.active === undefined ? true : opts.active } };
      if (q.table === "user_roles" && opts.admin) {
        return { data: [{ roles: { name: "admin" } }] };
      }
      if (q.table === "program_leaders" && opts.leader) return { data: [{ id: "pl" }] };
      return { data: [] };
    },
  }).client;
}

describe("userCanManageApplications is_active", () => {
  it("allows an active admin and treats NULL is_active as active", async () => {
    expect(await userCanManageApplications(activeClient({ admin: true }), "u")).toBe(true);
    expect(await userCanManageApplications(activeClient({ admin: true, active: null }), "u")).toBe(true);
  });

  it("denies a deactivated admin", async () => {
    expect(await userCanManageApplications(activeClient({ admin: true, active: false }), "u")).toBe(false);
  });

  it("returns false when the active-account lookup errors", async () => {
    expect(await userCanManageApplications(activeClient({ admin: true, error: true }), "u")).toBe(false);
  });
});

describe("userCanManageProgram is_active", () => {
  it("allows an active program leader and treats NULL is_active as active", async () => {
    expect(await userCanManageProgram(activeClient({ leader: true }), "u", PROGRAM)).toBe(true);
    expect(await userCanManageProgram(activeClient({ leader: true, active: null }), "u", PROGRAM)).toBe(true);
  });

  it("denies a deactivated program leader", async () => {
    expect(await userCanManageProgram(activeClient({ leader: true, active: false }), "u", PROGRAM)).toBe(false);
  });

  it("returns false when the active-account lookup errors", async () => {
    expect(await userCanManageProgram(activeClient({ leader: true, error: true }), "u", PROGRAM)).toBe(false);
  });
});
