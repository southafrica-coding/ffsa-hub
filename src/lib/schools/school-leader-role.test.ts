import { describe, expect, it } from "vitest";
import {
  ensureSchoolLeaderRole,
  revokeSchoolLeaderRoleIfOrphaned,
} from "./school-leader-role";

// A tiny in-memory stand-in for the service-role client: enough of the
// query builder for roles / user_roles / program_leaders.

type Row = Record<string, unknown>;

function fakeAdmin(seed: {
  roles?: Row[];
  user_roles?: Row[];
  program_leaders?: Row[];
}) {
  const db: Record<string, Row[]> = {
    roles: seed.roles ?? [{ id: "role-sl", name: "school_leader" }],
    user_roles: seed.user_roles ?? [],
    program_leaders: seed.program_leaders ?? [],
  };

  function builder(table: string) {
    const filters: ((r: Row) => boolean)[] = [];
    let op: "select" | "delete" = "select";
    const rows = () => db[table].filter((r) => filters.every((f) => f(r)));
    const q = {
      select: () => q,
      eq: (col: string, v: unknown) => (filters.push((r) => r[col] === v), q),
      is: (col: string, v: unknown) => (filters.push((r) => (r[col] ?? null) === v), q),
      limit: (n: number) => Promise.resolve({ data: rows().slice(0, n), error: null }),
      single: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
      delete: () => ((op = "delete"), q),
      insert: (row: Row) => {
        db[table].push({ scope_type: null, ...row });
        return Promise.resolve({ error: null });
      },
      then: (resolve: (v: unknown) => void) => {
        if (op === "delete") {
          const doomed = new Set(rows());
          db[table] = db[table].filter((r) => !doomed.has(r));
        }
        resolve({ error: null });
      },
    };
    return q;
  }

  return { db, client: { from: builder } };
}

const roleRows = (db: Record<string, Row[]>, userId: string) =>
  db.user_roles.filter((r) => r.user_id === userId && r.role_id === "role-sl");

describe("ensureSchoolLeaderRole", () => {
  it("grants the unscoped role when it is missing", async () => {
    const { db, client } = fakeAdmin({});
    await ensureSchoolLeaderRole(client, "u1", "admin-1");
    expect(roleRows(db, "u1")).toEqual([
      { scope_type: null, user_id: "u1", role_id: "role-sl", assigned_by: "admin-1" },
    ]);
  });

  it("does not duplicate an existing grant", async () => {
    const { db, client } = fakeAdmin({
      user_roles: [{ id: "x", user_id: "u1", role_id: "role-sl", scope_type: null }],
    });
    await ensureSchoolLeaderRole(client, "u1", "admin-1");
    expect(roleRows(db, "u1")).toHaveLength(1);
  });

  it("is a no-op before migration 292 creates the role", async () => {
    const { db, client } = fakeAdmin({ roles: [] });
    await ensureSchoolLeaderRole(client, "u1", "admin-1");
    expect(db.user_roles).toHaveLength(0);
  });
});

describe("revokeSchoolLeaderRoleIfOrphaned", () => {
  const held = { id: "x", user_id: "u1", role_id: "role-sl", scope_type: null };

  it("keeps the role while they still lead another program", async () => {
    const { db, client } = fakeAdmin({
      user_roles: [held],
      program_leaders: [{ id: "pl2", user_id: "u1", program_id: "p2" }],
    });
    await revokeSchoolLeaderRoleIfOrphaned(client, "u1");
    expect(roleRows(db, "u1")).toHaveLength(1);
  });

  it("revokes the role once they lead no program", async () => {
    const other = { id: "y", user_id: "u2", role_id: "role-sl", scope_type: null };
    const { db, client } = fakeAdmin({ user_roles: [held, other] });
    await revokeSchoolLeaderRoleIfOrphaned(client, "u1");
    expect(roleRows(db, "u1")).toHaveLength(0);
    expect(roleRows(db, "u2")).toHaveLength(1);
  });

  it("leaves their other roles alone", async () => {
    const staff = { id: "z", user_id: "u1", role_id: "role-staff", scope_type: null };
    const { db, client } = fakeAdmin({ user_roles: [held, staff] });
    await revokeSchoolLeaderRoleIfOrphaned(client, "u1");
    expect(db.user_roles).toEqual([staff]);
  });
});
