import { describe, expect, it } from "vitest";
import {
  fetchAssignableContacts,
  NOT_ASSIGNABLE_CONTACT_ERROR,
  unassignableContactError,
  userIsAssignableContact,
} from "./assignable-contacts";

// program_leaders (migration 145) has no status column. The Leaders tab
// inserts a row to add a leader and deletes it to remove one. "Active" is
// that row plus a user who has not been deactivated (users.is_active).

const PROGRAM_A = "program-a";
const PROGRAM_B = "program-b";

type User = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  email: string | null;
  is_active: boolean | null;
};

type Row = Record<string, unknown>;

function user(id: string, first: string, isActive: boolean | null = true): User {
  return {
    id,
    first_name: first,
    last_name: "Person",
    preferred_name: null,
    email: `${id}@example.com`,
    is_active: isActive,
  };
}

const amy = user("amy", "Amy"); // active leader of A
const ben = user("ben", "Ben"); // assignable_as_contact on A
const cara = user("cara", "Cara"); // super admin
const dee = user("dee", "Dee"); // leader of A AND assignable_as_contact on A
const evan = user("evan", "Evan"); // active leader of B only
const fran = user("fran", "Fran", false); // deactivated leader of A
const gina = user("gina", "Gina", false); // deactivated super admin
const hank = user("hank", "Hank"); // schools.manage only
const ivy = user("ivy", "Ivy"); // unscoped assignable_as_contact
const jade = user("jade", "Jade"); // assignable_as_contact on B
const kai = user("kai", "Kai", false); // deactivated permission holder on A
const lea = user("lea", "Lea"); // active staff of A
const moe = user("moe", "Moe", false); // deactivated staff of A
const nia = user("nia", "Nia"); // active staff of B only

const users = [amy, ben, cara, dee, evan, fran, gina, hank, ivy, jade, kai, lea, moe, nia];
const byId = new Map(users.map((u) => [u.id, u]));

function permission(
  userId: string,
  key: string,
  scope: { type: string; id: string } | null
): Row {
  return {
    user_id: userId,
    scope_type: scope?.type ?? null,
    scope_id: scope?.id ?? null,
    permissions: { key },
    users: byId.get(userId),
  };
}

function role(userId: string, name: string): Row {
  return { user_id: userId, roles: { name }, users: byId.get(userId) };
}

function leader(userId: string, programId: string, asArray = false): Row {
  const person = byId.get(userId);
  return {
    user_id: userId,
    program_id: programId,
    users: asArray ? [person] : person,
  };
}

function client() {
  const tables: Record<string, Row[]> = {
    user_permissions: [
      permission("ben", "schools.assignable_as_contact", { type: "program", id: PROGRAM_A }),
      permission("dee", "schools.assignable_as_contact", { type: "program", id: PROGRAM_A }),
      permission("jade", "schools.assignable_as_contact", { type: "program", id: PROGRAM_B }),
      permission("kai", "schools.assignable_as_contact", { type: "program", id: PROGRAM_A }),
      permission("ivy", "schools.assignable_as_contact", null),
      permission("hank", "schools.manage", null),
      permission("hank", "schools.manage", { type: "program", id: PROGRAM_A }),
    ],
    user_roles: [role("cara", "super_admin"), role("gina", "super_admin"), role("hank", "staff")],
    // No row for a removed leader — removal deletes the membership.
    program_leaders: [
      leader("amy", PROGRAM_A),
      leader("dee", PROGRAM_A, true),
      leader("fran", PROGRAM_A),
      leader("evan", PROGRAM_B),
    ],
    program_staff: [
      leader("lea", PROGRAM_A),
      leader("moe", PROGRAM_A),
      leader("nia", PROGRAM_B),
      leader("dee", PROGRAM_A),
    ],
  };

  return {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      const q = {
        select: () => q,
        eq: (col: string, value: unknown) => {
          filters.push((row) => {
            const current = col.split(".").reduce<unknown>((acc, key) => {
              if (acc && typeof acc === "object") return (acc as Row)[key];
              return undefined;
            }, row);
            return current === value;
          });
          return q;
        },
        then: (resolve: (value: unknown) => unknown) => {
          const data = (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      };
      return q;
    },
  };
}

const db = client();

describe("fetchAssignableContacts", () => {
  it("lists an active leader, a permission holder, and a super admin for their program", async () => {
    const listed = await fetchAssignableContacts(db, PROGRAM_A);
    expect(listed.map((c) => c.id)).toEqual(["amy", "ben", "cara", "dee", "lea"]);
  });

  it("does not list that leader for a different program", async () => {
    const listed = await fetchAssignableContacts(db, PROGRAM_B);
    expect(listed.map((c) => c.id)).toEqual(["cara", "evan", "jade", "nia"]);
    expect(listed.map((c) => c.id)).not.toContain("amy");
  });

  it("drops a deactivated leader, a removed leader, and a deactivated permission holder or super admin", async () => {
    const ids = (await fetchAssignableContacts(db, PROGRAM_A)).map((c) => c.id);
    expect(ids).not.toContain("fran");
    expect(ids).not.toContain("gina");
    expect(ids).not.toContain("kai");
    // Removed leaders have no program_leaders row. A former leader with no
    // other grant is absent.
    expect(ids).not.toContain("evan");
    expect(ids).not.toContain("moe");
    expect(ids).not.toContain("nia");
  });

  it("does not treat other schools permissions or an unscoped grant as assignable", async () => {
    const ids = (await fetchAssignableContacts(db, PROGRAM_A)).map((c) => c.id);
    expect(ids).not.toContain("hank");
    expect(ids).not.toContain("ivy");
  });

  it("lists someone who is both a leader and a permission holder once", async () => {
    const listed = await fetchAssignableContacts(db, PROGRAM_A);
    expect(listed.filter((c) => c.id === "dee")).toHaveLength(1);
  });
});

describe("userIsAssignableContact", () => {
  it("accepts an active leader only for the program they lead", async () => {
    expect(await userIsAssignableContact(db, PROGRAM_A, "amy")).toBe(true);
    expect(await userIsAssignableContact(db, PROGRAM_B, "amy")).toBe(false);
    expect(await userIsAssignableContact(db, PROGRAM_A, "evan")).toBe(false);
    expect(await userIsAssignableContact(db, PROGRAM_B, "evan")).toBe(true);
  });

  it("rejects a deactivated leader and a leader who was removed", async () => {
    expect(await userIsAssignableContact(db, PROGRAM_A, "fran")).toBe(false);
    expect(await userIsAssignableContact(db, PROGRAM_A, "removed-leader")).toBe(false);
  });

  it("accepts active staff only for the program they staff", async () => {
    expect(await userIsAssignableContact(db, PROGRAM_A, "lea")).toBe(true);
    expect(await userIsAssignableContact(db, PROGRAM_B, "lea")).toBe(false);
    expect(await userIsAssignableContact(db, PROGRAM_A, "nia")).toBe(false);
    expect(await userIsAssignableContact(db, PROGRAM_B, "nia")).toBe(true);
    expect(await userIsAssignableContact(db, PROGRAM_A, "moe")).toBe(false);
  });

  it("still accepts permission holders and super admins", async () => {
    expect(await userIsAssignableContact(db, PROGRAM_A, "ben")).toBe(true);
    expect(await userIsAssignableContact(db, PROGRAM_B, "ben")).toBe(false);
    expect(await userIsAssignableContact(db, PROGRAM_A, "cara")).toBe(true);
    expect(await userIsAssignableContact(db, PROGRAM_B, "cara")).toBe(true);
    expect(await userIsAssignableContact(db, PROGRAM_A, "dee")).toBe(true);
  });

  it("rejects a deactivated super admin and a manage-only user", async () => {
    expect(await userIsAssignableContact(db, PROGRAM_A, "gina")).toBe(false);
    expect(await userIsAssignableContact(db, PROGRAM_A, "hank")).toBe(false);
    expect(await userIsAssignableContact(db, PROGRAM_A, "ivy")).toBe(false);
  });
});

describe("unassignableContactError", () => {
  it("allows clearing and rejects someone who is not eligible", async () => {
    expect(await unassignableContactError(db, PROGRAM_A, null)).toBeNull();
    expect(await unassignableContactError(db, PROGRAM_A, "amy")).toBeNull();
    expect(await unassignableContactError(db, PROGRAM_B, "amy")).toBe(NOT_ASSIGNABLE_CONTACT_ERROR);
  });
});
