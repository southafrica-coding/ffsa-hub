import { describe, expect, it } from "vitest";
import { createFakeSupabase } from "@/lib/testing/fake-supabase";
import {
  ADMIN,
  FINANCE,
  FINANCE_USER,
  LEADER,
  LEADERSHIP,
  LEADERSHIP_MEMBER,
  LEADERSHIP_ROLE,
  MEDIA,
  MEMBER,
  OUTSIDER,
  makeDepartmentWorld,
  resolveDepartmentWorld,
  type DepartmentWorld,
} from "@/lib/testing/department-world";
import {
  accessFlags,
  canOpenDepartment,
  canSeeBudget,
  canSeeDepartmentDetail,
  canViewDepartment,
  canViewLeadershipRocks,
  editDepartmentBudget,
  type DepartmentGate,
} from "./access";

function client(world: DepartmentWorld) {
  return createFakeSupabase({ resolve: (q) => resolveDepartmentWorld(world, q) }).client;
}

function gate(partial: Partial<DepartmentGate> = {}): DepartmentGate {
  return {
    isAdmin: false,
    isFinanceAdmin: false,
    hasFinanceRead: false,
    leadershipMinistryId: LEADERSHIP,
    financeMinistryId: FINANCE,
    memberships: [],
    foldedTo: new Map(),
    ...partial,
  };
}

describe("department access flags", () => {
  it("lets a member see detail and withholds the budget", () => {
    const member = gate({ memberships: [{ staff_ministry_id: MEDIA, member_role: "member", is_point_leader: false }] });
    const flags = accessFlags(member, MEDIA);
    expect(flags.canSeeDepartmentDetail).toBe(true);
    expect(flags.canSeeBudget).toBe(false);
    expect(flags.canEditBudget).toBe(false);
    expect(flags.canEditRocks).toBe(false);
    expect(flags.canSeePeopleEmails).toBe(false);
  });

  it("lets a leader and a point leader edit", () => {
    const leader = gate({ memberships: [{ staff_ministry_id: MEDIA, member_role: "leader", is_point_leader: false }] });
    const point = gate({ memberships: [{ staff_ministry_id: MEDIA, member_role: "member", is_point_leader: true }] });
    expect(accessFlags(leader, MEDIA).canEditBudget).toBe(true);
    expect(accessFlags(point, MEDIA).canEditRocks).toBe(true);
    expect(accessFlags(point, MEDIA).canSeePeopleEmails).toBe(true);
    expect(accessFlags(leader, FINANCE).canEditBudget).toBe(false);
  });

  it("gives Leadership detail without budget, and finance-only the reverse", () => {
    const leadership = gate({ memberships: [{ staff_ministry_id: LEADERSHIP, member_role: "member", is_point_leader: false }] });
    const finance = gate({ memberships: [{ staff_ministry_id: FINANCE, member_role: "member", is_point_leader: false }] });
    const financeAdmin = gate({ isFinanceAdmin: true });
    expect(canSeeDepartmentDetail(leadership, MEDIA)).toBe(true);
    expect(canSeeBudget(leadership, MEDIA)).toBe(false);
    expect(canSeeDepartmentDetail(finance, MEDIA)).toBe(false);
    expect(canSeeBudget(finance, MEDIA)).toBe(true);
    expect(canOpenDepartment(finance, MEDIA)).toBe(true);
    expect(editDepartmentBudget(finance, MEDIA)).toBe(false);
    expect(canSeeBudget(financeAdmin, MEDIA)).toBe(true);
    expect(canSeeDepartmentDetail(financeAdmin, MEDIA)).toBe(false);
    expect(canSeeBudget(gate({ hasFinanceRead: true }), MEDIA)).toBe(true);
  });

  it("folds a donors_dev member into the finances home for detail only", () => {
    const donors = "donors-id";
    const viewer = gate({
      memberships: [{ staff_ministry_id: donors, member_role: "member", is_point_leader: false }],
      foldedTo: new Map([[donors, FINANCE]]),
    });
    expect(canSeeDepartmentDetail(viewer, FINANCE)).toBe(true);
    expect(canSeeBudget(viewer, FINANCE)).toBe(false);
  });
});

describe("loadDepartmentGate", () => {
  it("denies a stale leadership_team role", async () => {
    const db = client(makeDepartmentWorld());
    expect(await canViewDepartment(db, LEADERSHIP_ROLE, MEDIA)).toBe(false);
    expect(await canViewLeadershipRocks(db, LEADERSHIP_ROLE)).toBe(false);
    expect(await canViewDepartment(db, LEADERSHIP_MEMBER, MEDIA)).toBe(true);
    expect(await canSeeBudget(await import("./access").then((m) => m.loadDepartmentGate(db, LEADERSHIP_MEMBER)) as DepartmentGate, MEDIA)).toBe(false);
    expect(await canViewDepartment(db, OUTSIDER, MEDIA)).toBe(false);
    expect(await canViewDepartment(db, ADMIN, MEDIA)).toBe(true);
    expect(await canSeeBudget(await import("./access").then((m) => m.loadDepartmentGate(db, FINANCE_USER)) as DepartmentGate, MEDIA)).toBe(true);
    expect(await canSeeDepartmentDetail(await import("./access").then((m) => m.loadDepartmentGate(db, FINANCE_USER)) as DepartmentGate, MEDIA)).toBe(false);
  });

  it("denies when the account lookup fails", async () => {
    const world = makeDepartmentWorld();
    world.errors = { users: true };
    expect(await canViewDepartment(client(world), ADMIN, MEDIA)).toBe(false);
  });

  it("lets an unscoped finance.view holder see a budget and ignores a scoped one", async () => {
    const world = makeDepartmentWorld();
    world.permissions = [{ user_id: OUTSIDER, scope_type: null, scope_id: null, key: "finance.view" }];
    const db = client(world);
    const gate = await import("./access").then((m) => m.loadDepartmentGate(db, OUTSIDER));
    expect(gate?.hasFinanceRead).toBe(true);
    expect(canSeeDepartmentDetail(gate!, MEDIA)).toBe(false);

    world.permissions = [{ user_id: OUTSIDER, scope_type: "program", scope_id: MEDIA, key: "finance.view" }];
    const scoped = await import("./access").then((m) => m.loadDepartmentGate(client(world), OUTSIDER));
    expect(scoped?.hasFinanceRead).toBe(false);
  });
});
