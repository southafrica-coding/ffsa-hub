import { beforeEach, describe, expect, it, vi } from "vitest";

const revoked: string[] = [];

vi.mock("@/lib/schools/school-leader-role", () => ({
  revokeSchoolLeaderRoleIfOrphaned: async (_admin: unknown, userId: string) => {
    revoked.push(userId);
  },
}));

import { switchPersonToProgramStaff } from "./program-staff";

const PROGRAM = "5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48";
const OTHER = "other-program";

type Row = Record<string, unknown>;

function memory(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = structuredClone(seed);
  return {
    tables,
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let action: "select" | "upsert" | "delete" = "select";
      let payload: Row | null = null;
      const run = () => {
        const rows = tables[table] ?? [];
        const matched = () => rows.filter((row) => filters.every((fn) => fn(row)));
        if (action === "upsert" && payload) {
          const exists = rows.some(
            (row) => row.program_id === payload?.program_id && row.user_id === payload?.user_id
          );
          if (!exists) rows.push({ id: `staff-${rows.length + 1}`, ...payload });
          tables[table] = rows;
          return { data: null, error: null };
        }
        if (action === "delete") {
          tables[table] = rows.filter((row) => !filters.every((fn) => fn(row)));
          return { data: null, error: null };
        }
        return { data: matched(), error: null };
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {
        select: () => q,
        eq: (col: string, value: unknown) => {
          filters.push((row) => {
            if (col === "roles.name") {
              const role = row.roles as { name?: string } | undefined;
              return role?.name === value;
            }
            return row[col] === value;
          });
          return q;
        },
        in: (col: string, values: unknown[]) => {
          filters.push((row) => values.includes(row[col]));
          return q;
        },
        limit: () => q,
        upsert: (row: Row) => {
          action = "upsert";
          payload = row;
          return q;
        },
        delete: () => {
          action = "delete";
          return q;
        },
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(run()).then(resolve),
      };
      return q;
    },
  };
}

function seed() {
  return memory({
    user_roles: [
      { user_id: "leader", roles: { name: "program_leader" } },
      { user_id: "boss", roles: { name: "super_admin" } },
    ],
    program_leaders: [{ id: "pl1", program_id: PROGRAM, user_id: "leader" }],
    program_staff: [],
    user_permissions: [
      {
        id: "g-scoped",
        user_id: "leader",
        scope_type: "program",
        scope_id: PROGRAM,
        permissions: { key: "schools.assignable_as_contact" },
      },
      {
        id: "g-manage",
        user_id: "leader",
        scope_type: "program",
        scope_id: PROGRAM,
        permissions: { key: "schools.manage" },
      },
      {
        id: "g-finance",
        user_id: "leader",
        scope_type: "program",
        scope_id: PROGRAM,
        permissions: { key: "finance.view" },
      },
      {
        id: "g-global",
        user_id: "leader",
        scope_type: null,
        scope_id: null,
        permissions: { key: "schools.manage" },
      },
      {
        id: "g-other",
        user_id: "leader",
        scope_type: "program",
        scope_id: OTHER,
        permissions: { key: "schools.view_applications" },
      },
    ],
  });
}

describe("switchPersonToProgramStaff", () => {
  beforeEach(() => {
    revoked.length = 0;
  });

  it("adds staff, drops this program's leader row and schools grants, and keeps everything else", async () => {
    const db = seed();
    const first = await switchPersonToProgramStaff(db, PROGRAM, "leader", "actor");
    expect(first.error).toBeNull();
    expect(first.data).toEqual({
      removedLeader: true,
      removedPermissionKeys: ["schools.assignable_as_contact", "schools.manage"],
    });
    expect(revoked).toEqual(["leader"]);
    expect(db.tables.program_staff).toEqual([
      expect.objectContaining({ program_id: PROGRAM, user_id: "leader", added_by: "actor" }),
    ]);
    expect(db.tables.program_leaders).toEqual([]);
    expect(db.tables.user_permissions.map((row) => row.id).sort()).toEqual(
      ["g-finance", "g-global", "g-other"].sort()
    );
    expect(db.tables.user_roles.map((row) => row.user_id)).toContain("leader");

    const second = await switchPersonToProgramStaff(db, PROGRAM, "leader", "actor");
    expect(second.error).toBeNull();
    expect(second.data).toEqual({ removedLeader: false, removedPermissionKeys: [] });
    expect(db.tables.program_staff).toHaveLength(1);
  });

  it("refuses a super admin and changes nothing", async () => {
    const db = seed();
    const result = await switchPersonToProgramStaff(db, PROGRAM, "boss", "actor");
    expect(result.error?.message).toBe("Refusing to switch a super admin");
    expect(db.tables.program_staff).toEqual([]);
    expect(db.tables.program_leaders).toHaveLength(1);
    expect(revoked).toEqual([]);
  });
});
