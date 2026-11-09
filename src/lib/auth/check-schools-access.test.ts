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
      resolve: (q) =>
        q.table === "user_roles"
          ? { data: [{ user_id: USER, scope_id: null, roles: { name: "program_leader" } }] }
          : { data: [] },
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
      resolve: (q) => (q.table === "program_staff" ? { data: [{ id: "ps", program_id: PROGRAM_A }] } : { data: [] }),
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
        if (q.table === "user_permissions") {
          return {
            data: [{ scope_type: null, permissions: { key: "schools.manage" } }],
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
});
