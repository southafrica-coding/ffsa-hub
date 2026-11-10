import { describe, expect, it } from "vitest";
import { createFakeSupabase } from "@/lib/testing/fake-supabase";
import {
  ADMIN,
  FINANCE,
  FINANCE_USER,
  INACTIVE_ADMIN,
  LEADER,
  LEADERSHIP,
  LEADERSHIP_MEMBER,
  LEADERSHIP_ROLE,
  MEDIA,
  MEMBER,
  OUTSIDER,
  PLAIN_ADMIN,
  SCOPED_ADMIN,
  WORSHIP,
  makeDepartmentWorld,
  resolveDepartmentWorld,
  type DepartmentWorld,
} from "@/lib/testing/department-world";
import {
  canEditDepartmentBudget,
  canEditDepartmentRocks,
  canReadDepartmentBudget,
  canViewDepartment,
  canViewLeadershipRocks,
  editDepartmentBudget,
  editDepartmentRocks,
  readDepartmentBudget,
  viewDepartment,
  viewLeadershipRocks,
  type DepartmentGate,
} from "./access";

function client(world: DepartmentWorld) {
  return createFakeSupabase({ resolve: (q) => resolveDepartmentWorld(world, q) }).client;
}

function gate(partial: Partial<DepartmentGate> = {}): DepartmentGate {
  return {
    isAdmin: false,
    isLeadershipRole: false,
    leadershipMinistryId: LEADERSHIP,
    financeMinistryId: FINANCE,
    memberships: [],
    ...partial,
  };
}

describe("department gate", () => {
  it("lets a member see the department and keeps writes to its leaders and admins", () => {
    const member = gate({ memberships: [{ staff_ministry_id: MEDIA, member_role: "member" }] });
    const leader = gate({ memberships: [{ staff_ministry_id: MEDIA, member_role: "leader" }] });
    const admin = gate({ isAdmin: true });
    const finance = gate({ memberships: [{ staff_ministry_id: FINANCE, member_role: "member" }] });
    const leadership = gate({ memberships: [{ staff_ministry_id: LEADERSHIP, member_role: "member" }] });

    expect(viewDepartment(member, MEDIA)).toBe(true);
    expect(viewDepartment(member, FINANCE)).toBe(false);
    expect(editDepartmentRocks(member, MEDIA)).toBe(false);
    expect(readDepartmentBudget(member, MEDIA)).toBe(false);
    expect(editDepartmentBudget(member, MEDIA)).toBe(false);

    expect(editDepartmentRocks(leader, MEDIA)).toBe(true);
    expect(editDepartmentBudget(leader, MEDIA)).toBe(true);
    expect(editDepartmentRocks(leader, FINANCE)).toBe(false);

    expect(readDepartmentBudget(finance, MEDIA)).toBe(true);
    expect(editDepartmentBudget(finance, MEDIA)).toBe(false);
    expect(viewDepartment(finance, MEDIA)).toBe(false);

    expect(viewDepartment(admin, MEDIA)).toBe(true);
    expect(editDepartmentBudget(admin, MEDIA)).toBe(true);
    expect(viewLeadershipRocks(admin)).toBe(true);
    expect(viewLeadershipRocks(leadership)).toBe(true);
    expect(viewLeadershipRocks(leader)).toBe(false);
    expect(viewDepartment(leadership, MEDIA)).toBe(true);
  });

  it("treats an unscoped leadership role as Leadership Team", () => {
    expect(viewLeadershipRocks(gate({ isLeadershipRole: true, memberships: [] }))).toBe(true);
  });
});

describe("canViewDepartment and the write gates", () => {
  it("allows a member, a leader, leadership and an admin, and denies everyone else", async () => {
    const world = makeDepartmentWorld();
    const db = client(world);
    expect(await canViewDepartment(db, MEMBER, MEDIA)).toBe(true);
    expect(await canViewDepartment(db, LEADER, MEDIA)).toBe(true);
    expect(await canViewDepartment(db, LEADERSHIP_MEMBER, MEDIA)).toBe(true);
    expect(await canViewDepartment(db, LEADERSHIP_ROLE, WORSHIP)).toBe(true);
    expect(await canViewDepartment(db, ADMIN, MEDIA)).toBe(true);
    expect(await canViewDepartment(db, PLAIN_ADMIN, MEDIA)).toBe(true);
    expect(await canViewDepartment(db, OUTSIDER, MEDIA)).toBe(false);
    expect(await canViewDepartment(db, SCOPED_ADMIN, MEDIA)).toBe(false);
    expect(await canViewDepartment(db, FINANCE_USER, MEDIA)).toBe(false);
    expect(await canEditDepartmentRocks(db, MEMBER, MEDIA)).toBe(false);
    expect(await canEditDepartmentRocks(db, LEADER, MEDIA)).toBe(true);
    expect(await canEditDepartmentBudget(db, LEADER, MEDIA)).toBe(true);
    expect(await canReadDepartmentBudget(db, FINANCE_USER, MEDIA)).toBe(true);
    expect(await canEditDepartmentBudget(db, FINANCE_USER, MEDIA)).toBe(false);
    expect(await canReadDepartmentBudget(db, MEMBER, MEDIA)).toBe(false);
    expect(await canViewLeadershipRocks(db, LEADERSHIP_MEMBER)).toBe(true);
    expect(await canViewLeadershipRocks(db, LEADERSHIP_ROLE)).toBe(true);
    expect(await canViewLeadershipRocks(db, LEADER)).toBe(false);
    expect(await canViewLeadershipRocks(db, ADMIN)).toBe(true);
  });

  it("denies an inactive account even when they are an unscoped admin", async () => {
    const db = client(makeDepartmentWorld());
    expect(await canViewDepartment(db, INACTIVE_ADMIN, MEDIA)).toBe(false);
    expect(await canEditDepartmentBudget(db, INACTIVE_ADMIN, MEDIA)).toBe(false);
    expect(await canViewLeadershipRocks(db, INACTIVE_ADMIN)).toBe(false);
  });

  it("denies when the account lookup fails", async () => {
    const world = makeDepartmentWorld();
    world.errors = { users: true };
    const db = client(world);
    expect(await canViewDepartment(db, ADMIN, MEDIA)).toBe(false);
    expect(await canReadDepartmentBudget(db, FINANCE_USER, MEDIA)).toBe(false);
  });

  it("denies when the role, membership or ministry lookup fails", async () => {
    for (const table of ["user_roles", "staff_ministry_members", "staff_ministries"] as const) {
      const world = makeDepartmentWorld();
      world.errors = { [table]: true };
      const db = client(world);
      expect(await canViewDepartment(db, LEADER, MEDIA)).toBe(false);
      expect(await canViewDepartment(db, ADMIN, MEDIA)).toBe(false);
      expect(await canEditDepartmentRocks(db, LEADER, MEDIA)).toBe(false);
      expect(await canViewLeadershipRocks(db, LEADERSHIP_MEMBER)).toBe(false);
    }
  });

  it("treats is_active null as still active", async () => {
    const world = makeDepartmentWorld();
    const person = world.people.find((row) => row.id === MEMBER);
    if (!person) throw new Error("missing member");
    person.is_active = null;
    expect(await canViewDepartment(client(world), MEMBER, MEDIA)).toBe(true);
  });
});
